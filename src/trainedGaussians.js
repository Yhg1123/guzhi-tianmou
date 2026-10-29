import generated from "./localGaussianCatalog.json" with { type: "json" };

// Only outputs of this workspace's completed photo-training runs belong here.
export const trainedGaussianCases = generated?.trainedInThisApp === true
  ? [{ ...generated, pointCountLabel: generated.pointCount.toLocaleString("en-US") }]
  : [];
export const localGaussianCase = "local-cb";

export function gaussianCaseId(hash) {
  const [page, query = ""] = String(hash).replace(/^#/, "").split("?");
  if (page !== "reconstruction") return "";
  const params = new URLSearchParams(query);
  return params.get("case") || (params.has("site") ? "" : localGaussianCase);
}

export function gaussianCaseRoute(id, siteId) {
  const query = new URLSearchParams({ case: String(id) });
  if (siteId != null) query.set("site", String(siteId));
  return "reconstruction?" + query;
}
