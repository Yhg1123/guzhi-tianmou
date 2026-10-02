import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { parseGeoJson, historicalDistance, containingAreas, investigationBuffer } from '../src/geodata.js';
import { emptyProject, importDataset, serializeProject } from '../src/project.js';
import { archiveKey, loadSiteArchive, saveSiteCapture, saveSiteModel } from '../src/archive.js';
import { exportProjectBackup, restoreProjectBackup } from '../src/backup.js';
import { createModelImportSession, inspectModelGeometry, validateModelFile } from '../src/modelValidation.js';
import { createProjectOperationLock } from '../src/projectOperation.js';
import { createSampleSplat } from '../src/sampleSplat.js';

const fixtureRoot = new URL('./fixtures/heritage-demo/', import.meta.url);
const textFixture = (name) => readFile(new URL(name, fixtureRoot), 'utf8');
const jsonFixture = async (name) => JSON.parse(await textFixture(name));
const bytesFixture = (name) => readFile(new URL(name, fixtureRoot));
const fieldNote = '【虚构测试笔记】甲号点东侧记录一处模拟裂缝；不对应真实遗址或现场调查。';
const initialIds = ['DEMO-ONLY-A', 'DEMO-ONLY-B', 'DEMO-ONLY-C'];

// This adapter exercises public persistence helpers without claiming IndexedDB coverage.
function inMemoryStorage(initial = []) {
  const records = new Map(initial);
  return {
    records, writes: 0,
    async readEntries(prefixes) { return [...records].filter(([key]) => prefixes.some((prefix) => key.startsWith(prefix))); },
    async getMany(keys) { return keys.map((key) => records.get(key)); },
    async update(key, update) { const value = update(records.get(key)); records.set(key, value); this.writes++; },
    async setMany(entries, { signal } = {}) {
      signal?.throwIfAborted();
      for (const [key, value] of entries) records.set(key, value);
      this.writes++;
    },
  };
}

async function parsedFixture(name, kind = 'sites') {
  return parseGeoJson(await textFixture(name), kind);
}

async function initialProject() {
  const sources = await jsonFixture('sources.json');
  let project = emptyProject();
  for (const [kind, filename] of Object.entries({ sites: 'sites-initial.geojson', waterways: 'waterways.geojson', routes: 'routes.geojson', boundaries: 'boundaries.geojson', hazards: 'hazards.geojson' })) {
    const parsed = await parsedFixture(filename, kind);
    assert.equal(parsed.skipped, 0, `${filename} must be entirely valid`);
    project = importDataset(project, kind, parsed.features, sources[kind], 'replace');
  }
  return project;
}

// Decode only the known fixture's standard 32-byte center layout. This is NOT the
// @mkkellogg Gaussian parser, renderer, or a substitute for WebGL browser testing.
async function inspectFixtureGeometry(file) {
  await validateModelFile(file);
  const bytes = await file.arrayBuffer();
  const view = new DataView(bytes);
  return inspectModelGeometry(bytes.byteLength / 32, (index) => [0, 4, 8].map((offset) => view.getFloat32(index * 32 + offset, true)));
}

async function attachSyntheticArchive(project, storage) {
  const site = project.datasets.sites.find((entry) => entry.id === 'DEMO-ONLY-A');
  const file = new File([await bytesFixture('synthetic-calibration.splat')], 'synthetic-calibration.splat', { type: 'application/octet-stream', lastModified: 1790899200000 });
  const capture = await jsonFixture('fake-photo-metadata.json');
  const session = createModelImportSession({ persist: (model) => saveSiteModel(project, site, model, storage) });
  const candidate = session.stage({ file, name: file.name, importedAt: '2026-10-02T00:00:00.000Z', source: 'SYNTHETIC TEST ONLY; not surveyed', testEvidence: 'Node fixture centers only; Gaussian parser and WebGL untested' });
  assert.equal(candidate.model.validation, 'pending');
  assert.deepEqual(await loadSiteArchive(project, site, storage), { model: null, capture: null });
  const geometry = await inspectFixtureGeometry(file);
  assert.equal(geometry.count, 256);
  assert.ok(geometry.size > 5 && geometry.size < 10);
  const outcome = await session.accept(candidate);
  assert.equal(outcome.saved, true);
  await saveSiteCapture(project, site, capture, storage);
  session.dispose();
  return { site, file, capture, geometry };
}

test('synthetic five-layer fixtures parse and distinguish historical context from present-day exposure', async () => {
  const project = await initialProject();
  assert.deepEqual(project.datasets.sites.map((site) => site.id), initialIds);
  assert.ok(project.datasets.sites.every((site) => site.isDemo && site.name.includes('虚构') && site.recordSource.includes('虚构')));
  assert.deepEqual(Object.fromEntries(Object.entries(project.datasets).map(([kind, features]) => [kind, features.length])), { sites: 3, waterways: 1, routes: 1, boundaries: 1, hazards: 1 });
  const [a, b, c] = project.datasets.sites;
  assert.equal(b.elevation_m, null, 'missing measurements are not inferred');
  const water = historicalDistance(a, project.datasets.waterways, project.sources.waterways);
  const route = historicalDistance(a, project.datasets.routes, project.sources.routes);
  assert.ok(water > 0.4 && water < 0.5, `synthetic water distance ${water}`);
  assert.ok(route > 0.6 && route < 0.8, `synthetic route distance ${route}`);
  assert.equal(historicalDistance(a, project.datasets.waterways, { timing: 'present' }), null);
  assert.equal(historicalDistance({ ...a, period: '虚构时期乙' }, project.datasets.waterways, project.sources.waterways), null);
  assert.deepEqual(containingAreas(a, project.datasets.boundaries), ['【虚构】边界样本（无法定效力）']);
  assert.deepEqual(containingAreas(a, project.datasets.hazards), []);
  assert.deepEqual(containingAreas(c, project.datasets.hazards), ['【虚构】影响区样本（非风险判定）']);
  const buffer = investigationBuffer(a, 500);
  assert.equal(buffer.properties.radius_m, 500);
  assert.equal(buffer.properties.is_demo, true);
  assert.match(buffer.properties.purpose, /非法定/);
});

test('main helper flow retains notes, stable IDs, model bytes and capture through append, correction and complete restore', async () => {
  let project = await initialProject();
  const storage = inMemoryStorage();
  project = { ...project, notes: { ...project.notes, 'DEMO-ONLY-A': fieldNote } };
  const saved = await attachSyntheticArchive(project, storage);
  const originalKey = archiveKey(project, saved.site);
  const originalNamespace = project.archiveId;
  const originalSite = { ...saved.site };
  const addition = await parsedFixture('sites-addition.geojson');
  project = importDataset(project, 'sites', addition.features, { name: 'sites-addition.geojson', citation: '仅供虚构测试' }, 'append');
  assert.deepEqual(project.datasets.sites.map((site) => site.id), [...initialIds, 'DEMO-ONLY-D']);
  assert.equal(project.sources.sites.count, 4);
  assert.equal(project.sources.sites.imports.length, 2);
  const beforeDuplicate = JSON.stringify(serializeProject(project));
  assert.throws(() => importDataset(project, 'sites', addition.features, { name: 'duplicate-addition.geojson' }, 'append'), /重复/);
  assert.equal(JSON.stringify(serializeProject(project)), beforeDuplicate, 'failed append must not mutate project');
  const corrected = await parsedFixture('sites-reordered-corrected.geojson');
  project = importDataset(project, 'sites', corrected.features, { name: 'sites-reordered-corrected.geojson', citation: '仅供虚构坐标修正测试' }, 'replace');
  assert.deepEqual(project.datasets.sites.map((site) => site.id), ['DEMO-ONLY-D', 'DEMO-ONLY-C', 'DEMO-ONLY-A', 'DEMO-ONLY-B']);
  const updatedSite = project.datasets.sites.find((site) => site.id === originalSite.id);
  assert.equal(updatedSite.sourceId, originalSite.sourceId);
  assert.notEqual(updatedSite.lng, originalSite.lng);
  assert.notEqual(updatedSite.lat, originalSite.lat);
  assert.deepEqual([updatedSite.lng, updatedSite.lat], [110.002, 35.003]);
  assert.equal(project.archiveId, originalNamespace);
  assert.equal(archiveKey(project, updatedSite), originalKey);
  assert.equal(project.notes[updatedSite.id], fieldNote);
  const linked = await loadSiteArchive(project, updatedSite, storage);
  assert.equal(linked.model.file, saved.file, 'stable identity must resolve the same saved model');
  assert.deepEqual(linked.capture, saved.capture);
  const blob = await exportProjectBackup(project, storage);
  assert.equal(blob.type, 'application/x-heritage-project');
  const previous = emptyProject();
  const target = inMemoryStorage([['heritage-project-v2', previous]]);
  const restored = await restoreProjectBackup(blob, target);
  assert.equal(target.writes, 1);
  assert.equal(target.records.get('heritage-project-v2'), restored);
  assert.notEqual(restored.archiveId, project.archiveId);
  assert.deepEqual(restored.datasets, project.datasets);
  assert.equal(restored.notes[updatedSite.id], fieldNote);
  const restoredArchive = await loadSiteArchive(restored, updatedSite, target);
  assert.deepEqual(new Uint8Array(await restoredArchive.model.file.arrayBuffer()), new Uint8Array(await saved.file.arrayBuffer()));
  assert.equal(restoredArchive.model.file.lastModified, saved.file.lastModified);
  assert.equal(restoredArchive.model.file.name, saved.file.name);
  assert.deepEqual(restoredArchive.capture, saved.capture);
  assert.equal(restoredArchive.model.validation, 'pending', 'restore must require fresh real viewer validation');
  assert.equal(restoredArchive.model.validatedAt, undefined);
  assert.deepEqual(await loadSiteArchive(restored, { id: 'DEMO-ONLY-B' }, target), { model: null, capture: null });
});

test('duplicate IDs and invalid coordinates fail or report skipped rows without changing the active project', async () => {
  const project = await initialProject();
  const before = JSON.stringify(serializeProject(project));
  await assert.rejects(parsedFixture('sites-duplicate-ids.geojson'), /ID.*重复|重复.*ID/);
  await assert.rejects(parsedFixture('sites-invalid-coordinates.geojson'), /没有有效/);
  const mixed = await parsedFixture('sites-mixed-invalid.geojson');
  assert.equal(mixed.features.length, 1);
  assert.equal(mixed.skipped, 2);
  assert.equal(mixed.features[0].id, 'DEMO-ONLY-B');
  assert.equal(JSON.stringify(serializeProject(project)), before);
});

test('malformed synthetic geometry and canceled candidate cannot overwrite the saved model or capture list', async () => {
  const project = await initialProject();
  const storage = inMemoryStorage();
  const saved = await attachSyntheticArchive(project, storage);
  const before = await loadSiteArchive(project, saved.site, storage);
  const writes = storage.writes;
  const brokenBytes = new Uint8Array(await saved.file.arrayBuffer());
  new DataView(brokenBytes.buffer).setFloat32(0, NaN, true);
  const broken = new File([brokenBytes], 'invalid-centers.splat');
  await validateModelFile(broken); // valid extension/length alone cannot validate a model
  const session = createModelImportSession({ persist: (model) => saveSiteModel(project, saved.site, model, storage) });
  const token = session.stage({ name: broken.name, file: broken });
  await assert.rejects(inspectFixtureGeometry(broken), /非有限/);
  assert.equal(session.reject(token), true);
  assert.equal((await session.accept(token)).accepted, false);
  const canceled = session.stage({ name: saved.file.name, file: saved.file });
  session.dispose();
  assert.equal((await session.accept(canceled)).accepted, false);
  assert.equal(storage.writes, writes);
  assert.deepEqual(await loadSiteArchive(project, saved.site, storage), before);
});

test('corrupted binary payload, metadata and truncated backup all preserve the previous project', async () => {
  const project = await initialProject();
  project.notes['DEMO-ONLY-A'] = fieldNote;
  const storage = inMemoryStorage();
  await attachSyntheticArchive(project, storage);
  const backup = await exportProjectBackup(project, storage);
  const original = Buffer.from(await backup.arrayBuffer());
  const payloadDamaged = Buffer.from(original); payloadDamaged[payloadDamaged.length - 1] ^= 1;
  const metadataDamaged = Buffer.from(original);
  const nameOffset = metadataDamaged.indexOf('sites-initial.geojson');
  assert.ok(nameOffset >= 0);
  metadataDamaged[nameOffset] = 'S'.charCodeAt(0);
  const previous = emptyProject();
  const marker = { retained: true };
  const target = inMemoryStorage([['heritage-project-v2', previous], ['unrelated-record', marker]]);
  await assert.rejects(restoreProjectBackup(new Blob([payloadDamaged]), target), /模型.*SHA-256/);
  await assert.rejects(restoreProjectBackup(new Blob([metadataDamaged]), target), /元数据.*SHA-256/);
  await assert.rejects(restoreProjectBackup(backup.slice(0, backup.size - 1), target), /长度|截断/);
  assert.equal(target.writes, 0);
  assert.equal(target.records.size, 2);
  assert.equal(target.records.get('heritage-project-v2'), previous);
  assert.equal(target.records.get('unrelated-record'), marker);
});

test('canceling a delayed binary restore keeps mutation lock until terminal rejection and writes nothing', async () => {
  const project = await initialProject();
  const source = inMemoryStorage();
  await attachSyntheticArchive(project, source);
  const backup = await exportProjectBackup(project, source);
  let releaseRead;
  const delay = new Promise((resolve) => { releaseRead = resolve; });
  const slice = backup.slice.bind(backup);
  backup.slice = (...args) => {
    const part = slice(...args);
    if (args[0] === 0) {
      const read = part.arrayBuffer.bind(part);
      part.arrayBuffer = async () => { await delay; return read(); };
    }
    return part;
  };
  const previous = emptyProject();
  const target = inMemoryStorage([['heritage-project-v2', previous]]);
  const changes = [];
  const lock = createProjectOperationLock((locked) => changes.push(locked));
  const release = lock.acquire();
  const controller = new AbortController();
  const pending = restoreProjectBackup(backup, target, { signal: controller.signal }).finally(release);
  controller.abort();
  assert.equal(lock.isLocked(), true, 'requesting cancel alone is not completion');
  assert.throws(() => lock.acquire(), /恢复/);
  releaseRead();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
  assert.equal(lock.isLocked(), false);
  assert.deepEqual(changes, [true, false]);
  assert.equal(target.writes, 0);
  assert.equal(target.records.get('heritage-project-v2'), previous);
});

test('small splat is reproducible from createSampleSplat and packaged backup restores demo-only material', async () => {
  const file = await bytesFixture('synthetic-calibration.splat');
  assert.equal(file.length, 256 * 32);
  const full = new Uint8Array(await createSampleSplat().arrayBuffer());
  const total = full.length / 32;
  for (const index of [0, 1, 127, 255]) {
    const sourceIndex = Math.floor(index * (total - 1) / 255);
    assert.deepEqual(file.subarray(index * 32, (index + 1) * 32), Buffer.from(full.subarray(sourceIndex * 32, (sourceIndex + 1) * 32)));
  }
  const target = inMemoryStorage();
  const demo = await restoreProjectBackup(new Blob([await bytesFixture('demo-full.heritage')]), target);
  assert.deepEqual(demo.datasets.sites.map((site) => site.id), initialIds);
  assert.deepEqual(demo.datasets, (await initialProject()).datasets, "packaged backup matches every current source layer");
  assert.equal(demo.notes['DEMO-ONLY-A'], fieldNote);
  assert.ok(demo.datasets.sites.every((site) => site.isDemo));
  const archive = await loadSiteArchive(demo, { id: 'DEMO-ONLY-A' }, target);
  assert.deepEqual(Buffer.from(await archive.model.file.arrayBuffer()), file);
  assert.equal(archive.model.validation, 'pending');
  assert.deepEqual(archive.capture, await jsonFixture('fake-photo-metadata.json'));
  assert.ok(archive.capture.photos.every((photo) => photo.name.startsWith('FAKE-NOT-A-PHOTO-')));
});

test('fixture generator creates a separately usable pack without adding dependencies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'heritage-demo-'));
  try {
    execFileSync(process.execPath, [new URL('generate-fixtures.mjs', fixtureRoot).pathname, directory], { stdio: 'pipe' });
    assert.deepEqual(await readFile(join(directory, 'synthetic-calibration.splat')), await bytesFixture('synthetic-calibration.splat'));
    const generated = parseGeoJson(await readFile(join(directory, 'sites-initial.geojson'), 'utf8'), 'sites');
    assert.deepEqual(generated.features.map((site) => site.id), initialIds);
    const restored = await restoreProjectBackup(new Blob([await readFile(join(directory, 'demo-full.heritage'))]), inMemoryStorage());
    assert.equal(restored.notes['DEMO-ONLY-A'], fieldNote);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('fixture manifest checksums and synthetic PNG metadata match the actual downloadable files', async () => {
  const manifest = await jsonFixture('manifest.json');
  assert.match(manifest.notice, /虚构/);
  for (const [name, expected] of Object.entries(manifest.files)) {
    const bytes = await bytesFixture(name);
    assert.equal(bytes.length, expected.bytes, name);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, name);
  }
  const capture = await jsonFixture('fake-photo-metadata.json');
  assert.equal(capture.photos.length, 3);
  assert.equal(capture.photogrammetryUsable, false);
  assert.equal(capture.originalFilesStoredInBackup, false);
  assert.deepEqual(capture.checks, { permission: false, coverage: false, scale: false });
  for (const photo of capture.photos) {
    const image = await bytesFixture(photo.name);
    assert.equal(image.length, photo.size);
    assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(image.readUInt32BE(16), 16);
    assert.equal(image.readUInt32BE(20), 16);
    assert.match(image.toString('latin1'), /NOT A PHOTO/);
    const idat = image.indexOf('IDAT');
    assert.ok(idat >= 4);
    const compressedLength = image.readUInt32BE(idat - 4);
    const pixels = inflateSync(image.subarray(idat + 4, idat + 4 + compressedLength));
    assert.equal(pixels.length, 16 * (1 + 16 * 3));
    for (let row = 0; row < 16; row++) assert.equal(pixels[row * 49], 0, 'PNG scanlines use no filter');
  }
});
