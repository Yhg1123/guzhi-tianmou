const PAGES = new Set(["map", "sites", "research", "protection", "environment", "reconstruction", "community", "data"]);

export function workspaceRoute(hash) {
  const [page, query = ""] = String(hash).replace(/^#/, "").split("?");
  return { page: PAGES.has(page) ? page : "map", siteId: page === "reconstruction" ? new URLSearchParams(query).get("site") || "" : "" };
}

export function reconstructionRoute(id) {
  return "reconstruction?" + new URLSearchParams({ site: String(id) });
}

// Keep the existing IndexedDB key format so earlier imported models still open.
export function siteModelKey(site) {
  return site && site.id != null && Number.isFinite(site.lng) && Number.isFinite(site.lat) ? `heritage-splat:${site.id}:${site.lng}:${site.lat}` : null;
}

export function isSiteModel(record, site) {
  if (!site || !(record?.file instanceof Blob) || !record.file.size || record.file.size > 120 * 1024 * 1024 || typeof record.name !== "string" || !/\.(ply|splat|ksplat)$/i.test(record.name)) return false;
  const snapshot = record.site;
  return !snapshot || String(snapshot.id) === String(site.id) && snapshot.lng === site.lng && snapshot.lat === site.lat;
}
