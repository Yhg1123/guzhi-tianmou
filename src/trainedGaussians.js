import generated from "./localGaussianCatalog.json" with { type: "json" };
import review from "./localGaussianReview.json" with { type: "json" };
import captureViews from "./localGaussianCaptureViews.json" with { type: "json" };
import { canPublishGaussian } from "./gaussianQuality.js";

export const experimentalGaussianCases = generated?.trainedInThisApp === true
  ? [{ ...generated, qualityReview: review, captureViews, pointCountLabel: generated.pointCount.toLocaleString("en-US") }]
  : [];
export const trainedGaussianCases = experimentalGaussianCases.filter(canPublishGaussian);
export const localGaussianCase = "local-cb";

export function gaussianCaseId(hash) {
  const [page, query = ""] = String(hash).replace(/^#/, "").split("?");
  if (page !== "reconstruction") return "";
  const params = new URLSearchParams(query);
  return params.get("case") || "";
}

export function gaussianCaseRoute(id, siteId) {
  const query = new URLSearchParams({ case: String(id) });
  if (siteId != null) query.set("site", String(siteId));
  return "reconstruction?" + query;
}
