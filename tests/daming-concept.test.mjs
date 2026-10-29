import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { generatedConceptCandidate, findGeneratedConcept } from "../src/generatedConcepts.js";
import { canPublishGaussian } from "../src/gaussianQuality.js";
import { gaussianViewPose, gaussianBoundsPose } from "../src/gaussianNavigation.js";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const asset = (url) => readFile(new URL("../public" + url, import.meta.url));

test("Daming's display is an actually trained generated-view concept with truthful provenance and a hash-bound visual review", async () => {
  const scene = generatedConceptCandidate;
  assert.ok(scene && canPublishGaussian(scene));
  assert.equal(scene.interpretation, "architectural-concept");
  assert.equal(scene.inputKind, "locally-authored-multiview-renders");
  assert.equal(scene.notCapturedPhotographs, true); assert.equal(scene.notSurveyedRestoration, true);
  assert.equal(scene.metricScaleVerified, false); assert.equal(scene.georeferenced, false);
  assert.equal(scene.trainedInThisApp, true); assert.equal(scene.trainedByAuthor, false);
  const source = JSON.parse(await asset(scene.sourceManifest));
  const run = JSON.parse(await asset(scene.trainingRecordUrl));
  const log = await asset(scene.trainingLogUrl);
  assert.equal(source.preparation.notSingleImageDepth, true);
  assert.equal(source.preparation.notImportedFinishedModel, true);
  assert.equal(source.preparation.authoringScriptSha256, sha(await readFile(new URL("../scripts/build-daming-concept.py", import.meta.url))));
  assert.equal(run.status, "completed"); assert.equal(run.exitCode, 0); assert.equal(run.completedSteps, 24000);
  assert.match(log.toString(), /Done training!/); assert.match(log.toString(), /NVIDIA GeForce RTX 3050 Laptop GPU/);
  assert.equal(sha(log), run.trainingLogSha256);
  assert.ok(Date.parse(run.endedAt) > Date.parse(run.startedAt));
  assert.equal(run.generatedViewCount, 104); assert.equal(run.trainingViews, 91); assert.equal(run.validationViews, 13);
  const views = source.preparation.views;
  assert.equal(views.length, 104); assert.equal(new Set(views.map((v) => v.sha256)).size, 104);
  assert.equal(views.filter((v) => v.split === "train").length, 91);
  assert.equal(views.filter((v) => v.split === "validation").length, 13);
  assert.equal(new Set(views.slice(0, 24).map((v) => v.azimuth)).size, 24);
  assert.ok(views.some((v) => v.elevation >= 75) && views.some((v) => v.elevation < 0));
  assert.ok(views.every((v) => v.name.startsWith("hanyuan_") && v.frame.file_path === "images/" + v.name));
  assert.equal(scene.qualityReview.modelSha256, scene.rawSha256);
  assert.equal(source.qualityReview.status, "accepted");
  assert.equal(source.sha256, scene.sha256);
  for (const view of scene.views) assert.equal(sha(await asset(view.url)), view.sha256);
  assert.equal(sha(await asset(scene.visualReferenceUrl)), scene.visualReferenceSha256);
});

test("the Daming PLY retains learned 3D Gaussian volume, covariance, opacity, rotation and SH", async () => {
  const scene = generatedConceptCandidate;
  const bytes = await asset(scene.url);
  assert.equal(bytes.length, scene.bytes); assert.equal(sha(bytes), scene.rawSha256);
  const offset = bytes.indexOf("end_header\n") + 11, header = bytes.subarray(0, offset).toString();
  assert.match(header, /SH degree: 1/);
  const names = header.split("\n").filter((v) => v.startsWith("property float ")).map((v) => v.split(" ").at(-1));
  const count = Number(header.match(/element vertex (\d+)/)[1]);
  assert.equal(count, scene.pointCount); assert.equal(names.length, 23); assert.equal(bytes.length - offset, count * 92);
  const field = (i, name) => bytes.readFloatLE(offset + (i * 23 + names.indexOf(name)) * 4);
  const alpha = new Set(), rotations = new Set(), shValues = new Set(); let anisotropic = 0;
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (const name of names) assert.ok(Number.isFinite(field(i, name)));
    ["x", "y", "z"].forEach((name, j) => { const v = field(i, name); low[j] = Math.min(low[j], v); high[j] = Math.max(high[j], v); });
    const scales = [0, 1, 2].map((j) => Math.exp(field(i, "scale_" + j)));
    assert.ok(scales.every((s) => Number.isFinite(s) && s > 0));
    if (Math.max(...scales) > Math.min(...scales) * 2) anisotropic++;
    if (i % 47 === 0) { alpha.add(field(i, "opacity").toFixed(3)); rotations.add([0, 1, 2, 3].map((j) => field(i, "rot_" + j).toFixed(2)).join(",")); shValues.add(field(i, "f_rest_0").toFixed(3)); }
  }
  assert.ok(high[0] - low[0] > 70 && high[1] - low[1] > 10 && high[2] - low[2] > 35, "The model must contain a real 3D building group, not a depth sheet");
  assert.ok(anisotropic > count * 0.1 && alpha.size > 50 && rotations.size > 50 && shValues.size > 20, "Learned Gaussian fields must not become uniform opaque point samples");
  assert.deepEqual(low, scene.bounds.min); assert.deepEqual(high, scene.bounds.max);
});

test("the generated concept matches only Daming's canonical archive; imports and other sites remain independent", () => {
  const scene = generatedConceptCandidate, site = { ...scene.site };
  assert.equal(findGeneratedConcept(site)?.id, "daming-hanyuan");
  assert.equal(findGeneratedConcept({ ...site, id: "demo-xianyang" }), undefined);
  assert.equal(findGeneratedConcept({ ...site, lng: site.lng + 0.001 }), undefined);
  assert.equal(findGeneratedConcept({ ...site, name: "另一处遗址" }), undefined);
  assert.equal(findGeneratedConcept({ ...site, name: site.name + "（演示）" })?.id, scene.id);
  assert.equal(findGeneratedConcept(null), undefined);
});

test("whole-building cameras contain the bounds and actual Gaussian support in wide and portrait viewports", async () => {
  const scene = generatedConceptCandidate;
  const bytes = await asset(scene.url), offset = bytes.indexOf("end_header\n") + 11;
  const fields = bytes.subarray(0, offset).toString().split("\n").filter((v) => v.startsWith("property float ")).map((v) => v.split(" ").at(-1));
  const indices = ["x", "y", "z"].map((name) => fields.indexOf(name));
  const cloud = Array.from({ length: scene.pointCount }, (_, i) => indices.map((j) => bytes.readFloatLE(offset + i * 92 + j * 4)));
  const support = cloud.filter((_, i) => i % Math.ceil(scene.pointCount / 20000) === 0);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (v) => v.map((n) => n / Math.hypot(...v));
  for (const aspect of [0.5, 0.8, 1.5, 2.5, 3.5]) for (const preset of ["capture", "left", "back", "right", "top"]) {
    const source = scene.viewpoints[preset] || gaussianViewPose(scene.camera, preset, 1.5);
    const pose = gaussianBoundsPose(scene.bounds, source, aspect);
    const direction = unit(pose.position.map((v, i) => v - pose.target[i]));
    const right = unit(cross([0, 1, 0], direction)), up = unit(cross(direction, right));
    const vertical = Math.tan(pose.fov * Math.PI / 360);
    let occupancy = 0;
    for (const x of [scene.bounds.min[0], scene.bounds.max[0]]) for (const y of [scene.bounds.min[1], scene.bounds.max[1]]) for (const z of [scene.bounds.min[2], scene.bounds.max[2]]) {
      const offset = [x, y, z].map((v, i) => v - pose.position[i]), depth = -dot(offset, direction);
      assert.ok(depth > 0);
      const fraction = Math.max(Math.abs(dot(offset, right)) / (depth * vertical * aspect), Math.abs(dot(offset, up)) / (depth * vertical));
      assert.ok(fraction < 0.94, `${preset} fits aspect ${aspect}`); occupancy = Math.max(occupancy, fraction);
    }
    assert.ok(occupancy > 0.72, "The default should use the available viewport instead of leaving excessive empty space");
    const fitted = gaussianBoundsPose(scene.bounds, source, aspect, 1.12, support);
    for (const point of cloud) {
      const offset = point.map((v, i) => v - fitted.position[i]), depth = -dot(offset, direction);
      assert.ok(depth > 0);
      assert.ok(Math.abs(dot(offset, right)) < depth * vertical * aspect && Math.abs(dot(offset, up)) < depth * vertical, "Sample-based fitting must still contain every original Gaussian center");
    }
  }
});
