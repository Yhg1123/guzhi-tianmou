import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';

// This is a controlled IndexedDB host, not a browser or an IndexedDB polyfill.
// The production archiveStorage adapter and idb-keyval both run unchanged.
// Only the host's opening, transaction termination, and event timing are driven
// here so cancellation/commit races are deterministic without new dependencies.
function controlledIndexedDb(initialEntries, { manualOpen = false } = {}) {
  const records = new Map(initialEntries);
  const transactions = [];
  const openRequests = [];
  const transactionWaiters = [];

  function createTransaction(mode) {
    assert.equal(mode, 'readwrite');
    const staged = new Map();
    const transaction = {
      state: 'active',
      error: null,
      abortCalls: 0,
      putCalls: 0,
      objectStore(name) {
        assert.equal(name, 'keyval');
        return {
          transaction,
          put(value, key) {
            if (transaction.state !== 'active') throw new DOMException('Transaction is inactive', 'TransactionInactiveError');
            transaction.putCalls += 1;
            staged.set(key, structuredClone(value));
          },
        };
      },
      abort() {
        transaction.abortCalls += 1;
        if (transaction.state !== 'active') throw new DOMException('Transaction has finished', 'InvalidStateError');
        transaction.state = 'aborted';
        transaction.error = new DOMException('Transaction aborted', 'AbortError');
        staged.clear();
        queueMicrotask(() => transaction.onabort?.());
      },
      // Browser commit and delivery of its complete event are separate steps.
      // Keeping them separate is essential to exercise the commit-winning race.
      commitWithoutEvent() {
        assert.equal(transaction.state, 'active');
        for (const [key, value] of staged) records.set(key, value);
        transaction.state = 'committed';
      },
      dispatchComplete() {
        assert.equal(transaction.state, 'committed');
        transaction.oncomplete?.();
      },
      completeIfActive() {
        if (transaction.state === 'active') {
          transaction.commitWithoutEvent();
          transaction.dispatchComplete();
        }
      },
    };
    transactions.push(transaction);
    transactionWaiters.shift()?.(transaction);
    return transaction;
  }

  const database = {
    transaction(name, mode) {
      assert.equal(name, 'keyval');
      return createTransaction(mode);
    },
  };
  const indexedDB = {
    open(name) {
      assert.equal(name, 'keyval-store');
      const request = {};
      openRequests.push(request);
      if (!manualOpen) queueMicrotask(() => succeedOpen(request));
      return request;
    },
  };
  function succeedOpen(request = openRequests.at(-1)) {
    assert.ok(request, 'The real adapter must request a database connection');
    request.result = database;
    request.onsuccess?.();
  }
  return {
    indexedDB, records, transactions, openRequests, succeedOpen,
    nextTransaction() {
      if (transactions.length) return Promise.resolve(transactions.at(-1));
      return new Promise((resolve) => transactionWaiters.push(resolve));
    },
  };
}

let moduleSequence = 0;
const initial = [['heritage-project-v2', { archiveId: 'old' }], ['existing-archive', { name: 'keep' }]];
const replacement = [['heritage-project-v2', { archiveId: 'restored' }], ['new-archive', { name: 'restored-model' }]];

async function fixture(t, options) {
  const host = controlledIndexedDb(initial, options);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: host.indexedDB });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else delete globalThis.indexedDB;
  });
  // Give createStore a fresh connection cache per case; do not mock the module.
  const url = new URL('../src/archive.js', import.meta.url);
  url.searchParams.set('transaction-test', String(++moduleSequence));
  const { archiveStorage } = await import(url.href);
  return { ...host, archiveStorage };
}

const eventLoopTurn = () => new Promise((resolve) => setImmediate(resolve));

test('an already canceled archive write never opens IndexedDB', async (t) => {
  const host = await fixture(t);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(host.archiveStorage.setMany(replacement, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(host.openRequests.length, 0);
  assert.deepEqual([...host.records], initial);
});

test('cancellation during database opening cannot queue any archive writes', async (t) => {
  const host = await fixture(t, { manualOpen: true });
  const controller = new AbortController();
  const write = host.archiveStorage.setMany(replacement, { signal: controller.signal });
  const rejected = assert.rejects(write, { name: 'AbortError' });
  assert.equal(host.openRequests.length, 1);

  controller.abort();
  host.succeedOpen();
  await rejected;
  assert.equal(host.transactions.reduce((count, transaction) => count + transaction.putCalls, 0), 0);
  assert.deepEqual([...host.records], initial);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('in-flight cancellation rejects the real archive adapter and preserves every existing key', async (t) => {
  const host = await fixture(t);
  const controller = new AbortController();
  const write = host.archiveStorage.setMany(replacement, { signal: controller.signal });
  const rejected = assert.rejects(write, { name: 'AbortError' });
  const transaction = await host.nextTransaction();
  assert.equal(transaction.putCalls, replacement.length);
  assert.deepEqual([...host.records], initial, 'Queued writes must not be visible before commit');

  controller.abort();
  // If the production adapter failed to connect cancellation to transaction.abort,
  // let the transaction complete: the promised rejection must then fail the test.
  transaction.completeIfActive();
  await rejected;
  assert.equal(transaction.abortCalls, 1);
  assert.deepEqual([...host.records], initial);
  assert.equal(host.records.has('new-archive'), false);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('a committed transaction wins cancellation and resolves only after its complete event', async (t) => {
  const host = await fixture(t);
  const controller = new AbortController();
  let settled = false;
  const write = host.archiveStorage.setMany(replacement, { signal: controller.signal });
  const observed = write.then(
    (value) => { settled = true; return { status: 'fulfilled', value }; },
    (error) => { settled = true; return { status: 'rejected', error }; },
  );
  const transaction = await host.nextTransaction();
  transaction.commitWithoutEvent();

  controller.abort(); // The host now throws InvalidStateError from abort().
  await eventLoopTurn();
  assert.equal(transaction.abortCalls, 1);
  assert.equal(settled, false, 'The signal alone must not decide a committed transaction outcome');
  transaction.dispatchComplete();

  assert.equal((await observed).status, 'fulfilled');
  assert.deepEqual(host.records.get('heritage-project-v2'), replacement[0][1]);
  assert.deepEqual(host.records.get('new-archive'), replacement[1][1]);
  assert.deepEqual(host.records.get('existing-archive'), initial[1][1]);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('successful archive completion removes its listener before any later cancellation', async (t) => {
  const host = await fixture(t);
  const controller = new AbortController();
  const write = host.archiveStorage.setMany(replacement, { signal: controller.signal });
  const transaction = await host.nextTransaction();
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);

  transaction.commitWithoutEvent();
  transaction.dispatchComplete();
  await write;
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  controller.abort();
  assert.equal(transaction.abortCalls, 0);
  assert.deepEqual(host.records.get('heritage-project-v2'), replacement[0][1]);
  assert.deepEqual(host.records.get('new-archive'), replacement[1][1]);
});
