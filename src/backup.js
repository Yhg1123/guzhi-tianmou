import { restoreProject, serializeProject } from './project.js';
import { archiveStorage, archiveKey, legacyArchiveKey, listProjectArchives, parseLegacyArchiveKey, validateArchiveModel, validateCaptureMetadata, validateJsonMetadata, MODEL_MAX_BYTES } from './archive.js';

export const BACKUP_LIMITS = Object.freeze({ modelBytes: MODEL_MAX_BYTES, metadataBytes: 80 * 1024 * 1024, bundleBytes: 512 * 1024 * 1024 });
const MAGIC = new TextEncoder().encode('HERITAGE1\n');
const HEADER_BYTES = MAGIC.length + 4 + 32;
const MIME = 'application/x-heritage-project';
const PROJECT_KEY = 'heritage-project-v2';
export function validateBackupSizes({ modelBytes = [], metadataBytes, totalBytes }) {
  if (modelBytes.some((bytes) => !Number.isSafeInteger(bytes) || bytes < 1 || bytes > BACKUP_LIMITS.modelBytes)) throw new Error('每个模型须大于 0 且不超过 120 MiB。');
  if (!Number.isSafeInteger(metadataBytes) || metadataBytes < 0 || metadataBytes > BACKUP_LIMITS.metadataBytes) throw new Error('项目元数据超过 80 MiB 上限，请精简图层属性或采集清单。');
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0 || totalBytes > BACKUP_LIMITS.bundleBytes) throw new Error('完整备份超过 512 MiB 上限，请先单独保留模型原件并精简项目；未生成不完整备份。');
}
async function sha256(blob) {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function validIdentity(value, limit = 4096) { return typeof value === 'string' && value.length > 0 && value.length <= limit; }
function validateRecordLists(manifest) {
  for (const [kind, field] of [['archives', 'siteId'], ['legacyRecords', 'legacyKey']]) {
    if (!Array.isArray(manifest[kind])) throw new Error('备份档案目录不完整。');
    const seen = new Set();
    for (const entry of manifest[kind]) {
      if (!entry || !validIdentity(entry[field], kind === 'legacyRecords' ? 8192 : 4096) || seen.has(entry[field])) throw new Error('备份含缺失或重复的档案标识。');
      seen.add(entry[field]);
      if (kind === 'legacyRecords') {
        const parsed = parseLegacyArchiveKey(entry.legacyKey);
        if (!parsed || parsed.capture) throw new Error('备份旧版档案标识无效。');
      }
      if (entry.capture != null) validateCaptureMetadata(entry.capture);
    }
  }
}

export async function exportProjectBackup(project, storage = archiveStorage) {
  const serialized = serializeProject(project);
  // Exercise the same layer/schema validation used by import before success.
  restoreProject(JSON.stringify(serialized));
  const snapshot = await listProjectArchives(project, storage);
  const manifest = { format: 'heritage-project', version: 1, createdAt: new Date().toISOString(), project: serialized, archives: [], legacyRecords: [] };
  validateRecordLists(snapshot);
  const blobs = []; const sizes = []; const payloads = new Map(); let offset = 0;
  for (const kind of ['archives', 'legacyRecords']) {
    for (const record of snapshot[kind]) {
      let descriptor = null;
      if (record.model != null) {
        await validateArchiveModel(record.model);
        const { file, name, importedAt } = record.model;
        sizes.push(file.size);
        const digest = await sha256(file);
        const fingerprint = `${file.size}:${digest}`;
        const shared = payloads.get(fingerprint);
        const payloadOffset = shared ?? offset;
        validateBackupSizes({ modelBytes: sizes, metadataBytes: 0, totalBytes: HEADER_BYTES + offset + (shared === undefined ? file.size : 0) });
        descriptor = { metadata: Object.fromEntries(Object.entries(record.model).filter(([key]) => key !== 'file')), name, importedAt: importedAt ?? '', type: file.type, lastModified: Number.isSafeInteger(file.lastModified) ? file.lastModified : 0, offset: payloadOffset, length: file.size, sha256: digest };
        if (shared === undefined) { payloads.set(fingerprint, offset); blobs.push(file); offset += file.size; }
      }
      manifest[kind].push({ [kind === 'archives' ? 'siteId' : 'legacyKey']: record[kind === 'archives' ? 'siteId' : 'legacyKey'], model: descriptor, capture: record.capture });
    }
  }
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  validateBackupSizes({ modelBytes: sizes, metadataBytes: json.byteLength, totalBytes: HEADER_BYTES + json.byteLength + offset });
  const header = new Uint8Array(HEADER_BYTES); header.set(MAGIC);
  new DataView(header.buffer).setUint32(MAGIC.length, json.byteLength, true);
  header.set(new Uint8Array(await crypto.subtle.digest('SHA-256', json)), MAGIC.length + 4);
  return new Blob([header, json, ...blobs], { type: MIME });
}

async function readBundle(file, signal) {
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  signal?.throwIfAborted();
  const binary = MAGIC.every((byte, index) => header[index] === byte);
  if (!binary) {
    validateBackupSizes({ metadataBytes: file.size, totalBytes: file.size });
    const project = restoreProject(await file.text());
    return { project, archives: [], legacyRecords: [] };
  }
  if (header.length !== HEADER_BYTES) throw new Error('备份文件头已截断。');
  const metadataBytes = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(MAGIC.length, true);
  validateBackupSizes({ metadataBytes, totalBytes: file.size });
  const payloadStart = HEADER_BYTES + metadataBytes;
  if (payloadStart > file.size) throw new Error('备份元数据长度不符，文件可能已截断。');
  const metadata = file.slice(HEADER_BYTES, payloadStart);
  const expectedHash = [...header.slice(MAGIC.length + 4)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (await sha256(metadata) !== expectedHash) throw new Error('备份元数据 SHA-256 校验失败，文件可能已损坏；未替换当前项目。');
  signal?.throwIfAborted();
  let manifest;
  try { manifest = JSON.parse(await metadata.text()); }
  catch { throw new Error('备份元数据损坏，无法读取。'); }
  if (manifest?.format !== 'heritage-project' || manifest.version !== 1) throw new Error('不支持此备份格式或版本。');
  validateRecordLists(manifest);
  const project = restoreProject(JSON.stringify(manifest.project));
  let offset = 0; const sizes = []; const payloads = new Map(); const result = { project, archives: [], legacyRecords: [] };
  for (const kind of ['archives', 'legacyRecords']) {
    for (const entry of manifest[kind]) {
      signal?.throwIfAborted();
      let model = null;
      if (entry.model != null) {
        const descriptor = entry.model;
        if (descriptor.metadata != null) {
          if (typeof descriptor.metadata !== 'object' || Array.isArray(descriptor.metadata)) throw new Error('模型元数据无效。');
          validateJsonMetadata(descriptor.metadata);
        }
        if (!validIdentity(descriptor.name) || typeof descriptor.type !== 'string' || descriptor.type.length > 255 || typeof descriptor.importedAt !== 'string' || descriptor.importedAt.length > 100 || !Number.isSafeInteger(descriptor.lastModified) || descriptor.lastModified < 0 || !Number.isSafeInteger(descriptor.offset) || descriptor.offset < 0 || descriptor.offset > offset || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) throw new Error('备份模型目录损坏或字节区间重叠。');
        sizes.push(descriptor.length);
        validateBackupSizes({ modelBytes: sizes, metadataBytes, totalBytes: file.size });
        if (payloadStart + descriptor.offset + descriptor.length > file.size) throw new Error('模型字节长度不符，备份已截断。');
        const shared = payloads.get(descriptor.offset);
        if (descriptor.offset < offset && (!shared || shared.length !== descriptor.length || shared.sha256 !== descriptor.sha256)) throw new Error('备份模型目录损坏或字节区间重叠。');
        const bytes = file.slice(payloadStart + descriptor.offset, payloadStart + descriptor.offset + descriptor.length);
        if (!shared) {
          if (await sha256(bytes) !== descriptor.sha256) throw new Error('模型 SHA-256 校验失败，备份可能已损坏；未替换当前项目。');
          payloads.set(descriptor.offset, { length: descriptor.length, sha256: descriptor.sha256 }); offset += descriptor.length;
        }
        const modelFile = new File([bytes], descriptor.name, { type: descriptor.type, lastModified: descriptor.lastModified });
        model = { ...descriptor.metadata, file: modelFile, name: descriptor.name, importedAt: descriptor.importedAt, validation: 'pending' };
        delete model.validatedAt;
        await validateArchiveModel(model);
      }
      result[kind].push({ [kind === 'archives' ? 'siteId' : 'legacyKey']: entry[kind === 'archives' ? 'siteId' : 'legacyKey'], model, capture: entry.capture ?? null });
    }
  }
  if (payloadStart + offset !== file.size) throw new Error('备份总长度不符，存在多余或缺失的模型字节。');
  return result;
}

export async function restoreProjectBackup(file, storage = archiveStorage, { signal } = {}) {
  signal?.throwIfAborted();
  if (!(file instanceof Blob) || !file.size) throw new Error('请选择非空项目备份文件。');
  validateBackupSizes({ metadataBytes: 0, totalBytes: file.size });
  const { project, archives, legacyRecords } = await readBundle(file, signal);
  // A fresh namespace makes restore independent of every existing project,
  // including JSON backups containing coincidentally identical legacy site IDs.
  const next = { ...project, archiveId: crypto.randomUUID(), legacyArchiveMigration: false };
  const entries = [[PROJECT_KEY, next]];
  for (const { siteId, model, capture } of archives) entries.push([archiveKey(next, { id: siteId }), { model, capture }]);
  for (const { legacyKey, model, capture } of legacyRecords) entries.push([legacyArchiveKey(next, legacyKey), { model, capture }]);
  // idb-keyval setMany uses one readwrite transaction. Failure aborts all writes;
  // React must only receive `next` after this promise has committed.
  signal?.throwIfAborted();
  await storage.setMany(entries, { signal });
  return next;
}
