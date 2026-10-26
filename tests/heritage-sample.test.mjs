import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pointCloudSamples } from "../src/heritageSample.js";

for (const heritageSample of pointCloudSamples) test(heritageSample.title + ": bundled preview matches its source and retains captured XYZ/RGB", async () => {
  const root = new URL("../public/samples/", import.meta.url);
  const stem = heritageSample.url.split("/").at(-1).replace(".splat", "");
  const manifest = JSON.parse(await readFile(new URL(stem + "-source.json", root), "utf8"));
  const metadata = JSON.parse(await readFile(new URL(stem + "-metadata.json", root), "utf8"));
  const bytes = await readFile(new URL(manifest.file, root));
  assert.equal(bytes.length, manifest.bytes);
  assert.equal(bytes.length / 32, heritageSample.pointCount);
  assert.equal(manifest.points, heritageSample.pointCount);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.sha256);
  assert.equal(manifest.source, heritageSample.sourceUrl);
  assert.match(manifest.license, /CC BY/);
  assert.match(manifest.transformation, /No learned covariance/);
  const origin = metadata.boundingBox.min.map((min, axis) => (min + metadata.boundingBox.max[axis]) / 2);
  // Attribute statistics omit some sampled LOD extrema in the ship dataset.
  // Root bounds plus two quantization steps cover the actual encoded coordinates.
  const sourceBounds = metadata.boundingBox;
  const tolerance = Math.max(...metadata.scale) * 2 + 0.00001;
  const colors = new Set();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < bytes.length; at += 32) {
    const xyz = [bytes.readFloatLE(at) + origin[0], -bytes.readFloatLE(at + 8) + origin[1], bytes.readFloatLE(at + 4) + origin[2]];
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Number.isFinite(xyz[axis]));
      assert.ok(xyz[axis] >= sourceBounds.min[axis] - tolerance && xyz[axis] <= sourceBounds.max[axis] + tolerance, `Decoded axis ${axis} outside source bounds`);
      const radius = bytes.readFloatLE(at + 12 + axis * 4);
      assert.ok(radius > 0 && radius < metadata.spacing);
      min[axis] = Math.min(min[axis], xyz[axis]);
      max[axis] = Math.max(max[axis], xyz[axis]);
    }
    assert.equal(bytes[at + 27], 255);
    if (at % 320 === 0) colors.add(bytes.subarray(at + 24, at + 27).toString("hex"));
  }
  assert.ok(max.every((value, axis) => value - min[axis] > 5), "The preview must retain a three-dimensional building volume");
  assert.ok(colors.size > 1000, "The preview must retain real color variation");
});
