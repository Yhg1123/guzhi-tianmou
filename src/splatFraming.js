// The photo-derived assets use this assumed projection when pixels are unprojected.
// Fit both axes, with a small margin; zoom is optical so it does not move into the surface.
export function photoFraming(width, height, aspect, preset = "overview") {
  if (![width, height, aspect].every((n) => Number.isFinite(n) && n > 0)) throw new Error("Invalid photo viewport");
  const focal = Math.max(width, height) * 0.95;
  const tangent = Math.max(height / (2 * focal), width / (2 * focal * aspect));
  return {
    fov: 2 * Math.atan(tangent * 1.06) * 180 / Math.PI,
    angle: preset === "front" ? -0.055 : preset === "top" ? 0.055 : 0,
    zoom: preset === "detail" ? 1.5 : 1,
  };
}
