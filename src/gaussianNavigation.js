// The catalog cameras use Y-up, matching the packaged trained scene.
// Rotate a real camera around its target, never the image or its container.
export function gaussianViewPose(camera, preset, aspect = 1.5) {
  const offset = camera.position.map((v, i) => v - camera.target[i]);
  const angle = { capture: 0, left: -Math.PI / 2, back: Math.PI, right: Math.PI / 2 }[preset];
  const distance = Math.hypot(...offset);
  // Leave room for the long building when seen end-on from either side.
  const fit = (camera.fitMargin || 1.3) * Math.max(1, 1.5 / Math.max(0.25, aspect));
  const direction = preset === "top"
    ? [offset[0] * 0.001, distance, offset[2] * 0.001]
    : [offset[0] * Math.cos(angle) + offset[2] * Math.sin(angle), offset[1], -offset[0] * Math.sin(angle) + offset[2] * Math.cos(angle)];
  if (!direction.every(Number.isFinite)) throw new Error("Unknown Gaussian camera preset");
  return { position: direction.map((v, i) => camera.target[i] + v * fit), target: [...camera.target], fov: camera.fov };
}
