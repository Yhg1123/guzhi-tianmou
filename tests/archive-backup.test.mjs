import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProject, serializeProject } from '../src/project.js';
import { archiveKey, loadSiteArchive, saveSiteModel, saveSiteCapture, listProjectArchives } from '../src/archive.js';
import { exportProjectBackup, restoreProjectBackup, BACKUP_LIMITS, validateBackupSizes } from '../src/backup.js';

function memoryStorage(initial = []) {
  const records = new Map(initial);
  return {
    records, writes: 0,
    async keys() { return [...records.keys()]; },
    async getMany(keys) { return keys.map((key) => records.get(key)); },
    async setMany(pairs) { this.writes++; for (const [key, value] of pairs) records.set(key, value); },
    async update(key, fn) { this.writes++; records.set(key, fn(records.get(key))); },
  };
}
function project(id = 'test-project') { return { ...emptyProject(), archiveId: id, legacyArchiveMigration: false }; }
function model(name = 'record.splat') { return { validation: 'ready', name, file: new File([new Uint8Array(32)], name, { lastModified: 1234, type: 'application/octet-stream' }), importedAt: '2026-10-02T00:00:00.000Z' }; }
const capture = { photos: [{ name: 'a.jpg', size: 150, modifiedAt: '2026-10-02T00:00:00.000Z' }], checks: { permission: true, coverage: false, scale: false } };

// Without coordinate-independent keys, a corrected site loses its model.
test('archive identity survives coordinate changes and preserves capture when model changes', async () => {
  const p = project(); const site = p.datasets.sites[0]; const store = memoryStorage();
  await saveSiteCapture(p, site, capture, store);
  await saveSiteModel(p, site, model(), store);
  const loaded = await loadSiteArchive(p, { ...site, lng: site.lng + 1 }, store);
  assert.equal(loaded.model.name, 'record.splat'); assert.deepEqual(loaded.capture, capture);
  assert.deepEqual(await loadSiteArchive(project('another-project'), site, store), { model: null, capture: null });
});

test('unique legacy record migrates after a coordinate correction without deleting originals', async () => {
  const p = { ...project(), legacyArchiveMigration: true }; const site = p.datasets.sites[0];
  const key = `heritage-splat:${site.id}:${site.lng}:${site.lat}`;
  const original = model(); const store = memoryStorage([[key, original], [`${key}:capture`, capture]]);
  const result = await loadSiteArchive(p, { ...site, lng: 120, lat: 30 }, store);
  assert.equal(result.model, original); assert.deepEqual(result.capture, capture);
  assert.equal(store.records.get(key), original); assert.equal(store.records.get(`${key}:capture`), capture);
  assert.equal(store.records.get(archiveKey(p, site)).model, original);
});

test('legacy migration refuses several coordinate records and ignores similar ID prefixes', async () => {
  const p = { ...project(), legacyArchiveMigration: true }; const site = p.datasets.sites[0];
  const store = memoryStorage([[`heritage-splat:${site.id}:1:2`, model()], [`heritage-splat:${site.id}:3:4`, model('other.splat')], [`heritage-splat:${site.id}:suffix:5:6`, model()]]);
  await assert.rejects(loadSiteArchive(p, site, store), /多个|歧义/);
  assert.equal(store.writes, 0);
  const prefixed = memoryStorage([[`heritage-splat:${site.id}:suffix:5:6`, model()]]);
  assert.deepEqual(await loadSiteArchive(p, site, prefixed), { model: null, capture: null });
});

test('fresh projects never link global legacy records with matching site IDs', async () => {
  const p = project(); const site = p.datasets.sites[0];
  const store = memoryStorage([[`heritage-splat:${site.id}:${site.lng}:${site.lat}`, model()]]);
  assert.deepEqual(await loadSiteArchive(p, site, store), { model: null, capture: null });
});

test('complete backup roundtrips binary, capture, removed sites and quarantined legacy records', async () => {
  const p = { ...project(), legacyArchiveMigration: true }; const site = p.datasets.sites[0];
  p.notes[site.id] = '遗址研究笔记';
  const store = memoryStorage();
  await saveSiteModel(p, site, model(), store); await saveSiteCapture(p, site, capture, store);
  await saveSiteModel(p, { id: 'removed-site' }, model('removed.splat'), store);
  store.records.set('heritage-splat:legacy-removed:1:2', model('old.splat'));
  store.records.set('heritage-splat:legacy-removed:1:2:capture', capture);
  const blob = await exportProjectBackup(p, store);
  assert.ok(blob instanceof Blob); assert.equal(blob.type, 'application/x-heritage-project');
  const target = memoryStorage([['heritage-project-v2', project('old-current')]]);
  const next = await restoreProjectBackup(blob, target);
  assert.notEqual(next.archiveId, p.archiveId); assert.equal(next.legacyArchiveMigration, false);
  assert.equal(next.notes[site.id], p.notes[site.id]); assert.equal(target.records.get('heritage-project-v2'), next);
  assert.equal(target.writes, 1, 'one transaction commits project and every archive');
  const restored = await loadSiteArchive(next, site, target);
  assert.deepEqual(new Uint8Array(await restored.model.file.arrayBuffer()), new Uint8Array(await model().file.arrayBuffer()));
  assert.equal(restored.model.file.name, 'record.splat'); assert.equal(restored.model.file.lastModified, 1234);
  assert.deepEqual(restored.capture, capture);
  assert.equal((await loadSiteArchive(next, { id: 'removed-site' }, target)).model.name, 'removed.splat');
  const legacy = await loadSiteArchive(next, { id: 'legacy-removed' }, target);
  assert.equal(legacy.model.name, 'old.splat'); assert.deepEqual(legacy.capture, capture);
  const second = await restoreProjectBackup(await exportProjectBackup(next, target), memoryStorage());
  assert.notEqual(second.archiveId, next.archiveId);
});

test('legacy JSON restore accepts metadata above old 15 MiB upload cap and isolates archive IDs', async () => {
  const p = project(); const serialized = serializeProject(p);
  serialized.sources.sites.citation = 'x'.repeat(16 * 1024 * 1024);
  const store = memoryStorage();
  const next = await restoreProjectBackup(new Blob([JSON.stringify(serialized)]), store);
  assert.equal(next.sources.sites.citation.length, 16 * 1024 * 1024);
  assert.notEqual(next.archiveId, p.archiveId); assert.equal(next.legacyArchiveMigration, false);
  assert.equal(store.writes, 1);
});

test('corrupt or truncated bundles never mutate the current project or archives', async () => {
  const p = project(); const site = p.datasets.sites[0]; const source = memoryStorage();
  await saveSiteModel(p, site, model(), source);
  const blob = await exportProjectBackup(p, source);
  const bytes = new Uint8Array(await blob.arrayBuffer()); bytes[bytes.length - 1] ^= 1;
  const previous = project('keep-me'); const store = memoryStorage([['heritage-project-v2', previous]]);
  await assert.rejects(restoreProjectBackup(new Blob([bytes]), store), /校验|损坏/);
  await assert.rejects(restoreProjectBackup(blob.slice(0, blob.size - 1), store), /长度|截断|损坏/);
  assert.equal(store.writes, 0); assert.equal(store.records.get('heritage-project-v2'), previous);
});

test('restore propagates failed atomic commit instead of returning restored project', async () => {
  const p = project(); const file = new Blob([JSON.stringify(serializeProject(p))]);
  const current = project('keep'); const store = memoryStorage([['heritage-project-v2', current]]);
  store.setMany = async () => { throw new Error('QuotaExceededError'); };
  await assert.rejects(restoreProjectBackup(file, store), /QuotaExceededError/);
  assert.equal(store.records.get('heritage-project-v2'), current);
});

test('shared export/import size policy permits 120 MiB models and rejects larger totals', () => {
  assert.equal(BACKUP_LIMITS.modelBytes, 120 * 1024 * 1024);
  assert.equal(BACKUP_LIMITS.bundleBytes, 512 * 1024 * 1024);
  assert.equal(BACKUP_LIMITS.metadataBytes, 80 * 1024 * 1024);
  assert.doesNotThrow(() => validateBackupSizes({ modelBytes: [BACKUP_LIMITS.modelBytes], metadataBytes: 75 * 1024 * 1024, totalBytes: 200 * 1024 * 1024 }));
  assert.throws(() => validateBackupSizes({ modelBytes: [BACKUP_LIMITS.modelBytes + 1], metadataBytes: 1, totalBytes: BACKUP_LIMITS.modelBytes + 2 }), /120/);
  assert.throws(() => validateBackupSizes({ modelBytes: [], metadataBytes: BACKUP_LIMITS.metadataBytes + 1, totalBytes: BACKUP_LIMITS.metadataBytes + 1 }), /80/);
  assert.throws(() => validateBackupSizes({ modelBytes: [], metadataBytes: 1, totalBytes: BACKUP_LIMITS.bundleBytes + 1 }), /512/);
});

test('export fails on invalid archive instead of silently omitting it', async () => {
  const p = project(); const store = memoryStorage([[archiveKey(p, { id: 'removed' }), { model: { ...model(), file: new Blob(['bad']) }, capture: null }]]);
  await assert.rejects(exportProjectBackup(p, store), /SPLAT|模型/);
});

test('capture storage rejects photo originals and does not modify saved metadata', async () => {
  const p = project(); const store = memoryStorage(); const site = p.datasets.sites[0];
  await saveSiteCapture(p, site, capture, store);
  await assert.rejects(saveSiteCapture(p, site, { ...capture, original: new Blob(['photo']) }, store), /清单|元数据/);
  assert.deepEqual((await loadSiteArchive(p, site, store)).capture, capture);
});

test('model metadata roundtrips but a restored ready claim requires fresh viewer validation', async () => {
  const p = project(); const site = p.datasets.sites[0]; const source = memoryStorage();
  await saveSiteModel(p, site, { ...model(), validation: 'ready', validatedAt: '2026-10-02T00:00:00.000Z', source: 'field survey' }, source);
  const target = memoryStorage(); const next = await restoreProjectBackup(await exportProjectBackup(p, source), target);
  const restored = await loadSiteArchive(next, site, target);
  assert.equal(restored.model.source, 'field survey');
  assert.equal(restored.model.validation, 'pending');
  assert.equal(restored.model.validatedAt, undefined);
});

test('invalid existing namespaced model cannot reach the viewer inspector', async () => {
  const p = project(); const site = p.datasets.sites[0];
  const source = memoryStorage([[archiveKey(p, site), { model: { name: 'bad.splat', file: {} }, capture: null }]]);
  await assert.rejects(loadSiteArchive(p, site, source), /模型/);
});


test('unvalidated model cannot overwrite persisted archive', async () => {
  const p = project(); const site = p.datasets.sites[0]; const store = memoryStorage();
  const unvalidated = { ...model(), validation: 'pending' };
  await assert.rejects(saveSiteModel(p, site, unvalidated, store), /验证|校验/);
  assert.equal(store.writes, 0);
});

test('valid JSON metadata tampering fails checksum before any restore writes', async () => {
  const p = project(); p.notes[p.datasets.sites[0].id] = 'unique-note-A';
  const blob = await exportProjectBackup(p, memoryStorage());
  const bytes = Buffer.from(await blob.arrayBuffer());
  const index = bytes.indexOf('unique-note-A'); assert.ok(index >= 0);
  bytes[index + 'unique-note-'.length] = 'B'.charCodeAt(0);
  const store = memoryStorage();
  await assert.rejects(restoreProjectBackup(new Blob([bytes]), store), /元数据.*校验|校验.*元数据/);
  assert.equal(store.writes, 0);
});

test('identical model bytes use one payload while retaining both archive records', async () => {
  const p = { ...project(), legacyArchiveMigration: true }; const site = p.datasets.sites[0]; const store = memoryStorage();
  await saveSiteModel(p, site, model(), store);
  store.records.set(`heritage-splat:${site.id}:1:2`, model());
  const blob = await exportProjectBackup(p, store);
  const header = new Uint8Array(await blob.slice(0, 46).arrayBuffer());
  const metadataBytes = new DataView(header.buffer).getUint32(10, true);
  const allBytes = Buffer.from(await blob.arrayBuffer());
  const manifestStart = allBytes.indexOf('{"format"');
  assert.equal(blob.size - manifestStart - metadataBytes, 32);
  const target = memoryStorage(); const next = await restoreProjectBackup(blob, target);
  const snapshot = await listProjectArchives(next, target);
  assert.equal(snapshot.archives.length, 1); assert.equal(snapshot.legacyRecords.length, 1);
});

test('canceled restore cannot replace a newer project after slow validation', async () => {
  const p = project(); const original = new Blob([JSON.stringify(serializeProject(p))]);
  let release; const delay = new Promise((resolve) => { release = resolve; });
  original.text = async () => { await delay; return JSON.stringify(serializeProject(p)); };
  const newer = project('newer'); const store = memoryStorage([['heritage-project-v2', newer]]);
  const controller = new AbortController();
  const pendingRestore = restoreProjectBackup(original, store, { signal: controller.signal });
  controller.abort(); release();
  await assert.rejects(pendingRestore, (error) => error.name === 'AbortError');
  assert.equal(store.writes, 0); assert.equal(store.records.get('heritage-project-v2'), newer);
});

test('maximum-length site IDs also fit the legacy key wrapper in complete backups', async () => {
  const p = { ...project(), legacyArchiveMigration: true }; const siteId = 's'.repeat(4096);
  const store = memoryStorage([[`heritage-splat:${siteId}:108.95:34.28`, model()]]);
  const target = memoryStorage(); const next = await restoreProjectBackup(await exportProjectBackup(p, store), target);
  assert.equal((await loadSiteArchive(next, { id: siteId }, target)).model.name, 'record.splat');
});
