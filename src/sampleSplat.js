// Synthetic calibration asset, encoded in the standard 32-byte .splat format.
// It is not a reconstruction of any archaeological site.
export function createSampleSplat() {
  const points = [];
  const add = (x, y, z, color, size = 0.047) => points.push({ x, y, z, color, size });
  for (let x = -2.9; x <= 2.9; x += 0.09) for (let z = -2.25; z <= 2.25; z += 0.09) {
    const tone = Math.round(145 + 9 * Math.sin(x * 13) * Math.cos(z * 9));
    add(x, 0, z, [tone, tone + 3, tone + 1], 0.061);
    if (Math.abs(x) > 2.78 || Math.abs(z) > 2.12) for (let y = -0.28; y < 0; y += 0.08) add(x, y, z, [120, 132, 133], 0.061);
  }
  for (const x of [-2, 0, 2]) for (const z of [-1.35, 1.35]) {
    for (let y = 0.05; y < 2.4; y += 0.07) for (let a = 0; a < Math.PI * 2; a += 0.42) add(x + Math.cos(a) * 0.13, y, z + Math.sin(a) * 0.13, [148, 74, 53], 0.052);
    for (let dx = -0.23; dx <= 0.23; dx += 0.07) for (let dz = -0.23; dz <= 0.23; dz += 0.07) add(x + dx, 0.12, z + dz, [178, 178, 161], 0.055);
  }
  for (const z of [-1.35, 1.35]) for (let x = -2.2; x < 2.2; x += 0.07) for (let y = 2.1; y < 2.4; y += 0.07) add(x, y, z, [158, 85, 54], 0.052);
  for (let x = -2.8; x <= 2.8; x += 0.075) for (let z = -2.1; z <= 2.1; z += 0.075) {
    const y = 3.4 - Math.abs(z) * 0.59 + Math.pow(Math.abs(z) / 2.1, 5) * 0.30 + Math.pow(Math.abs(x) / 2.8, 7) * 0.18;
    const tone = Math.round(66 + 18 * Math.cos(x * 42));
    add(x, y, z, [tone, tone + 29, tone + 26], 0.056);
  }
  for (let x = -2.85; x <= 2.85; x += 0.055) add(x, 3.5, 0, [190, 167, 116], 0.062);
  const data = new ArrayBuffer(points.length * 32);
  points.forEach((p, i) => {
    new Float32Array(data, i * 32, 6).set([p.x, p.y, p.z, p.size, p.size, p.size]);
    new Uint8Array(data, i * 32 + 24, 8).set([...p.color, 255, 255, 128, 128, 128]);
  });
  return new Blob([data], { type: "application/octet-stream" });
}
