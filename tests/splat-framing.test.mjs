import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PerspectiveCamera, Vector3 } from "three";
import { siteArchives } from "../src/siteArchives.js";
import { photoFraming } from "../src/splatFraming.js";

test("complete photo framing contains actual model pixels in wide, square and portrait viewports", async () => {
  for (const asset of siteArchives) {
    const bytes = await readFile(new URL("../public" + asset.modelUrl, import.meta.url));
    for (const aspect of [0.45, 1, 1.78, 3.5]) {
      const fit = photoFraming(asset.processedWidth, asset.processedHeight, aspect);
      const camera = new PerspectiveCamera(fit.fov, aspect, 0.01, 20);
      camera.position.set(0, 0, 0); camera.lookAt(0, 0, -1.4);
      camera.zoom = fit.zoom; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      const indices = new Set([0, asset.processedWidth - 1, asset.pointCount - asset.processedWidth, asset.pointCount - 1]);
      for (let i = 0; i < asset.pointCount; i += 997) indices.add(i);
      for (const index of indices) {
        const at = index * 32;
        const point = new Vector3(bytes.readFloatLE(at), bytes.readFloatLE(at + 4), bytes.readFloatLE(at + 8)).project(camera);
        assert.ok(Math.abs(point.x) < 0.95 && Math.abs(point.y) < 0.95, `${asset.id}: source pixel cropped at aspect ${aspect}`);
        assert.ok(point.z > -1 && point.z < 1);
      }
    }
  }
});

test("overview clears detail zoom and angular presets stay within visible-surface inspection", () => {
  assert.ok(photoFraming(768, 222, 1, "detail").zoom > 1);
  assert.equal(photoFraming(768, 222, 1, "overview").zoom, 1);
  assert.equal(photoFraming(768, 222, 1, "overview").angle, 0);
  assert.ok(Math.abs(photoFraming(768, 222, 1, "front").angle) < 0.075);
  assert.ok(Math.abs(photoFraming(768, 222, 1, "top").angle) < 0.075);
  for (const dims of [[0, 5, 1], [5, NaN, 1], [5, 5, -1]]) assert.throws(() => photoFraming(...dims));
});

test("Xianyang defaults to wider documented scenery and retains the previous close-up and site model", () => {
  const asset = siteArchives.find((a) => a.id === "xianyang");
  assert.equal(asset.photos[0].id, "xianyang-palace-wide");
  assert.equal(asset.photos[0].license, "CC0");
  assert.ok(asset.photos.some((p) => p.id === "xianyang-palace-model"));
  assert.ok(asset.photos.some((p) => p.id === "xianyang-site-overview"));
  const [left, top, right, bottom] = asset.processing.crop;
  assert.equal(left, 0); assert.equal(right, asset.photos[0].width);
  assert.ok(top >= 0 && top < bottom && bottom <= asset.photos[0].height);
});
