import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { findSiteArchive, siteArchives } from "../src/siteArchives.js";
import { referenceSites } from "../src/referenceSites.js";
import { demoSites } from "../src/demoData.js";

const load = (url) => readFile(new URL("../public" + url, import.meta.url));
const hash = (data) => createHash("sha256").update(data).digest("hex");

test("frontend archive catalog and downloadable provenance stay identical", async () => {
  assert.deepEqual(JSON.parse(await load("/site-archives/catalog.json")), siteArchives);
});

test("bundled photo archives match only canonical site IDs, coordinates and names", () => {
  assert.equal(siteArchives.length, 8);
  assert.equal(new Set(siteArchives.map((asset) => asset.site.id)).size, 8);
  for (const asset of siteArchives) {
    assert.equal(findSiteArchive(asset.site), asset);
    assert.equal(findSiteArchive({ ...asset.site, name: asset.site.name + "（演示）" }), asset);
    for (const changed of [{ id: "other" }, { name: "另一处遗址" }, { lng: asset.site.lng + 0.001 }, { lat: NaN }]) {
      assert.equal(findSiteArchive({ ...asset.site, ...changed }), null);
    }
  }
  assert.equal(findSiteArchive(null), null);
  assert.equal(findSiteArchive({ id: "unknown" }), null);
  for (const site of [...demoSites, ...referenceSites]) assert.ok(findSiteArchive(site), site.name);
});

for (const asset of siteArchives) test(`${asset.id}: valid Gaussian geometry, original photos, depth and traceable licenses`, async () => {
  assert.equal(asset.representation, "photo-depth-gaussians");
  assert.equal(asset.generation.multiViewTraining, false);
  assert.equal(asset.generation.metricScale, false);
  assert.equal(asset.generation.georeferenced, false);
  assert.equal(asset.generation.modelLicense, "Apache-2.0");
  assert.match(asset.generation.codeRevision, /^[a-f0-9]{40}$/);
  assert.match(asset.generation.checkpointSha256, /^[a-f0-9]{64}$/);
  assert.equal(asset.license, asset.photos[0].license);
  assert.equal(asset.licenseUrl, asset.photos[0].licenseUrl);
  for (const photo of asset.photos) {
    assert.ok(photo.author && photo.sourceUrl.startsWith("https://commons.wikimedia.org/wiki/File:"));
    assert.match(photo.license, /^(CC0|Public domain|CC BY(?:-SA)? [234]\.0)$/);
    assert.equal(photo.originalUnmodified, true);
    const original = await load(photo.url);
    assert.equal(original.readUInt16BE(0), 0xffd8);
    assert.equal(original.length, photo.bytes);
    assert.equal(hash(original), photo.sha256);
  }
  const [bytes, depth, preview] = await Promise.all([load(asset.modelUrl), load(asset.depthUrl), load(asset.previewUrl)]);
  assert.equal(bytes.length, asset.bytes);
  assert.equal(bytes.length, asset.pointCount * 32);
  assert.equal(asset.pointCount, asset.processedWidth * asset.processedHeight);
  assert.equal(hash(bytes), asset.sha256);
  assert.equal(hash(depth), asset.depthSha256);
  assert.equal(hash(preview), asset.previewSha256);
  assert.equal(depth.subarray(1, 4).toString(), "PNG");
  assert.equal(depth.readUInt32BE(16), asset.processedWidth);
  assert.equal(depth.readUInt32BE(20), asset.processedHeight);
  assert.equal(preview.readUInt16BE(0), 0xffd8);
  let minZ = Infinity, maxZ = -Infinity;
  const colors = new Set();
  for (let at = 0; at < bytes.length; at += 32) {
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Number.isFinite(bytes.readFloatLE(at + axis * 4)));
      const scale = bytes.readFloatLE(at + 12 + axis * 4);
      assert.ok(scale > 0 && scale < 0.1);
    }
    const z = bytes.readFloatLE(at + 8);
    assert.ok(z < 0, "All points belong to the source photograph's visible side");
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    const norm = Math.hypot(...Array.from(bytes.subarray(at + 28, at + 32), (v) => (v - 128) / 128));
    assert.ok(Math.abs(norm - 1) < 0.015, "Gaussian quaternion must decode to a unit rotation");
    assert.equal(bytes[at + 27], 255);
    if (at % 320 === 0) colors.add(bytes.subarray(at + 24, at + 27).toString("hex"));
  }
  assert.ok(maxZ - minZ > 0.5, "Depth must carry inferred spatial variation, not a flat textured plane");
  assert.ok(colors.size > 500, "Original photographic color variation must be retained");
});

test("exhibit models and excavated objects are described as their actual photographic subjects", () => {
  assert.match(siteArchives.find((a) => a.id === "xianyang").subject, /陈列/);
  assert.match(siteArchives.find((a) => a.id === "daming").subject, /陈列模型/);
  assert.match(siteArchives.find((a) => a.id === "fenghao").subject, /出土.*甲骨/);
  assert.match(siteArchives.find((a) => a.id === "banpo").subject, /博物馆入口/);
});
