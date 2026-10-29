import test from "node:test";
import assert from "node:assert/strict";
import { captureCatalogKey, captureImageKey, validCaptureCatalog, validateCaptureFiles, captureManifest, buildCaptureZip, crc32, storedZip, sha256 } from "../src/captureData.js";

const site = { id: "遗址 & A", name: "遗址A", lng: 109.052, lat: 34.277 };
const checks = { permission: true, coverage: false, scale: false };
async function photo(bytes = new Uint8Array([0, 255, 12, 65, 7])) {
  const file = new File([bytes], "original.JPG", { type: "image/jpeg" });
  return { file, thumbnail: new Blob(["thumbnail"]), name: file.name, bytes: file.size, type: file.type, sha256: await sha256(file), width: 2048, height: 1365, direction: "front" };
}

test("capture catalogs bind originals to the exact site and keep old metadata-only keys separate", async () => {
  const p = await photo();
  const manifest = captureManifest(site, [p], checks, "同一台基东侧");
  assert.equal(validCaptureCatalog(manifest, site), true);
  assert.equal(manifest.trainingStatus, "not_started");
  assert.equal(manifest.includesPhotoBytes, true);
  assert.equal(manifest.photos[0].file, undefined);
  assert.ok(captureCatalogKey(site).endsWith(":capture-v2"));
  assert.notEqual(captureCatalogKey(site), captureCatalogKey({ ...site, lng: 0 }));
  assert.notEqual(captureImageKey(site, p.sha256), captureImageKey({ ...site, id: "other" }, p.sha256));
  assert.equal(validCaptureCatalog(manifest, { ...site, lat: site.lat + 0.001 }), false);
  assert.equal(validCaptureCatalog({ ...manifest, photos: [...manifest.photos, ...manifest.photos] }, site), false);
  assert.equal(validCaptureCatalog({ ...manifest, photos: [{ ...manifest.photos[0], width: 0 }] }, site), false);
  assert.throws(() => captureManifest(site, [p], { ...checks, permission: false }, "台基"), /授权/);
  assert.throws(() => captureManifest(site, [p], checks, "  "), /主体/);
});

test("the ZIP contains original bytes and a complete manifest; missing or changed originals block export", async () => {
  const p = await photo(), q = await photo(new Uint8Array([19, 20, 21]));
  const manifest = captureManifest(site, [p, q], checks, "同一拍摄主体");
  const zip = new Uint8Array(await (await buildCaptureZip(manifest, [p, q])).arrayBuffer());
  const view = new DataView(zip.buffer), files = new Map(); let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const length = view.getUint32(at + 18, true), nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(zip.slice(at + 30, at + 30 + nameLength));
    const data = zip.slice(at + 30 + nameLength, at + 30 + nameLength + length);
    assert.equal(crc32(data), view.getUint32(at + 14, true)); files.set(name, data);
    at += 30 + nameLength + length;
  }
  assert.equal(view.getUint32(at, true), 0x02014b50);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(files.get("manifest.json"))), manifest);
  assert.deepEqual(files.get(manifest.photos[0].path), new Uint8Array(await p.file.arrayBuffer()));
  assert.deepEqual(files.get(manifest.photos[1].path), new Uint8Array(await q.file.arrayBuffer()));
  assert.notEqual(manifest.photos[0].path, manifest.photos[1].path, "Identical source filenames must not collide");
  await assert.rejects(buildCaptureZip(manifest, [p]), /缺失或校验失败/);
  await assert.rejects(buildCaptureZip(manifest, [{ ...p, file: new Blob(["12345"]) }, q]), /缺失或校验失败/);
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.throws(() => storedZip([{ name: "../escape.jpg", bytes: new Uint8Array() }]), /archive path/);
});

test("unreadable or excessive file declarations never replace the photo catalog", () => {
  assert.throws(() => validateCaptureFiles([]));
  assert.throws(() => validateCaptureFiles([{ name: "a.exe", size: 10 }]));
  assert.throws(() => validateCaptureFiles([{ name: "a.JPG", size: 0 }]));
  assert.throws(() => validateCaptureFiles([{ name: "a.JPG", size: 21 * 1024 * 1024 }]));
  assert.throws(() => validateCaptureFiles([{ name: "a.JPG", size: 20 }], 250 * 1024 * 1024));
  assert.doesNotThrow(() => validateCaptureFiles([{ name: "a.JPG", size: 100 }]));
});
