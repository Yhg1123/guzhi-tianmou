import test from "node:test";
import assert from "node:assert/strict";
import { displayPosition, displayPaths } from "../src/mapCoordinates.js";
import { containingAreas, nearestDistanceKm } from "../src/geodata.js";
import { emptyProject, serializeProject, restoreProject } from "../src/project.js";

test("Tencent display matches the upstream Beijing reference and preserves coordinate order", () => {
  // https://github.com/wandergis/coordtransform#示例用法exampleusage
  const input = Object.freeze([116.404, 39.915, 42]);
  const [lng, lat, height] = displayPosition(input);
  assert.ok(Math.abs(lng - 116.41024449916938) < 1e-10);
  assert.ok(Math.abs(lat - 39.91640428150164) < 1e-10);
  assert.equal(height, 42);
  assert.deepEqual(input, [116.404, 39.915, 42]);
});

test("OSM and overseas display preserve WGS84, including zero coordinates", () => {
  assert.deepEqual(displayPosition([116.404, 39.915], "osm"), [116.404, 39.915]);
  assert.deepEqual(displayPosition([-117.173, 32.719]), [-117.173, 32.719]);
  assert.deepEqual(displayPosition([0, 0]), [0, 0]);
  assert.throws(() => displayPosition([NaN, 39]));
  assert.throws(() => displayPosition([116, 91]));
});

test("display conversion preserves polygon holes and MultiPolygon topology without modifying originals", () => {
  const ring = [[116.4,39.9],[116.5,39.9],[116.5,40],[116.4,39.9]];
  const hole = [[116.42,39.92],[116.44,39.92],[116.44,39.94],[116.42,39.92]];
  const input = [[ring, hole], [ring]];
  const before = structuredClone(input);
  const result = displayPaths(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].length, 2);
  assert.equal(result[1].length, 1);
  assert.equal(result[0][1].length, 4);
  assert.deepEqual(result[0][0][0], result[0][0].at(-1));
  assert.notDeepEqual(result[0][0][0], input[0][0][0]);
  assert.deepEqual(input, before);
});

test("display conversion never changes spatial calculations or project backup coordinates", () => {
  const project = emptyProject();
  const site = { id: "source", name: "源点位", lng: 116.404, lat: 39.915 };
  const line = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[116.4,39.9],[116.4,40]] } };
  const area = { type: "Feature", properties: { name: "范围" }, geometry: { type: "Polygon", coordinates: [[[116.3,39.8],[116.5,39.8],[116.5,40],[116.3,40],[116.3,39.8]]] } };
  project.datasets.sites = [site]; project.datasets.waterways = [line]; project.datasets.boundaries = [area];
  const original = JSON.stringify(serializeProject(project));
  const distance = nearestDistanceKm(site, [line]);
  displayPosition([site.lng, site.lat]); displayPaths(line.geometry.coordinates); displayPaths(area.geometry.coordinates);
  assert.equal(nearestDistanceKm(site, [line]), distance);
  assert.deepEqual(containingAreas(site, [area]), ["范围"]);
  assert.equal(JSON.stringify(serializeProject(project)), original);
  assert.equal(restoreProject(original).datasets.sites[0].lng, 116.404);
});
