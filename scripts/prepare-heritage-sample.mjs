// Creates a visualization derivative of real photogrammetry data, not trained 3DGS.
// Input: Open Heritage 3D, DOI 10.26301/zjnn-wx58 (CC BY, as listed by the publisher).
import { brotliDecompressSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const base = "https://pointcloud.ucsd.edu/archive_temp/oh3d_store/oh3d-vis/datasets/zjnn-wx58/potree/zjnn-wx58_photogrammetry_terrestrial/";
const maxDepth = 3;
const output = new URL("../public/samples/", import.meta.url);

async function request(path, range) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(base + path, { headers: range ? { Range: `bytes=${range[0]}-${range[1]}` } : {}, signal: AbortSignal.timeout(30000) });
      if (range && (response.status !== 206 || response.headers.get("content-range")?.split("/")[0] !== `bytes ${range[0]}-${range[1]}`)) {
        await response.body?.cancel();
        throw new Error("Server did not honor the byte range; refusing to download the full octree.");
      }
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (range && data.length !== range[1] - range[0] + 1) throw new Error("Incomplete byte range.");
      return data;
    } catch (error) { if (attempt === 2) throw error; }
  }
}

// Potree 2.0 stores positions as two interleaved 16-bit XYZ groups.
// Decode explicitly rather than executing scripts supplied by the remote viewer.
function morton16(bytes, start, axis) {
  let result = 0;
  for (let bit = 0; bit < 16; bit++) {
    const packedBit = bit * 3 + axis;
    result += ((bytes[start + Math.floor(packedBit / 8)] >>> (packedBit % 8)) & 1) * 2 ** bit;
  }
  return result;
}

await mkdir(output, { recursive: true });
const metadataBytes = await request("metadata.json");
const metadata = JSON.parse(metadataBytes);
if (metadata.version !== "2.0" || metadata.encoding !== "BROTLI") throw new Error("Unexpected Potree encoding.");
const hierarchy = await request("hierarchy.bin", [0, metadata.hierarchy.firstChunkSize - 1]);
const queue = ["r"];
const nodes = [];
for (let index = 0; index < hierarchy.length / 22; index++) {
  const name = queue.shift();
  if (!name) throw new Error("Invalid hierarchy.");
  const at = index * 22;
  const type = hierarchy[at];
  if (type === 2) continue; // Proxy hierarchy chunks are intentionally not downloaded.
  const count = hierarchy.readUInt32LE(at + 2);
  if (name.length - 1 <= maxDepth && count) nodes.push({ name, count, offset: Number(hierarchy.readBigInt64LE(at + 6)), length: Number(hierarchy.readBigInt64LE(at + 14)) });
  for (let child = 0; child < 8; child++) if (hierarchy[at + 1] & (1 << child)) queue.push(name + child);
}

const total = nodes.reduce((sum, node) => sum + node.count, 0);
if (total > 1000000) throw new Error("Sample point budget exceeded.");
const splats = Buffer.alloc(total * 32);
const origin = metadata.boundingBox.min.map((minimum, axis) => (minimum + metadata.boundingBox.max[axis]) / 2);
const radius = metadata.spacing / 2 ** maxDepth * 0.72;
let pointIndex = 0;

// Keep requests bounded; remote data remains cached only in this build process.
for (let start = 0; start < nodes.length; start += 4) {
  const batch = nodes.slice(start, start + 4);
  const buffers = await Promise.all(batch.map((node) => request("octree.bin", [node.offset, node.offset + node.length - 1])));
  for (let b = 0; b < batch.length; b++) {
    const node = batch[b];
    const data = brotliDecompressSync(buffers[b]);
    const expected = node.count * metadata.attributes.reduce((sum, attribute) => sum + (attribute.name === "position" ? 16 : attribute.name === "rgb" ? 8 : attribute.size), 0);
    if (data.length !== expected) throw new Error(`Invalid decoded size for ${node.name}.`);
    let colorsOffset = 0;
    for (const attribute of metadata.attributes) {
      if (attribute.name === "rgb") break;
      colorsOffset += node.count * (attribute.name === "position" ? 16 : attribute.size);
    }
    for (let i = 0; i < node.count; i++) {
      const coordinates = [0, 1, 2].map((axis) => (morton16(data, i * 16 + 8, axis) + morton16(data, i * 16, axis) * 65536) * metadata.scale[axis] + metadata.offset[axis] - origin[axis]);
      if (!coordinates.every(Number.isFinite)) throw new Error("Invalid coordinate.");
      const at = pointIndex++ * 32;
      // Z-up source -> Y-up display; translation only, with no claimed metric calibration.
      splats.writeFloatLE(coordinates[0], at);
      splats.writeFloatLE(coordinates[2], at + 4);
      splats.writeFloatLE(-coordinates[1], at + 8);
      for (let axis = 0; axis < 3; axis++) {
        splats.writeFloatLE(radius, at + 12 + axis * 4);
        const color = morton16(data, colorsOffset + i * 8, axis);
        splats[at + 24 + axis] = color > 255 ? Math.floor(color / 256) : color;
      }
      splats.set([255, 255, 128, 128, 128], at + 27);
    }
  }
  console.log(`Prepared ${Math.min(start + 4, nodes.length)}/${nodes.length} nodes (${pointIndex.toLocaleString()} points)`);
}

const file = "temple-of-bel.splat";
await writeFile(new URL(file, output), splats);
await writeFile(new URL("temple-of-bel-source.json", output), JSON.stringify({
  title: "Temple of Bel Tourist Photo Reconstruction",
  file, points: total, bytes: splats.length,
  sha256: createHash("sha256").update(splats).digest("hex"),
  source: "https://www.openheritage3d.org/project.php?id=zjnn-wx58",
  doi: "https://doi.org/10.26301/zjnn-wx58",
  attribution: "Scott McAvoy, Cultural Heritage Engineering Initiative (CHEI) 2020. Distributed by Open Heritage 3D.",
  license: "CC BY (version not specified on the source record)",
  sourceMetadata: base + "metadata.json",
  accessed: new Date().toISOString(),
  transformation: "Potree LOD 0–3 subset; original XYZ/RGB decoded, centered, rotated from Z-up to Y-up; constant isotropic point sprites encoded as standard 32-byte SPLAT records. No learned covariance, COLMAP or 3DGS training was performed.",
  limitations: "Visualization derivative of an unscaled photogrammetry model. Source reports uncalibrated cameras and deformation; not suitable for measurements or georegistration. Not associated with the local project's selected archaeological site.",
}, null, 2));
await writeFile(new URL("temple-of-bel-metadata.json", output), metadataBytes);
console.log(`Saved ${file}: ${total.toLocaleString()} points, ${(splats.length / 1048576).toFixed(1)} MiB`);
