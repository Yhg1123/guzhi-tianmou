import coordtransform from "coordtransform";

// Display adapter only: project records, Turf calculations and exports stay WGS84.
// This open-source approximation is for basemap alignment, not surveying.
export function displayPosition(position, provider = "tencent") {
  const [lng, lat, ...rest] = position;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) throw new Error("地图坐标无效");
  const converted = provider === "tencent" ? coordtransform.wgs84togcj02(lng, lat) : [lng, lat];
  return [...converted, ...rest];
}

export function displayPaths(coordinates, provider = "tencent") {
  return typeof coordinates[0] === "number" ? displayPosition(coordinates, provider) : coordinates.map((part) => displayPaths(part, provider));
}
