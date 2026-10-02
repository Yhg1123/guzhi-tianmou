import { demoSites, demoSource } from "./demoData.js";
import { parseGeoJson, assertWorkload } from "./geodata.js";

export const DATASETS = [
  { id: "sites", title: "遗址点位与地形属性", geometry: "Point", purpose: "遗址档案", template: "heritage-sites" },
  { id: "waterways", title: "水系与古河道", geometry: "LineString / MultiLineString", purpose: "水文区位", template: "waterways" },
  { id: "routes", title: "交通与古道", geometry: "LineString / MultiLineString", purpose: "交通区位", template: "routes" },
  { id: "boundaries", title: "正式保护范围", geometry: "Polygon / MultiPolygon", purpose: "保护核查", template: "boundaries" },
  { id: "hazards", title: "灾害与建设影响区", geometry: "Polygon / MultiPolygon", purpose: "现状暴露", template: "hazards" },
];

export function emptyProject() {
  return { schema: 2, archiveId: crypto.randomUUID(), legacyArchiveMigration: false, datasets: { sites: demoSites.map((site) => ({ ...site })), waterways: [], routes: [], boundaries: [], hazards: [] }, sources: Object.fromEntries(DATASETS.map(({ id }) => [id, { name: id === "sites" ? demoSource : "未导入", count: id === "sites" ? 5 : 0, timing: "unknown", period: "", citation: "" }])), notes: {} };
}

// Upgrade the already stored project only. New/restored projects must never
// discover another project's legacy globally keyed model files.
export function ensureProjectIdentity(project) {
  if (project?.schema !== 2 || !project.sources || !DATASETS.every(({ id }) => Array.isArray(project.datasets?.[id]))) throw new Error("本地项目格式无效，原始数据未被覆盖。");
  if (Object.hasOwn(project, "archiveId") && (typeof project.archiveId !== "string" || !project.archiveId.length || project.archiveId.length > 4096)) throw new Error("本地项目档案标识无效，原始数据未被覆盖。");
  // Validate before enabling autosave; keep the stored representation unchanged.
  restoreProject(JSON.stringify(serializeProject(project)));
  return project.archiveId ? project : { ...project, archiveId: crypto.randomUUID(), legacyArchiveMigration: true };
}

const identity = (site) => JSON.stringify([site.name, site.period, site.type, site.location]);

export function reconcileSites(previous, incoming) {
  const used = new Set();
  const signatureCounts = new Map();
  const sourceIds = new Set();
  for (const site of incoming) {
    if (site.sourceId == null) continue;
    if (sourceIds.has(site.sourceId)) throw new Error("遗址原始 ID 重复，无法确定档案关联。");
    sourceIds.add(site.sourceId);
  }
  for (const site of incoming) signatureCounts.set(identity(site), (signatureCounts.get(identity(site)) || 0) + 1);
  return incoming.map((site) => {
    const direct = previous.filter((old) => old.id === site.id);
    if (direct.length && direct.some((old) => site.sourceId != null && (old.sourceId === undefined ? old.id.replace(/-\d+$/, "") : old.sourceId) !== site.sourceId)) throw new Error("遗址 ID 与旧版内部标识冲突，请使用原始数据 ID 或已导出的完整档案。");
    let matches = direct;
    if (!matches.length && site.sourceId != null) {
      matches = previous.filter((old) => old.sourceId === site.sourceId ||
        (old.sourceId === undefined && old.id.replace(/-\d+$/, "") === site.sourceId));
    }
    if (!matches.length && site.sourceId == null && signatureCounts.get(identity(site)) === 1) {
      matches = previous.filter((old) => old.sourceId == null && identity(old) === identity(site));
    }
    const old = matches.length === 1 && !used.has(matches[0].id) ? matches[0] : null;
    const id = old?.id || site.id;
    if (used.has(id)) throw new Error("遗址 ID 关联存在冲突，请核对原始 ID 后再导入。");
    used.add(id);
    return { ...site, id };
  });
}

export function replaceDataset(project, kind, features, source) {
  if (!DATASETS.some((dataset) => dataset.id === kind)) throw new Error("不支持的图层类型。");
  const datasets = { ...project.datasets, [kind]: kind === "sites" ? reconcileSites(project.datasets.sites, features) : features };
  assertWorkload(datasets.sites, datasets.waterways, datasets.routes, [...datasets.boundaries, ...datasets.hazards]);
  return { ...project, datasets, notes: { ...project.notes }, sources: { ...project.sources, [kind]: source } };
}

export function importDataset(project, kind, features, source, mode = "replace") {
  if (mode === "replace") return replaceDataset(project, kind, features, { ...source, count: features.length });
  if (mode !== "append") throw new Error("导入方式无效。");
  const existing = project.datasets[kind];
  if (!existing) throw new Error("不支持的图层类型。");
  if (!existing.length) return replaceDataset(project, kind, features, { ...source, count: features.length });
  if (kind === "sites") {
    const reconciled = reconcileSites(existing, features);
    if (reconciled.some((site) => existing.some((old) => old.id === site.id))) throw new Error("追加数据含重复遗址 ID 或重复档案；请修正 ID，或选择替换图层更新记录。");
  }
  const combined = [...existing, ...features];
  if (combined.length > 5000) throw new Error("追加后图层超过 5,000 个要素，请按研究区拆分。");
  const countVertices = (coordinates) => typeof coordinates?.[0] === "number" ? 1 : (coordinates || []).reduce((sum, part) => sum + countVertices(part), 0);
  if (kind !== "sites" && combined.reduce((sum, feature) => sum + countVertices(feature.geometry.coordinates), 0) > 100000) throw new Error("追加后图层超过 100,000 个顶点，请按研究区裁剪。");
  const previous = project.sources[kind];
  const imports = [...(previous.imports || [previous]), source].map(({ imports: _imports, ...entry }) => entry);
  const metadata = { name: `${previous.name} + ${source.name}`, count: combined.length, timing: "unknown", period: "", citation: "", sha256: "", importedAt: source.importedAt || "", imports };
  return replaceDataset(project, kind, combined, metadata);
}

export function asGeoJson(kind, features) {
  return { type: "FeatureCollection", features: kind === "sites" ? features.map((s) => ({ type: "Feature", id: s.id, geometry: { type: "Point", coordinates: [s.lng, s.lat] }, properties: { source_id: s.sourceId, legacy_identity: s.sourceId === undefined, name: s.name, period: s.period, site_type: s.type, location: s.location, source: s.recordSource, is_demo: Boolean(s.isDemo), elevation_m: s.elevation_m, slope_deg: s.slope_deg, aspect_deg: s.aspect_deg, tpi: s.tpi, terrain_source: s.terrainSource, precision_m: s.precision_m } })) : features };
}

export function serializeProject(project) {
  return { ...project, datasets: Object.fromEntries(DATASETS.map(({ id }) => [id, asGeoJson(id, project.datasets[id])])), demoIds: project.datasets.sites.filter((s) => s.isDemo).map((s) => s.id) };
}

export function restoreProject(text) {
  const input = JSON.parse(text);
  if (input.schema !== 2 || !input.datasets || !input.sources) throw new Error("不是有效的古址天眸项目文件（版本 2）。");
  const project = emptyProject();
  const oldIds = input.datasets.sites?.features?.map((f) => f.id == null ? null : String(f.id));
  for (const { id } of DATASETS) {
    const collection = input.datasets[id];
    if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) throw new Error("项目图层结构不完整。");
    if (id === "sites" && !collection.features.length) throw new Error("项目必须包含遗址点位。");
    const parsed = collection.features.length ? parseGeoJson(JSON.stringify(collection), id) : { features: [], skipped: 0 };
    if (parsed.skipped) throw new Error("项目含无效要素，请先修正数据；尚未替换当前项目。");
    project.datasets[id] = parsed.features;
    const source = input.sources[id] || {};
    project.sources[id] = { name: String(source.name || "项目导入"), count: project.datasets[id].length, timing: ["historical", "present", "unknown"].includes(source.timing) ? source.timing : "unknown", period: String(source.period || ""), citation: String(source.citation || ""), sha256: String(source.sha256 || ""), importedAt: String(source.importedAt || ""), ...(Array.isArray(source.imports) ? { imports: source.imports.map((entry) => ({ name: String(entry.name || ""), count: Number.isSafeInteger(entry.count) ? entry.count : 0, sha256: String(entry.sha256 || ""), importedAt: String(entry.importedAt || ""), timing: String(entry.timing || "unknown"), period: String(entry.period || ""), citation: String(entry.citation || "") })) } : {}) };
  }
  project.datasets.sites.forEach((site, index) => {
    const id = oldIds[index];
    if (!id || id === "undefined" || oldIds.indexOf(id) !== index || id === "__proto__" || id === "constructor") throw new Error("遗址 ID 缺失或重复。");
    site.id = id;
    if (!Object.hasOwn(input.datasets.sites.features[index].properties || {}, "source_id")) site.sourceId = undefined;
    site.isDemo = Array.isArray(input.demoIds) && input.demoIds.includes(id);
    const note = input.notes?.[id];
    if (typeof note === "string") project.notes[site.id] = note;
  });
  // Retain notes for removed sites; layer replacement must not erase fieldwork.
  for (const [id, note] of Object.entries(input.notes || {})) {
    if (["__proto__", "constructor", "prototype"].includes(id) || typeof note !== "string") throw new Error("项目笔记格式无效。");
    project.notes[id] = note;
  }
  assertWorkload(project.datasets.sites, project.datasets.waterways, project.datasets.routes, [...project.datasets.boundaries, ...project.datasets.hazards]);
  return project;
}

export function download(name, content, type = "application/json") {
  const blob = new Blob([typeof content === "string" ? content : JSON.stringify(content, null, 2)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fmt = (value, unit = "") => Number.isFinite(value) ? `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${unit}` : "待补充";

export const FACTORS = [
  { id: "historicWaterKm", title: "距同期水系", unit: "km", group: "水文区位", requirement: "分期古河道 / 古水体", method: "同期点到线最短球面距离", caution: "当前河道不可直接代表古河道；距离不等于可达性。", themes: ["settlement", "defense", "ritual"] },
  { id: "elevation_m", title: "地表高程", unit: "m", group: "地形条件", requirement: "DEM 采样属性 elevation_m", method: "导入 GIS 预计算点采样值", caution: "须核对垂直基准、DEM 分辨率与后期地貌变化。", themes: ["settlement", "defense", "ritual"] },
  { id: "slope_deg", title: "地形坡度", unit: "°", group: "地形条件", requirement: "DEM 派生属性 slope_deg", method: "导入 GIS 预计算坡度（角度）", caution: "不同 DEM 尺度结果不同，不设通用最优坡度。", themes: ["settlement", "defense"] },
  { id: "tpi", title: "地形位置指数", unit: "m", group: "地形条件", requirement: "相同邻域的 TPI 属性", method: "地表高程减邻域均值（外部计算）", caution: "正负值仅表示相对高低，必须记录邻域尺度。", themes: ["settlement", "defense", "ritual"] },
  { id: "historicRouteKm", title: "距同期交通线", unit: "km", group: "人文区位", requirement: "分期古道 / 交通廊道", method: "同期点到线最短球面距离", caution: "古道本身存在考证误差；不使用现代路网替代。", themes: ["settlement", "defense", "ritual"] },
  { id: "viewshed", title: "通视与可视域", unit: "", group: "视域格局", requirement: "DEM + 观察高度 + 遮挡条件", method: "待接入 GRASS r.viewshed", caution: "目前未计算；适合具体防御或景观问题。", themes: ["defense", "ritual"] },
];
