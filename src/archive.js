import { createStore, getMany, setMany, update, promisifyRequest } from 'idb-keyval';

export const MODEL_MAX_BYTES = 120 * 1024 * 1024;
const ARCHIVE_PREFIX = 'heritage-archive:';
const LEGACY_PREFIX = 'heritage-splat:';
const idbStore = createStore('keyval-store', 'keyval');

// A single read transaction gives export a consistent archive snapshot. Reading
// only matching cursors avoids materializing binary archives of other projects.
export const archiveStorage = {
  getMany, update,
  async setMany(entries, { signal } = {}) {
    signal?.throwIfAborted();
    if (!signal) return setMany(entries);
    return setMany(entries, (mode, callback) => idbStore(mode, (store) => {
      signal.throwIfAborted();
      const abort = () => { try { store.transaction.abort(); } catch { /* It may already have committed. */ } };
      signal.addEventListener('abort', abort, { once: true });
      return Promise.resolve(callback(store)).finally(() => signal.removeEventListener('abort', abort));
    }));
  },
  async readEntries(prefixes) {
    return idbStore('readonly', (store) => {
      const result = [];
      for (const prefix of prefixes) {
        const request = store.openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          result.push([cursor.key, cursor.value]); cursor.continue();
        };
      }
      return promisifyRequest(store.transaction).then(() => result);
    });
  },
};

function stringId(value, label) {
  if (typeof value !== 'string' || !value.length || value.length > 4096) throw new Error(`${label}缺失或无效。`);
  return value;
}
export function archivePrefix(project) { return `${ARCHIVE_PREFIX}${encodeURIComponent(stringId(project?.archiveId, '项目档案标识'))}:`; }
export function archiveKey(project, site) { return `${archivePrefix(project)}site:${encodeURIComponent(stringId(site?.id, '遗址 ID'))}`; }
export function legacyArchiveKey(project, legacyKey) { return `${archivePrefix(project)}legacy:${encodeURIComponent(legacyKey)}`; }

export function parseLegacyArchiveKey(key) {
  if (typeof key !== 'string' || !key.startsWith(LEGACY_PREFIX)) return null;
  const capture = key.endsWith(':capture');
  const base = capture ? key.slice(0, -8) : key;
  const match = /^heritage-splat:(.+):([^:]+):([^:]+)$/.exec(base);
  const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
  if (!match || !numeric.test(match[2]) || !numeric.test(match[3])) return null;
  const lng = Number(match[2]); const lat = Number(match[3]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return { base, siteId: match[1], capture };
}

function archiveRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('本地三维档案结构损坏；未覆盖原记录。');
  return { model: value.model ?? null, capture: value.capture ?? null };
}
async function readEntries(storage, prefixes) {
  if (storage.readEntries) return storage.readEntries(prefixes);
  const selected = (await storage.keys()).filter((key) => typeof key === 'string' && prefixes.some((prefix) => key.startsWith(prefix)));
  const values = await storage.getMany(selected);
  return selected.map((key, index) => [key, values[index]]);
}

export async function listProjectArchives(project, storage = archiveStorage) {
  const prefix = archivePrefix(project);
  const records = await readEntries(storage, [prefix, ...(project.legacyArchiveMigration === true ? [LEGACY_PREFIX] : [])]);
  const archives = []; const legacy = new Map();
  for (const [key, value] of records) {
    if (key.startsWith(`${prefix}site:`)) {
      const siteId = decodeURIComponent(key.slice(`${prefix}site:`.length)); stringId(siteId, '遗址 ID');
      archives.push({ siteId, ...archiveRecord(value) });
    } else if (key.startsWith(`${prefix}legacy:`)) {
      const legacyKey = decodeURIComponent(key.slice(`${prefix}legacy:`.length));
      const parsed = parseLegacyArchiveKey(legacyKey);
      if (!parsed || parsed.capture) throw new Error('旧版档案键无效，无法生成完整备份。');
      if (legacy.has(legacyKey)) throw new Error('旧版档案重复，无法生成完整备份。');
      legacy.set(legacyKey, { legacyKey, ...archiveRecord(value) });
    } else if (key.startsWith(LEGACY_PREFIX)) {
      const parsed = parseLegacyArchiveKey(key);
      if (!parsed) throw new Error('存在无法识别的旧版档案，无法生成完整备份。');
      const current = legacy.get(parsed.base) || { legacyKey: parsed.base, model: null, capture: null };
      const kind = parsed.capture ? 'capture' : 'model';
      if (current[kind] != null) throw new Error('旧版档案重复，无法生成完整备份。');
      current[kind] = value; legacy.set(parsed.base, current);
    } else throw new Error('存在无法识别的项目档案，无法生成完整备份。');
  }
  archives.sort((a, b) => a.siteId.localeCompare(b.siteId));
  return { archives, legacyRecords: [...legacy.values()].sort((a, b) => a.legacyKey.localeCompare(b.legacyKey)) };
}

export async function loadSiteArchive(project, site, storage = archiveStorage) {
  const key = archiveKey(project, site);
  const [saved] = await storage.getMany([key]);
  if (saved !== undefined) {
    const result = archiveRecord(saved);
    if (result.model) await validateArchiveModel(result.model);
    if (result.capture) validateCaptureMetadata(result.capture);
    return result;
  }
  const { legacyRecords } = await listProjectArchives(project, storage);
  const matches = legacyRecords.filter((entry) => parseLegacyArchiveKey(entry.legacyKey).siteId === site.id);
  if (matches.length > 1) throw new Error('同一遗址存在多个旧版坐标档案，无法自动确定关联；原记录已保留，请先备份项目。');
  if (!matches.length) return { model: null, capture: null };
  const migrated = archiveRecord(matches[0]);
  if (migrated.model) await validateArchiveModel(migrated.model);
  if (migrated.capture) validateCaptureMetadata(migrated.capture);
  let result;
  await storage.update(key, (current) => { result = current === undefined ? migrated : archiveRecord(current); return result; });
  return result;
}

export async function validateArchiveModel(model) {
  if (!model || typeof model.name !== 'string' || !model.name.length || model.name.length > 4096 || !(model.file instanceof Blob)) throw new Error('三维模型记录无效。');
  const ext = model.name.split('.').pop().toLowerCase();
  if (!['splat', 'ply', 'ksplat'].includes(ext)) throw new Error('模型格式须为 PLY、SPLAT 或 KSPLAT。');
  if (!model.file.size || model.file.size > MODEL_MAX_BYTES) throw new Error('每个模型须大于 0 且不超过 120 MiB。');
  if (model.file.type.length > 255 || (model.file.lastModified != null && (!Number.isSafeInteger(model.file.lastModified) || model.file.lastModified < 0))) throw new Error('模型文件元数据无效。');
  validateJsonMetadata(Object.fromEntries(Object.entries(model).filter(([key]) => key !== 'file')));
  if (model.importedAt != null && (typeof model.importedAt !== 'string' || model.importedAt.length > 100)) throw new Error('模型导入时间元数据无效。');
  if (ext === 'splat' && model.file.size % 32 !== 0) throw new Error('SPLAT 模型长度不符合 32 字节点格式。');
  if (ext === 'ply') {
    const header = await model.file.slice(0, 65536).text();
    if (!header.startsWith('ply') || !header.includes('end_header') || !(header.includes('scale_0') || header.includes('packed_scale'))) throw new Error('PLY 模型缺少高斯属性或完整文件头。');
  }
  return model;
}

// Only JSON metadata is stored. A File/Blob nested anywhere must not silently
// turn into {} during backup and create a false promise that photos were saved.
export function validateCaptureMetadata(capture) {
  if (!capture || typeof capture !== 'object' || !Array.isArray(capture.photos) || capture.photos.length > 1000 || !capture.checks || typeof capture.checks !== 'object') throw new Error('采集清单元数据结构无效。');
  for (const photo of capture.photos) {
    if (!photo || typeof photo.name !== 'string' || !photo.name.length || photo.name.length > 4096 || !Number.isSafeInteger(photo.size) || photo.size < 0 || photo.size > 50 * 1024 * 1024 || typeof photo.modifiedAt !== 'string' || photo.modifiedAt.length > 100) throw new Error('采集照片清单元数据无效。');
  }
  for (const key of ['permission', 'coverage', 'scale']) if (typeof capture.checks[key] !== 'boolean') throw new Error('采集检查清单元数据无效。');
  validateJsonMetadata(capture);
  return capture;
}

export function validateJsonMetadata(metadata) {
  const seen = new Set();
  function check(value, depth = 0) {
    if (depth > 30) throw new Error('采集清单元数据嵌套过深。');
    if (value === null || ['string', 'boolean'].includes(typeof value)) return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (!value || typeof value !== 'object' || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) || seen.has(value)) throw new Error('采集清单只能保存 JSON 元数据，不保存照片原件。');
    seen.add(value);
    for (const item of Object.values(value)) check(item, depth + 1);
    seen.delete(value);
  }
  check(metadata);
  return metadata;
}
export async function saveSiteModel(project, site, model, storage = archiveStorage) {
  if (model?.validation !== 'ready') throw new Error('模型必须通过查看器解析验证后才能保存。');
  await validateArchiveModel(model);
  await storage.update(archiveKey(project, site), (current) => ({ ...archiveRecord(current || {}), model }));
}
export async function saveSiteCapture(project, site, capture, storage = archiveStorage) {
  validateCaptureMetadata(capture);
  await storage.update(archiveKey(project, site), (current) => ({ ...archiveRecord(current || {}), capture }));
}
