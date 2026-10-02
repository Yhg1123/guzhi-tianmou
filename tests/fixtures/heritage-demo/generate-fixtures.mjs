/** Generate fictional test assets only. No real site, survey, photo or model data. */
import { mkdir, writeFile, utimes } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { createSampleSplat } from '../../../src/sampleSplat.js';
import { parseGeoJson } from '../../../src/geodata.js';
import { emptyProject, importDataset } from '../../../src/project.js';
import { saveSiteCapture, saveSiteModel } from '../../../src/archive.js';
import { createModelImportSession, inspectModelGeometry, validateModelFile } from '../../../src/modelValidation.js';
import { exportProjectBackup } from '../../../src/backup.js';

const directory = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('.', import.meta.url));
await mkdir(directory, { recursive: true });
const date = '2026-10-02T00:00:00.000Z';
const notice = '仅用于软件测试的虚构数据：名称、位置、时期、地形值、范围、图片和模型均不对应真实遗址或调查，不可用于研究结论、法定保护判断或摄影测量。';
const files = new Map();
async function write(name, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  await writeFile(join(directory, name), bytes);
  await utimes(join(directory, name), new Date(date), new Date(date));
  files.set(name, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
async function json(name, value) { await write(name, `${JSON.stringify(value, null, 2)}\n`); }
const collection = (features) => ({ type: 'FeatureCollection', name: 'SYNTHETIC-TEST-ONLY', fixture_notice: notice, features });
const site = (suffix, name, coordinates, terrain = {}) => ({
  type: 'Feature', id: `DEMO-ONLY-${suffix}`, geometry: { type: 'Point', coordinates },
  properties: { name: `【虚构】${name}`, period: '虚构时期甲', site_type: '虚构测试点', location: '虚构测试区（并非现场地址）', source: '虚构自动生成样本，无实测来源', is_demo: true, terrain_source: '虚构数值；非 DEM 提取', precision_m: null, ...terrain },
});
const a = site('A', '甲号测试点', [110, 35], { elevation_m: 100, slope_deg: 3, aspect_deg: 90, tpi: 2 });
const b = site('B', '乙号测试点', [110.01, 35.005]);
const c = site('C', '丙号测试点', [110.018, 35.012], { elevation_m: 115, slope_deg: 5 });
const d = site('D', '丁号新增测试点', [110.025, 35.018]);
const initial = collection([a, b, c]);
const fixtures = {
  'sites-initial.geojson': initial,
  'sites-addition.geojson': collection([d]),
  'sites-reordered-corrected.geojson': collection([d, c, { ...a, geometry: { type: 'Point', coordinates: [110.002, 35.003] } }, b]),
  'sites-duplicate-ids.geojson': collection([a, { ...b, id: a.id }]),
  'sites-invalid-coordinates.geojson': collection([site('INVALID-LNG', '经度越界', [181, 35]), site('INVALID-LAT', '纬度越界', [110, 91])]),
  'sites-mixed-invalid.geojson': collection([b, site('INVALID-LNG', '经度越界', [181, 35]), site('INVALID-LAT', '纬度越界', [110, 91])]),
  'waterways.geojson': collection([{ type: 'Feature', id: 'DEMO-WATER', properties: { name: '【虚构】同期水系样本', period: '虚构时期甲' }, geometry: { type: 'LineString', coordinates: [[109.995, 34.98], [109.995, 35.04]] } }]),
  'routes.geojson': collection([{ type: 'Feature', id: 'DEMO-ROUTE', properties: { name: '【虚构】同期交通样本', period: '虚构时期甲' }, geometry: { type: 'LineString', coordinates: [[109.98, 35.006], [110.04, 35.006]] } }]),
  'boundaries.geojson': collection([{ type: 'Feature', id: 'DEMO-BOUNDARY', properties: { name: '【虚构】边界样本（无法定效力）', category: '虚构边界测试', source: notice }, geometry: { type: 'Polygon', coordinates: [[[109.99, 34.99], [110.008, 34.99], [110.008, 35.008], [109.99, 35.008], [109.99, 34.99]]] } }]),
  'hazards.geojson': collection([{ type: 'Feature', id: 'DEMO-HAZARD', properties: { name: '【虚构】影响区样本（非风险判定）', category: '虚构现状影响测试', source: notice }, geometry: { type: 'Polygon', coordinates: [[[110.015, 35.009], [110.022, 35.009], [110.022, 35.015], [110.015, 35.015], [110.015, 35.009]]] } }]),
};
for (const [name, data] of Object.entries(fixtures)) await json(name, data);
const sources = Object.fromEntries(['sites', 'waterways', 'routes', 'boundaries', 'hazards'].map((kind) => {
  const name = kind === 'sites' ? 'sites-initial.geojson' : `${kind}.geojson`;
  return [kind, { name, count: fixtures[name].features.length, timing: ['waterways', 'routes'].includes(kind) ? 'historical' : ['boundaries', 'hazards'].includes(kind) ? 'present' : 'unknown', period: '虚构时期甲', citation: notice, importedAt: date, sha256: files.get(name).sha256 }];
}));
await json('sources.json', sources);

// A sparse 256-record calibration subset keeps downloads small; retain the
// original standard 32-byte records, including scale, color, and orientation.
const full = new Uint8Array(await createSampleSplat().arrayBuffer());
const total = full.byteLength / 32;
const splat = Buffer.alloc(256 * 32);
for (let index = 0; index < 256; index++) {
  const sourceIndex = Math.floor(index * (total - 1) / 255);
  splat.set(full.subarray(sourceIndex * 32, (sourceIndex + 1) * 32), index * 32);
}
await write('synthetic-calibration.splat', splat);

// Tiny deterministic RGB test patterns, never photos or photogrammetry input.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const label = Buffer.from(type);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length); label.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([label, data])), data.length + 8);
  return out;
}
function testPattern(seed) {
  const width = 16; const height = 16;
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (1 + width * 3) + 1 + x * 3;
    const stripe = ((x + y + seed) % 4) < 2;
    rows.set(stripe ? [255, 0, 255] : [0, 255, seed * 70], offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('tEXt', Buffer.from('Description\0SYNTHETIC TEST PATTERN; NOT A PHOTO; NOT FOR PHOTOGRAMMETRY')), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const photos = [];
for (let index = 1; index <= 3; index++) {
  const name = `FAKE-NOT-A-PHOTO-0${index}.png`;
  const image = testPattern(index);
  await write(name, image);
  photos.push({ name, size: image.length, modifiedAt: date });
}
const capture = { photos, checks: { permission: false, coverage: false, scale: false }, fixtureNotice: notice, imageKind: '16 × 16 synthetic pixel patterns; not photography', originalFilesStoredInBackup: false, photogrammetryUsable: false };
await json('fake-photo-metadata.json', capture);

let project = { ...emptyProject(), archiveId: 'SYNTHETIC-DEMO-PACK-ONLY' };
for (const [kind, source] of Object.entries(sources)) {
  project = importDataset(project, kind, parseGeoJson(JSON.stringify(fixtures[source.name]), kind).features, source, 'replace');
}
project.notes['DEMO-ONLY-A'] = '【虚构测试笔记】甲号点东侧记录一处模拟裂缝；不对应真实遗址或现场调查。';
const records = new Map();
const storage = {
  async update(key, update) { records.set(key, update(records.get(key))); },
  async readEntries(prefixes) { return [...records].filter(([key]) => prefixes.some((prefix) => key.startsWith(prefix))); },
};
const modelFile = new File([splat], 'synthetic-calibration.splat', { type: 'application/octet-stream', lastModified: new Date(date).getTime() });
await validateModelFile(modelFile);
const view = new DataView(splat.buffer, splat.byteOffset, splat.byteLength);
const geometry = inspectModelGeometry(256, (index) => [0, 4, 8].map((offset) => view.getFloat32(index * 32 + offset, true)));
const selected = project.datasets.sites[0];
const session = createModelImportSession({ persist: (model) => saveSiteModel(project, selected, model, storage) });
const token = session.stage({ name: modelFile.name, file: modelFile, importedAt: date, source: notice, testEvidence: 'Node fixture centers only; Gaussian parser/WebGL not tested' });
const outcome = await session.accept(token);
if (!outcome.saved) throw outcome.error || new Error('Synthetic archive save failed');
session.dispose();
await saveSiteCapture(project, selected, capture, storage);
await write('demo-full.heritage', Buffer.from(await (await exportProjectBackup(project, storage)).arrayBuffer()));
await json('manifest.json', { notice, model: { records: geometry.count, bytes: splat.length, geometryEvidence: 'Standard fixture byte-center decoding + inspectModelGeometry; NOT Gaussian renderer/parser integration', source: 'src/sampleSplat.js#createSampleSplat', seed: 'deterministic equidistant record subset' }, photos: 'The three PNGs are synthetic file-picker assets only. Backups retain their metadata, not image originals.', files: Object.fromEntries(files) });
console.log(`Generated ${files.size} synthetic fixture files in ${directory}`);
