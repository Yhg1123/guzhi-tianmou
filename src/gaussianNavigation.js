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

// Calibrated source-photo framing, contained in a canvas of any aspect ratio.
// Keep the actual camera position: fit by extending the projection, not by
// moving the observer to an unphotographed position around a weak model.
export function gaussianCaptureProjection(intrinsics, aspect, near = 0.01) {
  const { width, height, fx, fy, cx, cy } = intrinsics;
  if (![width, height, fx, fy, cx, cy, aspect, near].every(Number.isFinite)
      || Math.min(width, height, fx, fy, aspect, near) <= 0) throw new Error("Invalid capture calibration");
  const fittedHeight = Math.max(height, width / aspect);
  const fittedWidth = fittedHeight * aspect;
  const centerX = cx + (fittedWidth - width) / 2;
  const centerY = cy + (fittedHeight - height) / 2;
  return {
    left: -centerX / fx * near, right: (fittedWidth - centerX) / fx * near,
    top: centerY / fy * near, bottom: -(fittedHeight - centerY) / fy * near,
    fov: 2 * Math.atan(fittedHeight / (2 * fy)) * 180 / Math.PI,
  };
}
