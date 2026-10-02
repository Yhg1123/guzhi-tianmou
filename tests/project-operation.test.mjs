import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/projectOperation.js';

test('a project restore owns the mutation lock until its terminal result',()=>{
 assert.equal(typeof api.createProjectOperationLock,'function');
 const events=[]; const lock=api.createProjectOperationLock((value)=>events.push(value));
 const release=lock.acquire();
 assert.equal(lock.isLocked(),true);
 assert.throws(()=>lock.acquire(),/恢复/);
 // Navigation/remount does not replace the App-owned lock. Even if cancellation
 // loses to a committed IDB transaction, new edits wait for its terminal result.
 const nextPageLock=lock;
 assert.equal(nextPageLock.isLocked(),true);
 release(); assert.equal(lock.isLocked(),false);
 release(); assert.deepEqual(events,[true,false]);
 const second=lock.acquire(); release(); assert.equal(lock.isLocked(),true);
 second(); assert.equal(lock.isLocked(),false);
});
