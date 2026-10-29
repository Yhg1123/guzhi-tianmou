import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { canPublishGaussian, matchesGaussianSite } from "../src/gaussianQuality.js";
import { gaussianCaptureProjection } from "../src/gaussianNavigation.js";
import { experimentalGaussianCases, trainedGaussianCases, gaussianCaseId } from "../src/trainedGaussians.js";

test("completed training cannot bypass failed, missing or outdated visual acceptance", () => {
  const scene = experimentalGaussianCases[0];
  assert.equal(canPublishGaussian(scene), false);
  assert.equal(trainedGaussianCases.length, 0);
  assert.equal(gaussianCaseId("#reconstruction"), "");
  assert.equal(gaussianCaseId("#reconstruction?site=demo-daming"), "");
  assert.equal(gaussianCaseId("#reconstruction?case=local-cb&site=demo-daming"), "local-cb");
  const accepted = { ...scene, qualityReview: { ...scene.qualityReview, status: "accepted", checks: { structure: true, novelViews: true, floaters: true, subjectIdentity: true } } };
  assert.equal(canPublishGaussian(accepted), true);
  assert.equal(canPublishGaussian({ ...accepted, rawSha256: "changed" }), false);
  assert.equal(canPublishGaussian({ ...accepted, qualityReview: { ...accepted.qualityReview, sceneId: "other" } }), false);
  assert.equal(canPublishGaussian({ ...accepted, rawSha256: undefined, qualityReview: { ...accepted.qualityReview, modelSha256: undefined } }), false);
  assert.equal(canPublishGaussian({ ...accepted, qualityReview: undefined }), false);
  assert.equal(canPublishGaussian({ ...accepted, training: { status: "running" } }), false);
  assert.equal(canPublishGaussian({ ...accepted, qualityReview: { ...accepted.qualityReview, checks: { ...accepted.qualityReview.checks, novelViews: false } } }), false);
  const site = { id: "target", lng: 0, lat: 0 };
  assert.equal(matchesGaussianSite(accepted, site), false, "An independent experiment is never a substitute for the selected site");
  assert.equal(matchesGaussianSite({ ...accepted, site }, site), true);
  assert.equal(matchesGaussianSite({ ...accepted, site }, { ...site, lat: 0.01 }), false);
  assert.equal(matchesGaussianSite({ ...accepted, site }, { ...site, id: "other" }), false);
  assert.equal(matchesGaussianSite({ ...scene, site }, site), false);
});

test("diagnostic source cameras preserve original withheld poses and portrait calibration", async () => {
  const scene = experimentalGaussianCases[0];
  const source = JSON.parse(await readFile(new URL("../public" + scene.sourceManifest, import.meta.url), "utf8"));
  for (const view of scene.captureViews) {
    const photo = source.preparation.photographs.find((p) => p.name === view.name);
    assert.equal(photo.split, "validation");
    const m = photo.frame.transform_matrix;
    assert.deepEqual(view.position, m.slice(0, 3).map((row) => row[3]));
    assert.deepEqual(view.up, m.slice(0, 3).map((row) => row[photo.orientation ? 0 : 1]));
    assert.deepEqual(view.target, view.position.map((v, i) => v - m[i][2] * 10));
    assert.equal(view.originalSha256, photo.sha256);
    assert.equal(createHash("sha256").update(await readFile(new URL("../public" + view.inputUrl, import.meta.url))).digest("hex"), view.inputSha256);
    const K = source.preparation.processedIntrinsics;
    assert.equal(view.intrinsics.cx, photo.orientation ? K[1][2] : K[0][2]);
    assert.equal(view.intrinsics.cy, photo.orientation ? source.preparation.dimensions[0] - K[0][2] : K[1][2]);
  }
});

test("capture contain fitting keeps the camera fixed and preserves optical center at wide and portrait sizes", () => {
  for (const capture of experimentalGaussianCases[0].captureViews) for (const aspect of [2.2, 1.5, 0.46]) {
    const k = capture.intrinsics;
    const projection = gaussianCaptureProjection(k, aspect);
    const near = 0.01, height = Math.max(k.height, k.width / aspect), width = height * aspect;
    const x = k.cx + (width - k.width) / 2, y = k.cy + (height - k.height) / 2;
    assert.ok(Math.abs((projection.right - projection.left) / (projection.top - projection.bottom) - aspect * k.fy / k.fx) < 1e-10);
    assert.ok(Math.abs(projection.left + x / k.fx * near) < 1e-12);
    assert.ok(Math.abs(projection.top - y / k.fy * near) < 1e-12);
    assert.ok(x >= k.cx && y >= k.cy, "The supported photo frame is contained without moving the source camera");
  }
  assert.throws(() => gaussianCaptureProjection({ width: 0 }, 1));
});
