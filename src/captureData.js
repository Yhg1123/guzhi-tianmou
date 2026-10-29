import { siteModelKey } from "./reconstruction.js";

export const CAPTURE_LIMIT_BYTES = 250 * 1024 * 1024;
export const CAPTURE_DIRECTIONS = [["unknown", "未标注"], ["front", "正面"], ["left", "左侧"], ["rear", "背面"], ["right", "右侧"], ["detail", "构件细节"]];
export const captureCatalogKey = (site) => siteModelKey(site) ? `${siteModelKey(site)}:capture-v2` : null;
export const captureImageKey = (site, hash) => `${captureCatalogKey(site)}:image:${hash}`;
const validDirection = (value) => CAPTURE_DIRECTIONS.some(([id]) => id === value);

export async function sha256(blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), (v) => v.toString(16).padStart(2, "0")).join("");
}

export function validateCaptureFiles(files, currentBytes = 0) {
  if (!files.length) throw new Error("请选择原始照片。");
  if (files.length > 300) throw new Error("一次最多读取 300 张照片，请分批加入。");
  if (files.some((file) => !/\.(jpe?g|png|webp)$/i.test(file.name) || !file.size || file.size > 20 * 1024 * 1024)) throw new Error("支持 JPG、PNG、WEBP，每张须大于 0 且不超过 20 MB。");
  if (currentBytes + files.reduce((sum, file) => sum + file.size, 0) > CAPTURE_LIMIT_BYTES) throw new Error("此遗址的原片资料超过 250 MB，请先导出备份，再分批整理。");
}

export async function inspectCapturePhoto(file, direction = "unknown") {
  const hash = await sha256(file);
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 60_000_000) throw new Error("图像超过 6,000 万像素，请使用相机导出的较小原片。");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumbnail = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!thumbnail) throw new Error("无法生成图像预览。");
    return { name: file.name, bytes: file.size, type: file.type, sha256: hash, width: bitmap.width, height: bitmap.height, direction, file, thumbnail };
  } finally { bitmap.close(); }
}

export function validCaptureCatalog(catalog, site) {
  return catalog?.schema === 2 && captureCatalogKey(catalog.site) === captureCatalogKey(site)
    && Array.isArray(catalog.photos) && catalog.photos.length <= 300
    && new Set(catalog.photos.map((p) => p.sha256)).size === catalog.photos.length
    && catalog.photos.every((p) => typeof p.name === "string" && /\.(jpe?g|png|webp)$/i.test(p.name)
      && /^[a-f0-9]{64}$/.test(p.sha256) && Number.isInteger(p.bytes) && p.bytes > 0 && p.bytes <= 20 * 1024 * 1024
      && Number.isInteger(p.width) && Number.isInteger(p.height) && Math.min(p.width, p.height) > 0 && validDirection(p.direction))
    && catalog.photos.reduce((sum, p) => sum + p.bytes, 0) <= CAPTURE_LIMIT_BYTES
    && ["permission", "coverage", "scale"].every((key) => typeof catalog.checks?.[key] === "boolean")
    && typeof catalog.subject === "string" && catalog.subject.length <= 120;
}

export function captureManifest(site, photos, checks, subject, now = new Date().toISOString()) {
  if (!captureCatalogKey(site) || !photos.length) throw new Error("请先保存当前遗址的原片。");
  const manifest = {
    schema: 2, site: { id: site.id, name: site.name, lng: site.lng, lat: site.lat }, subject: subject.trim(), checks,
    createdAt: now, includesPhotoBytes: true, trainingStatus: "not_started",
    photos: photos.map(({ file, thumbnail, ...p }, i) => ({ ...p, path: `images/${String(i + 1).padStart(4, "0")}-${p.sha256.slice(0, 12)}.${p.name.split(".").pop().toLowerCase()}` })),
    constraints: "包含实际原片。拍摄方向由提供者标注，非相机位姿；照片数不证明覆盖或重建质量。尚未相机解算、训练或完成尺度校核。原片许可与使用授权须另行核对，勾选授权不是公开许可。",
  };
  if (!validCaptureCatalog(manifest, site)) throw new Error("原片资料未通过完整性校验。");
  if (!checks.permission || !manifest.subject) throw new Error("请填写同一拍摄主体，并确认拍摄与使用授权后导出。");
  return manifest;
}

// ZIP STORE (no compression): originals retain their exact bytes. Generated
// ASCII paths avoid collisions, traversal and platform-dependent filenames.
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function storedZip(entries) {
  const localParts = [], directoryParts = []; let offset = 0, directorySize = 0;
  for (const { name, bytes } of entries) {
    if (!/^[a-zA-Z0-9_.\/-]+$/.test(name) || name.startsWith("/") || name.split("/").includes("..")) throw new Error("Invalid archive path");
    const filename = encoder.encode(name), crc = crc32(bytes);
    const local = new Uint8Array(30), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(12, 33, true);
    l.setUint32(14, crc, true); l.setUint32(18, bytes.length, true); l.setUint32(22, bytes.length, true); l.setUint16(26, filename.length, true);
    const central = new Uint8Array(46), c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 33, true);
    c.setUint32(16, crc, true); c.setUint32(20, bytes.length, true); c.setUint32(24, bytes.length, true); c.setUint16(28, filename.length, true); c.setUint32(42, offset, true);
    localParts.push(local, filename, bytes); directoryParts.push(central, filename);
    offset += local.length + filename.length + bytes.length; directorySize += central.length + filename.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true); e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  return new Blob([...localParts, ...directoryParts, end], { type: "application/zip" });
}

export async function buildCaptureZip(manifest, photos) {
  const entries = [{ name: "manifest.json", bytes: encoder.encode(JSON.stringify(manifest, null, 2)) }];
  for (const photo of manifest.photos) {
    const original = photos.find((p) => p.sha256 === photo.sha256)?.file;
    if (!(original instanceof Blob) || original.size !== photo.bytes || await sha256(original) !== photo.sha256) throw new Error(`${photo.name} 的原片缺失或校验失败，未导出不完整资料包。`);
    entries.push({ name: photo.path, bytes: new Uint8Array(await original.arrayBuffer()) });
  }
  return storedZip(entries);
}
