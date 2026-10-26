import catalog from "./siteArchiveCatalog.json" with { type: "json" };
import { siteName } from "./presentation.js";

export const siteArchives = catalog;

// This matches a documented subject to its project record, NOT a georeferenced model.
// Imported or moved records must never silently inherit another site's imagery.
export function findSiteArchive(site) {
  if (!site) return null;
  return siteArchives.find((asset) => asset.site.id === site.id
    && asset.site.lng === site.lng && asset.site.lat === site.lat
    && asset.site.name === siteName(site)) || null;
}
