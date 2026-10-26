import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { trainedGaussianCases, gaussianCaseRoute, gaussianCaseId } from "../src/trainedGaussians.js";
import { workspaceRoute } from "../src/reconstruction.js";

test("independent Gaussian scene links preserve project-site identity without pretending to match it", () => {
  for (const id of ["seem-church", "lingyue", "a & b/#"]) {
    const route = gaussianCaseRoute(id, "遗址 & A");
    assert.equal(gaussianCaseId("#" + route), id);
    assert.deepEqual(workspaceRoute("#" + route), { page: "reconstruction", siteId: "遗址 & A" });
  }
  assert.equal(gaussianCaseId("#map?case=lingyue"), "");
  assert.equal(gaussianCaseId("#reconstruction?site=demo-xianyang"), "");
  assert.equal(gaussianCaseId("#" + gaussianCaseRoute("lingyue")), "lingyue");
  assert.ok(trainedGaussianCases.every((scene) => !scene.site && !scene.siteId && scene.trainedInThisApp === false));
});

test("online Chinese heritage scene uses the publisher's public embed without redistributing a closed-download asset", () => {
  const scene = trainedGaussianCases.find((scene) => scene.id === "lingyue");
  assert.equal(scene.delivery, "online");
  assert.equal(scene.embedUrl, "https://superspl.at/s?id=073bac93");
  assert.equal(scene.url, undefined);
  assert.match(scene.license, /文件未开放下载/);
  assert.match(scene.heritageSourceUrl, /^https:\/\/wwj\.beijing\.gov\.cn\//);
});

test("local scene retains trained 3D Gaussian covariance, rotation and alpha across a full spatial volume", async () => {
  const scene = trainedGaussianCases.find((scene) => scene.id === "seem-church");
  const manifest = JSON.parse(await readFile(new URL("../public" + scene.sourceManifest, import.meta.url), "utf8"));
  const bytes = await readFile(new URL("../public" + scene.url, import.meta.url));
  assert.equal(manifest.representation, "trained-3dgs");
  assert.equal(manifest.trainedByAuthor, true);
  assert.equal(manifest.trainedInThisApp, false);
  assert.equal(manifest.license, "CC BY 4.0");
  assert.equal(bytes.length, manifest.bytes);
  assert.equal(bytes.length, 960991 * 32);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.sha256);
  const alpha = new Set(), rotations = new Set();
  let anisotropic = 0, translucent = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < bytes.length; at += 32) {
    const scales = [];
    for (let axis = 0; axis < 3; axis++) {
      const p = bytes.readFloatLE(at + axis * 4), scale = bytes.readFloatLE(at + 12 + axis * 4);
      assert.ok(Number.isFinite(p) && Number.isFinite(scale) && scale > 0);
      lo[axis] = Math.min(lo[axis], p); hi[axis] = Math.max(hi[axis], p); scales.push(scale);
    }
    if (Math.max(...scales) / Math.min(...scales) > 3) anisotropic++;
    const a = bytes[at + 27]; alpha.add(a); if (a > 5 && a < 250) translucent++;
    if (at % 320 === 0) rotations.add(bytes.subarray(at + 28, at + 32).toString("hex"));
    const norm = Math.hypot(...Array.from(bytes.subarray(at + 28, at + 32), (v) => (v - 128) / 128));
    assert.ok(Math.abs(norm - 1) < 0.015);
  }
  assert.deepEqual(lo, manifest.bounds.min); assert.deepEqual(hi, manifest.bounds.max);
  assert.ok(hi.every((value, i) => value - lo[i] > 25), "The scene must occupy a real 3D volume");
  assert.ok(alpha.size > 200 && translucent > manifest.pointCount * 0.2, "Learned opacity must not be replaced by opaque point samples");
  assert.ok(anisotropic > manifest.pointCount * 0.2 && rotations.size > 1000, "Preserve trained anisotropic covariance and orientation");
  assert.equal(manifest.sourceFiles.length, 8);
  for (const source of manifest.sourceFiles) { assert.match(source.sha256, /^[a-f0-9]{64}$/); assert.ok(source.bytes > 0); }
  const preview = await readFile(new URL("../public" + scene.previewUrl, import.meta.url));
  assert.equal(createHash("sha256").update(preview).digest("hex"), manifest.previewSha256);
});
