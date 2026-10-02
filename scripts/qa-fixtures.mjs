import { mkdir, writeFile, readFile } from "node:fs/promises";
import { emptyProject, serializeProject } from "../src/project.js";
import { createSampleSplat } from "../src/sampleSplat.js";

await mkdir("qa", { recursive: true });
await writeFile("qa/demo-project.json", JSON.stringify(serializeProject(emptyProject()), null, 2));
await writeFile("qa/calibration.splat", Buffer.from(await createSampleSplat().arrayBuffer()));
const collection = JSON.parse(await readFile("public/templates/heritage-sites.geojson", "utf8"));
collection.features.push({ type: "Feature", properties: { name: "虚构样本 B", is_demo: true, period: "第二时期", site_type: "聚落", tpi: -6, slope_deg: 0, elevation_m: 380, terrain_source: "合成测试值" }, geometry: { type: "Point", coordinates: [108.96, 34.285] } });
await writeFile("qa/test-sites.geojson", JSON.stringify(collection, null, 2));
await writeFile("qa/invalid.geojson", '{"type":"invalid"}');
console.log("QA fixtures ready");
