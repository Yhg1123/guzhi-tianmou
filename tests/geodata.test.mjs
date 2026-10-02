import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSites, distanceDistribution, parseGeoJson, historicalDistance, containingAreas, investigationBuffer, assertWorkload } from "../src/geodata.js";
import { emptyProject, serializeProject, restoreProject } from "../src/project.js";
import { createSampleSplat } from "../src/sampleSplat.js";
import { summarize, barPosition } from "../src/statistics.js";

const sitesText = JSON.stringify({
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { name: "测试遗址", period: "秦汉", site_type: "城址" }, geometry: { type: "Point", coordinates: [108.95, 34.28] } },
    { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [] } },
  ],
});
const riversText = JSON.stringify({
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "LineString", coordinates: [[108.9, 34.29], [109, 34.29]] }, properties: { name: "测试水系" } },
  ],
});

test("imports WGS84 point and line data, reporting skipped geometry", () => {
  const sites = parseGeoJson(sitesText, "sites");
  const rivers = parseGeoJson(riversText, "waterways");
  assert.equal(sites.features.length, 1);
  assert.equal(sites.skipped, 1);
  assert.equal(sites.features[0].name, "测试遗址");
  assert.equal(rivers.features.length, 1);
});

test("computes actual point-to-line distance and distribution", () => {
  const sites = parseGeoJson(sitesText, "sites").features;
  const rivers = parseGeoJson(riversText, "waterways").features;
  const analyzed = analyzeSites(sites, rivers, []);
  assert.ok(analyzed[0].waterDistanceKm > 1);
  assert.ok(analyzed[0].waterDistanceKm < 1.2);
  assert.equal(analyzed[0].routeDistanceKm, null);
  assert.equal(distanceDistribution(analyzed).count, 1);
});

test("rejects unsupported coordinate reference systems and empty layers", () => {
  assert.throws(() => parseGeoJson(JSON.stringify({ type: "FeatureCollection", crs: { properties: { name: "EPSG:3857" } }, features: [] }), "sites"), /4326/);
  assert.throws(() => parseGeoJson("{bad json}", "sites"), /JSON/);
  assert.throws(() => parseGeoJson(JSON.stringify({ type: "FeatureCollection", features: [] }), "waterways"), /没有有效/);
});

test("historical factors exclude modern and mismatched periods", () => {
  const site = parseGeoJson(sitesText, "sites").features[0];
  const rivers = parseGeoJson(riversText, "waterways").features;
  assert.equal(historicalDistance(site, rivers, { timing: "present", period: "秦汉" }), null);
  assert.equal(historicalDistance(site, rivers, { timing: "historical", period: "唐" }), null);
  assert.ok(historicalDistance(site, rivers, { timing: "historical", period: "秦汉" }) > 1);
  rivers[0].properties.period = "唐";
  assert.equal(historicalDistance(site, rivers, { timing: "historical", period: "秦汉" }), null);
});

test("terrain zero remains a measurement; invalid units/ranges stay missing", () => {
  const collection = JSON.parse(sitesText);
  Object.assign(collection.features[0].properties, { elevation_m: 0, slope_deg: -1, aspect_deg: 361, tpi: -8 });
  const site = parseGeoJson(JSON.stringify(collection), "sites").features[0];
  assert.equal(site.elevation_m, 0);
  assert.equal(site.slope_deg, null);
  assert.equal(site.aspect_deg, null);
  assert.equal(site.tpi, -8);
});

test("polygon containment distinguishes missing layers, holes, inside and outside", () => {
  const rings = [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]], [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]]];
  const collection = { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "area" }, geometry: { type: "Polygon", coordinates: rings } }] };
  const polygons = parseGeoJson(JSON.stringify(collection), "hazards").features;
  assert.deepEqual(containingAreas({ lng: 1, lat: 1 }, polygons), ["area"]);
  assert.deepEqual(containingAreas({ lng: 0.5, lat: 0.5 }, polygons), []);
  assert.deepEqual(containingAreas({ lng: 3, lat: 3 }, polygons), []);
  assert.equal(containingAreas({ lng: 1, lat: 1 }, []), null);
  rings[0].pop();
  assert.throws(() => parseGeoJson(JSON.stringify(collection), "boundaries"), /闭合/);
});

test("reference buffer has explicit non-statutory status and validates range", () => {
  const site = { id: "test", name: "A", lng: 108.95, lat: 34.28, isDemo: true };
  const polygon = investigationBuffer(site, 500);
  assert.equal(polygon.geometry.type, "Polygon");
  assert.equal(polygon.properties.radius_m, 500);
  assert.match(polygon.properties.purpose, /非法定/);
  assert.equal(investigationBuffer(site, 0), null);
});

test("workload counts line vertices, not just feature count", () => {
  const lines = [{ geometry: { coordinates: Array.from({ length: 1001 }, () => [0, 0]) } }];
  assert.throws(() => assertWorkload(Array(501), lines, []), /额度/);
});

test("project backup preserves IDs, demo markers, notes and validates before restore", () => {
  const project = emptyProject();
  project.notes[project.datasets.sites[0].id] = "测试笔记";
  const restored = restoreProject(JSON.stringify(serializeProject(project)));
  assert.equal(restored.datasets.sites[0].id, project.datasets.sites[0].id);
  assert.equal(restored.datasets.sites[0].isDemo, true);
  assert.equal(restored.notes[restored.datasets.sites[0].id], "测试笔记");
  const broken = serializeProject(project);
  broken.datasets.sites.features[0].geometry.coordinates = [999, 999];
  assert.throws(() => restoreProject(JSON.stringify(broken)), /无效/);
});

test("point export and reimport preserve explicit demo provenance", () => {
  const collection = serializeProject(emptyProject()).datasets.sites;
  const sites = parseGeoJson(JSON.stringify(collection), "sites").features;
  assert.equal(sites.every((s) => s.isDemo), true);
});

test("synthetic 3D sample contains finite standard splats", async () => {
  const blob = createSampleSplat();
  const data = await blob.arrayBuffer();
  assert.equal(data.byteLength % 32, 0);
  assert.ok(data.byteLength / 32 > 5000);
  for (let offset = 0; offset < data.byteLength; offset += 32) {
    const values = new Float32Array(data, offset, 6);
    assert.ok(Array.from(values).every(Number.isFinite));
    assert.ok(values[3] > 0);
  }
});

test("summary excludes missing values and handles negative and zero terrain values", () => {
  assert.equal(summarize([null, undefined, NaN]), null);
  assert.deepEqual(summarize([0, null, -8, 2, 4]), { count: 4, min: -8, max: 4, median: 1 });
  const stats = summarize([-8, 4]);
  const negative = barPosition(-8, stats);
  assert.equal(negative.left, 0);
  assert.ok(negative.width > 66 && negative.width < 67);
  assert.equal(barPosition(0, stats).width, 0);
  assert.equal(barPosition(null, stats).width, 0);
});
