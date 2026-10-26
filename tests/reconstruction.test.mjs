import test from "node:test";
import assert from "node:assert/strict";
import { workspaceRoute, reconstructionRoute, siteModelKey, isSiteModel } from "../src/reconstruction.js";
import { heritageSample } from "../src/heritageSample.js";

test("3D links preserve the exact selected site through URL parsing and refresh", () => {
  for (const id of ["banpo", "遗址 A & B/?#", 0]) {
    assert.deepEqual(workspaceRoute("#" + reconstructionRoute(id)), { page: "reconstruction", siteId: String(id) });
  }
  assert.deepEqual(workspaceRoute("#map"), { page: "map", siteId: "" });
  assert.deepEqual(workspaceRoute("#unknown?site=banpo"), { page: "map", siteId: "" });
  assert.deepEqual(workspaceRoute("#reconstruction"), { page: "reconstruction", siteId: "" });
});

test("site model storage remains compatible and changes when site identity or coordinates change", () => {
  const site = { id: 0, lng: 109.052, lat: 34.277 };
  assert.equal(siteModelKey(site), "heritage-splat:0:109.052:34.277");
  assert.notEqual(siteModelKey({ ...site, id: 1 }), siteModelKey(site));
  assert.notEqual(siteModelKey({ ...site, lng: 109.053 }), siteModelKey(site));
  assert.equal(siteModelKey(null), null);
  assert.equal(siteModelKey({ ...site, lat: NaN }), null);
});

test("only valid local assets for the matching site are loaded; public cases are never substitutes", () => {
  const site = { id: "banpo", lng: 109.052, lat: 34.277 };
  const record = { name: "capture.splat", file: new Blob([new Uint8Array(32)]), site: { ...site } };
  assert.equal(isSiteModel(record, site), true);
  assert.equal(isSiteModel({ ...record, site: undefined }, site), true); // Earlier records are isolated by the existing storage key.
  assert.equal(isSiteModel(record, { ...site, id: "other" }), false);
  assert.equal(isSiteModel(record, { ...site, lat: 34.278 }), false);
  assert.equal(isSiteModel({ ...record, file: new Blob([]) }, site), false);
  assert.equal(isSiteModel({ ...record, file: {} }, site), false);
  assert.equal(isSiteModel({ ...record, name: "image.jpg" }, site), false);
  assert.equal(isSiteModel(heritageSample, site), false);
});
