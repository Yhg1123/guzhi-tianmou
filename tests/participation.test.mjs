import test from "node:test";
import assert from "node:assert/strict";
import { makeContribution, contributionManifest, describeCoverage, validatePhotoBatch, siteIdentity, isStoredContribution, MAX_LIBRARY_BYTES } from "../src/participation.js";

const site = { id: "test-site", name: "试点遗址", lng: 108, lat: 34, isDemo: true };
const photo = (hash = "a".repeat(64)) => ({ file: new File(["fixture"], "capture.jpg", { type: "image/jpeg" }), thumbnail: new Blob(["preview"], { type: "image/jpeg" }), width: 1600, height: 1200, sha256: hash });
const input = (changes = {}) => ({ site, task: "capture", photos: [photo()], angle: "front", capturedOn: "2026-10-23", note: "线索", contributor: "参与者", rights: true, researchConsent: true, publicConsent: false, ...changes });
const create = (changes = {}, existing = []) => makeContribution(input(changes), existing, "2026-10-23T02:00:00Z", "test-id");

test("contributions preserve original photos, provenance, explicit permissions and local-only status", async () => {
  const fields = input();
  const record = makeContribution(fields, [], "2026-10-23T02:00:00Z", "test-id");
  assert.equal(record.status, "local_draft");
  assert.equal(record.photos[0].file, fields.photos[0].file);
  assert.equal(await record.photos[0].file.text(), "fixture");
  assert.equal(record.site.isDemo, true);
  assert.equal(record.consent.publicDisplay, false);
  assert.equal(record.consent.scope, "noncommercial_heritage_documentation_and_protection");
  assert.equal(record.capturedOn, "2026-10-23");
  assert.equal(isStoredContribution(record), true);
  assert.equal(create({ capturedOn: "", contributor: " " }).capturedOn, null);
  assert.equal(create({ contributor: " " }).contributor, "匿名参与者");
});

test("missing rights or use consent never creates a contribution", () => {
  assert.throws(() => create({ rights: false }), /权利/);
  assert.throws(() => create({ researchConsent: false }), /用途/);
  assert.throws(() => create({ site: null }), /遗址/);
  assert.throws(() => create({ task: "training" }), /任务/);
  assert.throws(() => create({ angle: "invented" }), /方向/);
  assert.throws(() => create({ capturedOn: "2026-02-31" }), /日期/);
});

test("exact duplicates are blocked in a batch and in prior submissions for the same site identity", () => {
  assert.throws(() => create({ photos: [photo(), photo()] }), /重复/);
  const first = create();
  assert.throws(() => create({}, [first]), /相同照片/);
  assert.doesNotThrow(() => create({ photos: [photo("b".repeat(64))] }, [first]));
});

test("coverage uses only local records for the exact site and preserves uncertainty", () => {
  const first = create();
  const unknown = create({ angle: "unknown", photos: [photo("b".repeat(64))] });
  const moved = create({ site: { ...site, lat: 35 } });
  const coverage = describeCoverage([first, unknown, moved], site);
  assert.equal(coverage.records, 2);
  assert.equal(coverage.photos, 2);
  assert.equal(coverage.counts.front, 1);
  assert.equal(coverage.counts.unknown, 1);
  assert.equal(coverage.counts.rear, 0);
  assert.notEqual(siteIdentity(site), siteIdentity(moved.site));
});

test("file limits and storage capacity are enforced before saving", () => {
  assert.throws(() => validatePhotoBatch([]), /选择照片/);
  assert.throws(() => validatePhotoBatch(Array.from({ length: 13 }, () => photo().file)), /最多/);
  assert.throws(() => validatePhotoBatch([{ name: "payload.svg", size: 100 }]), /JPG/);
  assert.throws(() => validatePhotoBatch([{ name: "empty.jpg", size: 0 }]), /20 MB/);
  assert.throws(() => validatePhotoBatch(Array.from({ length: 4 }, () => ({ name: "large.jpg", size: 20 * 1024 * 1024 }))), /60 MB/);
  assert.throws(() => create({}, [{ ...create(), bytes: MAX_LIBRARY_BYTES, photos: [] }]), /150 MB/);
  assert.throws(() => create({ photos: [{ ...photo(), sha256: "missing" }] }), /校验/);
});

test("exported manifests explicitly omit image bytes, while malformed saved records fail validation", () => {
  const record = create();
  const manifest = contributionManifest(record);
  assert.equal(manifest.includesPhotoBytes, false);
  assert.equal(manifest.photos[0].file, undefined);
  assert.equal(manifest.photos[0].thumbnail, undefined);
  assert.equal(manifest.photos[0].name, "capture.jpg");
  assert.equal(manifest.photos[0].sha256, record.photos[0].sha256);
  assert.match(manifest.limitations, /未经专家审核/);
  for (const malformed of [null, {}, { ...record, consent: null }, { ...record, bytes: 1 }, { ...record, photos: [] }, { ...record, createdAt: 5 }, { ...record, siteKey: "wrong-site" }]) assert.ok(!isStoredContribution(malformed));
});
