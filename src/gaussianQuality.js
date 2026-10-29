// Completion proves that optimization ran. Publication requires a separate,
// hash-bound visual review and a verified association with the project site.
export function canPublishGaussian(scene) {
  const review = scene?.qualityReview;
  return scene?.trainedInThisApp === true && scene.training?.status === "completed"
    && /^[a-f0-9]{64}$/.test(scene.rawSha256 || "")
    && review?.status === "accepted" && review.sceneId === scene.id && review.modelSha256 === scene.rawSha256
    && typeof review.reviewedAt === "string" && Number.isFinite(Date.parse(review.reviewedAt))
    && ["structure", "novelViews", "floaters", "subjectIdentity"].every((key) => review.checks?.[key] === true);
}

export function matchesGaussianSite(scene, site) {
  return canPublishGaussian(scene) && site?.id != null && scene.site?.id != null
    && [site.lng, site.lat, scene.site.lng, scene.site.lat].every(Number.isFinite)
    && String(scene.site.id) === String(site.id)
    && scene.site.lng === site.lng && scene.site.lat === site.lat;
}
