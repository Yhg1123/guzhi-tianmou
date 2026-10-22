import test from "node:test";
import assert from "node:assert/strict";
import { parseGeoJson } from "../src/geodata.js";
import { asGeoJson, emptyProject, replaceDataset, restoreProject, restoreStoredProject, serializeProject } from "../src/project.js";

const collection = (features) => JSON.stringify({ type: "FeatureCollection", features });
const point = (id, coordinates = [108, 34], name = "测试遗址") => ({ type: "Feature", ...(id === undefined ? {} : { id }), properties: { name }, geometry: { type: "Point", coordinates } });
const line = { type: "Feature", id: "river-1", properties: { name: "古河道", period: "秦汉", source: "调查报告", accuracy_m: 20 }, geometry: { type: "MultiLineString", coordinates: [[[108, 34], [109, 34]], [[108, 35], [109, 35]]] } };

test("site IDs survive export, reimport and row reordering, including numeric zero", () => {
  const features = [point("external-1"), point(0, [109, 34]), point(undefined, [110, 34])];
  const first = parseGeoJson(collection(features), "sites").features;
  const reordered = parseGeoJson(collection([...features].reverse()), "sites").features;
  assert.deepEqual(reordered.map((site) => site.id), first.map((site) => site.id).reverse());
  assert.equal(first[0].id, "external-1");
  assert.equal(first[1].id, "0");
  assert.deepEqual(parseGeoJson(JSON.stringify(asGeoJson("sites", first)), "sites").features, first);
  const propertyId = point(undefined);
  propertyId.properties.id = "catalog-1";
  assert.equal(parseGeoJson(collection([propertyId]), "sites").features[0].id, "catalog-1");
});

test("ambiguous or unsafe site IDs fail before replacing the layer", () => {
  for (const id of ["", " ", "__proto__", "constructor", "toString", {}, []]) {
    assert.throws(() => parseGeoJson(collection([point(id)]), "sites"), /ID/);
  }
  assert.throws(() => parseGeoJson(collection([point(1), point("1", [109, 34])]), "sites"), /重复/);
  assert.throws(() => parseGeoJson(collection([point(undefined), point(undefined)]), "sites"), /重复/);
});

test("invalid multiline features are skipped as a whole instead of silently losing a part", () => {
  const broken = structuredClone(line);
  broken.geometry.coordinates[1][0] = [999, 34];
  const parsed = parseGeoJson(collection([broken, { ...line, geometry: { type: "LineString", coordinates: [[108, 34], [109, 34]] } }]), "waterways");
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.features.length, 1);
  assert.equal(parsed.features[0].id, "river-1");
});

test("repeated backups retain line IDs, evidence attributes, polygon holes and notes", () => {
  let project = emptyProject();
  project.datasets.waterways = parseGeoJson(collection([line]), "waterways").features;
  project.datasets.boundaries = parseGeoJson(collection([{ type: "Feature", id: "zone", properties: { name: "范围", document_id: "report-2026" }, geometry: { type: "Polygon", coordinates: [[[108, 34], [109, 34], [109, 35], [108, 34]], [[108.1, 34.1], [108.2, 34.1], [108.2, 34.2], [108.1, 34.1]]] } }]), "boundaries").features;
  project.notes[project.datasets.sites[0].id] = "待核验";
  const expected = serializeProject(restoreProject(JSON.stringify(serializeProject(project))));
  for (let round = 0; round < 3; round++) project = restoreProject(JSON.stringify(serializeProject(project)));
  assert.deepEqual(serializeProject(project), expected);
  assert.equal(project.datasets.waterways[0].properties.source, "调查报告");
  assert.equal(project.datasets.waterways[0].properties.accuracy_m, 20);
  assert.equal(project.datasets.boundaries[0].geometry.coordinates.length, 2);
  assert.equal(project.datasets.boundaries[0].properties.document_id, "report-2026");
});

test("replacing sites keeps only notes with the same ID and coordinates", () => {
  const project = emptyProject();
  const [first, moved, removed] = project.datasets.sites;
  project.notes = { [first.id]: "保留", [moved.id]: "旧坐标", [removed.id]: "已移除" };
  const next = replaceDataset(project, "sites", [{ ...first, name: "更新名称" }, { ...moved, lat: moved.lat + 1 }], { name: "更新.geojson" });
  assert.deepEqual(next.notes, { [first.id]: "保留" });
  assert.equal(next.sources.sites.count, 2);
  assert.equal(Object.keys(project.notes).length, 3);
  assert.equal(replaceDataset(project, "routes", [], { name: "空" }).notes, project.notes);
});

test("an excessive combined workload fails atomically and keeps the previous project", () => {
  const project = emptyProject();
  const before = structuredClone(project);
  const oversized = [{ geometry: { type: "LineString", coordinates: Array.from({ length: 100002 }, () => [108, 34]) } }];
  assert.throws(() => replaceDataset(project, "routes", oversized, {}), /额度/);
  assert.deepEqual(project, before);
  assert.throws(() => replaceDataset(project, "sites", [], {}), /遗址点位/);
});

test("project restoration rejects broken structures, invalid IDs and unsupported CRS on empty layers", () => {
  for (const value of [null, [], {}, { schema: 1 }, { schema: 2, datasets: [], sources: {} }]) {
    assert.throws(() => restoreProject(JSON.stringify(value)), /有效/);
  }
  assert.throws(() => restoreProject("{broken"), /JSON/);
  for (const mutate of [
    (backup) => { backup.datasets.sites.features = {}; },
    (backup) => { delete backup.datasets.sites.features[0].id; },
    (backup) => { backup.datasets.sites.features[1].id = backup.datasets.sites.features[0].id; },
    (backup) => { backup.datasets.routes.crs = { properties: { name: "EPSG:3857" } }; },
    (backup) => { backup.sources.sites = []; },
    (backup) => { backup.notes = []; },
  ]) {
    const backup = serializeProject(emptyProject());
    mutate(backup);
    assert.throws(() => restoreProject(JSON.stringify(backup)));
  }
});

test("demo provenance cannot be removed by omitting the backup demoIds list", () => {
  const backup = serializeProject(emptyProject());
  delete backup.demoIds;
  assert.equal(restoreProject(JSON.stringify(backup)).datasets.sites.every((site) => site.isDemo), true);
});

test("stored projects are validated, and independent defaults cannot mutate each other", () => {
  const first = emptyProject();
  const second = emptyProject();
  first.datasets.sites[0].name = "已编辑";
  assert.notEqual(second.datasets.sites[0].name, first.datasets.sites[0].name);
  assert.equal(restoreStoredProject(undefined).datasets.sites.length, 5);
  assert.equal(restoreStoredProject(second).datasets.sites[0].id, second.datasets.sites[0].id);
  for (const saved of [null, {}, { schema: 2 }, { ...second, datasets: { ...second.datasets, sites: [{ ...second.datasets.sites[0], lat: 999 }] } }]) {
    assert.throws(() => restoreStoredProject(saved));
  }
});
