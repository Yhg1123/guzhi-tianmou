import { pointToLineDistance } from "@turf/point-to-line-distance";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { buffer } from "@turf/buffer";

const MAX_FEATURES = 5000;

function validPosition(position) {
  return Array.isArray(position)
    && position.length >= 2
    && Number.isFinite(position[0])
    && Number.isFinite(position[1])
    && position[0] >= -180
    && position[0] <= 180
    && position[1] >= -90
    && position[1] <= 90;
}

function property(properties, keys, fallback) {
  for (const key of keys) {
    const value = properties?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

export function parseGeoJson(text, kind) {
  if (!["sites", "waterways", "routes", "boundaries", "hazards"].includes(kind)) throw new Error("不支持的图层类型。");
  let collection;
  try {
    collection = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON。请从 GIS 软件导出 GeoJSON。 ");
  }

  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error("需要 GeoJSON FeatureCollection 文件。");
  }
  if (collection.crs && !/4326|CRS84/i.test(JSON.stringify(collection.crs))) {
    throw new Error("请先将图层转换为 WGS84 / EPSG:4326，再导出 GeoJSON。");
  }
  if (collection.features.length > MAX_FEATURES) {
    throw new Error(`单个文件最多支持 ${MAX_FEATURES.toLocaleString()} 个要素。`);
  }

  const features = [];
  let skipped = 0;
  let vertices = 0;
  const siteIds = new Set();

  collection.features.forEach((feature, index) => {
    const geometry = feature?.geometry;
    const properties = feature?.properties || {};
    if (kind === "sites") {
      if (geometry?.type !== "Point" || !validPosition(geometry.coordinates)) {
        skipped += 1;
        return;
      }
      const [lng, lat] = geometry.coordinates;
      const explicit = feature.id ?? properties.id;
      if (explicit != null && !(["string", "number"].includes(typeof explicit) && String(explicit).trim() && String(explicit).length <= 4096 && !["__proto__", "constructor", "prototype"].includes(String(explicit)))) throw new Error("遗址 ID 无效，请提供唯一的文字或数字 ID。");
      const id = explicit == null ? `site-${crypto.randomUUID()}` : String(explicit);
      if (siteIds.has(id)) throw new Error("遗址 ID 重复，请为每处遗址提供唯一 ID。");
      siteIds.add(id);
      features.push({
        id,
        sourceId: properties.legacy_identity === true ? undefined : properties.source_id === null || explicit == null ? null : String(properties.source_id ?? explicit),
        name: property(properties, ["name", "名称", "遗址名称"], `未命名遗址 ${index + 1}`),
        period: property(properties, ["period", "年代", "时期"], "未填写"),
        type: property(properties, ["site_type", "type", "类型", "遗址类型"], "未填写"),
        location: property(properties, ["location", "地址", "地点"], "未填写"),
        recordSource: property(properties, ["source", "数据来源"], "导入文件"),
        lat,
        lng,
        isDemo: properties.is_demo === true,
        elevation_m: numeric(properties.elevation_m, -500, 9000),
        slope_deg: numeric(properties.slope_deg, 0, 90),
        aspect_deg: numeric(properties.aspect_deg, 0, 360),
        tpi: numeric(properties.tpi, -10000, 10000),
        terrainSource: property(properties, ["terrain_source"], "未注明地形来源"),
        precision_m: numeric(properties.precision_m, 0, 100000),
      });
      return;
    }

    if (kind === "boundaries" || kind === "hazards") {
      const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : null;
      const valid = Array.isArray(polygons) && polygons.length > 0 && polygons.every((rings) => Array.isArray(rings) && rings.length > 0 && rings.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(validPosition) && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]));
      if (!valid) { skipped += 1; return; }
      vertices += polygons.reduce((sum, rings) => sum + rings.reduce((n, ring) => n + ring.length, 0), 0);
      features.push({ type: "Feature", id: String(feature.id ?? index), geometry, properties: {
        name: property(properties, ["name", "名称"], `范围 ${index + 1}`),
        category: property(properties, ["category", "类型"], "未分类"),
        source: property(properties, ["source", "来源"], "未注明"),
      } });
      return;
    }

    const parts = geometry?.type === "LineString"
      ? [geometry.coordinates]
      : geometry?.type === "MultiLineString"
        ? geometry.coordinates
        : null;
    if (!parts || !Array.isArray(parts)) {
      skipped += 1;
      return;
    }
    let accepted = false;
    parts.forEach((coordinates, partIndex) => {
      if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(validPosition)) return;
      vertices += coordinates.length;
      features.push({
        type: "Feature",
        id: `${feature.id ?? index}-${partIndex}`,
        properties: {
          name: property(properties, ["name", "名称"], kind === "waterways" ? "未命名水系" : "未命名线路"),
          period: property(properties, ["period", "时期"], "未填写"),
        },
        geometry: { type: "LineString", coordinates },
      });
      accepted = true;
    });
    if (!accepted) skipped += 1;
  });

  if (features.length > MAX_FEATURES || vertices > 100000) throw new Error("图层过大，请将研究区裁剪到 5,000 个要素、100,000 个顶点以内。");

  if (!features.length) {
    throw new Error(kind === "sites"
      ? "文件中没有有效 Point 遗址点位。"
      : ["boundaries", "hazards"].includes(kind) ? "文件中没有有效的闭合 Polygon 或 MultiPolygon。" : "文件中没有有效 LineString 或 MultiLineString 线要素。");
  }
  return { features, skipped };
}

function numeric(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export function historicalDistance(site, lines, source) {
  if (source?.timing !== "historical" || !site.period || site.period === "未填写") return null;
  return nearestDistanceKm(site, lines.filter((line) => (line.properties?.period && line.properties.period !== "未填写" ? line.properties.period : source.period) === site.period));
}

export function containingAreas(site, polygons) {
  if (!site || !polygons.length) return null;
  return polygons.filter((polygon) => booleanPointInPolygon([site.lng, site.lat], polygon)).map((polygon) => polygon.properties.name);
}

export function investigationBuffer(site, meters) {
  if (!site || !Number.isFinite(meters) || meters < 50 || meters > 5000) return null;
  const feature = buffer({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [site.lng, site.lat] } }, meters / 1000, { units: "kilometers", steps: 64 });
  feature.properties = { name: `${site.name} 调查参考区`, radius_m: meters, is_demo: Boolean(site.isDemo), purpose: "调查参考，非法定保护范围", site_id: site.id };
  return feature;
}

export function assertWorkload(sites, waterways, routes, polygons = []) {
  const segments = [...waterways, ...routes].reduce((sum, line) => sum + line.geometry.coordinates.length - 1, 0);
  const vertices = polygons.reduce((sum, feature) => sum + (feature.geometry.type === "Polygon" ? feature.geometry.coordinates : feature.geometry.coordinates.flat()).reduce((n, ring) => n + ring.length, 0), 0);
  if (sites.length * (segments + vertices) > 500000) throw new Error("数据组合超出浏览器计算额度，请按研究区裁剪后导入。");
}

export function nearestDistanceKm(site, lines) {
  if (!lines.length) return null;
  const point = [site.lng, site.lat];
  let minimum = Infinity;
  for (const line of lines) {
    const distance = pointToLineDistance(point, line, { units: "kilometers" });
    if (distance < minimum) minimum = distance;
  }
  return Number.isFinite(minimum) ? minimum : null;
}

export function analyzeSites(sites, waterways, routes) {
  return sites.map((site) => ({
    ...site,
    waterDistanceKm: nearestDistanceKm(site, waterways),
    routeDistanceKm: nearestDistanceKm(site, routes),
  }));
}

export function distanceDistribution(sites, key = "waterDistanceKm") {
  const values = sites.map((site) => site[key]).filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  const limits = [0, 1, 2, 5, 10, Infinity];
  const labels = ["<1", "1–2", "2–5", "5–10", "≥10"];
  const bins = labels.map((label, index) => ({
    label,
    count: values.filter((value) => value >= limits[index] && value < limits[index + 1]).length,
  }));
  return { count: values.length, minimum: values[0], maximum: values.at(-1), median, bins };
}

export function geoJsonLines(lines) {
  return { type: "FeatureCollection", features: lines };
}
