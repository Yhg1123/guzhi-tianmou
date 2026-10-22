import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { heritageSample } from "../src/heritageSample.js";

test("the bundled heritage preview matches its source manifest and preserves valid captured coordinates", async () => {
  const root = new URL("../public/samples/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("temple-of-bel-source.json", root), "utf8"));
  const metadata = JSON.parse(await readFile(new URL("temple-of-bel-metadata.json", root), "utf8"));
  const bytes = await readFile(new URL(manifest.file, root));
  assert.equal(bytes.length, manifest.bytes);
  assert.equal(bytes.length / 32, heritageSample.pointCount);
  assert.equal(manifest.points, heritageSample.pointCount);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.sha256);
  assert.equal(manifest.source, heritageSample.sourceUrl);
  assert.match(manifest.license, /CC BY/);
  assert.match(manifest.transformation, /No learned covariance/);
  const origin = metadata.boundingBox.min.map((min, axis) => (min + metadata.boundingBox.max[axis]) / 2);
  const sourceBounds = metadata.attributes.find((attribute) => attribute.name === "position");
  const colors = new Set();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < bytes.length; at += 32) {
    const xyz = [bytes.readFloatLE(at) + origin[0], -bytes.readFloatLE(at + 8) + origin[1], bytes.readFloatLE(at + 4) + origin[2]];
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Number.isFinite(xyz[axis]));
      // Decoded LOD extrema differ slightly from the publisher's attribute statistics.
      assert.ok(xyz[axis] >= sourceBounds.min[axis] - 0.002 && xyz[axis] <= sourceBounds.max[axis] + 0.002, `Decoded axis ${axis} outside source bounds`);
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
