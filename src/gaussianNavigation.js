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

// Fit the complete authored volume in the actual viewport. This changes only
// the inspection camera, never the trained Gaussian positions or parameters.
export function gaussianBoundsPose(bounds, pose, aspect, margin = 1.12, support = null) {
  const subtract = (a, b) => a.map((v, i) => v - b[i]);
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (v) => { const length = Math.hypot(...v); if (!Number.isFinite(length) || length < 1e-9) throw new Error("Invalid Gaussian camera direction"); return v.map((n) => n / length); };
  if (!bounds || ![...bounds.min, ...bounds.max, ...pose.position, ...pose.target, aspect, pose.fov, margin].every(Number.isFinite)
    || aspect <= 0 || pose.fov <= 0 || pose.fov >= 179 || margin < 1 || bounds.min.some((v, i) => v >= bounds.max[i])) throw new Error("Invalid Gaussian framing");
  const direction = unit(subtract(pose.position, pose.target));
  const right = unit(cross(Math.hypot(direction[0], direction[2]) < 1e-9 ? [0, 0, -1] : [0, 1, 0], direction));
  const up = unit(cross(direction, right));
  const target = bounds.min.map((v, i) => (v + bounds.max[i]) / 2);
  const vertical = Math.tan(pose.fov * Math.PI / 360), horizontal = vertical * aspect;
  let distance = 0;
  const corners = [];
  for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) corners.push([x, y, z]);
  const points = support?.length ? support : corners;
  const ranges = [[Infinity, -Infinity], [Infinity, -Infinity]];
  for (const point of points) {
    if (point.length !== 3 || !point.every(Number.isFinite)) throw new Error("Invalid Gaussian framing support");
    const offset = subtract(point, target);
    [right, up].forEach((axis, i) => { const v = dot(offset, axis); ranges[i][0] = Math.min(ranges[i][0], v); ranges[i][1] = Math.max(ranges[i][1], v); });
  }
  // A low terrace and tall central roof leave much of their bounding box empty.
  // Center the actual projected silhouette before solving the fit distance.
  [right, up].forEach((axis, j) => { const shift = (ranges[j][0] + ranges[j][1]) / 2; axis.forEach((v, i) => { target[i] += v * shift; }); });
  for (const point of points) {
    const offset = subtract(point, target), depth = dot(offset, direction);
    distance = Math.max(distance, depth + Math.abs(dot(offset, right)) / horizontal, depth + Math.abs(dot(offset, up)) / vertical);
  }
  return { position: target.map((v, i) => v + direction[i] * distance * margin), target, fov: pose.fov };
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
