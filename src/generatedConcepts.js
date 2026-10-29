import concept from "./damingConceptCatalog.json" with { type: "json" };
import { canPublishGaussian, matchesGaussianSite } from "./gaussianQuality.js";
import { siteName } from "./presentation.js";

export const generatedConceptCandidate = concept.trainedInThisApp === true ? concept : null;
export const publishedConcepts = [generatedConceptCandidate].filter((scene) => scene && canPublishGaussian(scene));
export function findGeneratedConcept(site) {
  return publishedConcepts.find((scene) => matchesGaussianSite(scene, site) && siteName(scene.site) === siteName(site));
}
