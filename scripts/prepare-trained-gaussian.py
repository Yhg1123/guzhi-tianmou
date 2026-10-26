"""Package the CC BY 4.0 Seem Kirke trained Gaussian scene; never train or invent geometry.

First decode source SOG with pinned official SplatTransform (see docs/trained-gaussians.md).
Preserve every trained Gaussian. Rotate coordinates 180 degrees around X for Y-up viewing,
then quantize DC colors, alpha and rotations to the standard 32-byte SPLAT format.
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "qa/seem-source"
OUTPUT = ROOT / "public/gaussians"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    source_ply = ROOT / "qa/seem-trained.ply"
    with source_ply.open("rb") as handle:
        header = b""
        while not header.endswith(b"end_header\n"):
            line = handle.readline()
            if not line or len(header) > 65536:
                raise ValueError("Invalid PLY header")
            header += line
        names = [line.split()[-1] for line in header.decode().splitlines() if line.startswith("property float ")]
        count = int(next(line.split()[-1] for line in header.decode().splitlines() if line.startswith("element vertex ")))
        if len(names) != 14 or b"binary_little_endian" not in header:
            raise ValueError("Expected decoded degree-zero Gaussian PLY")
        source = np.frombuffer(handle.read(), dtype=[(name, "<f4") for name in names])
    if len(source) != count or not all(np.isfinite(source[name]).all() for name in names):
        raise ValueError("Invalid Gaussian data")
    meta = json.loads((SOURCE / "meta.json").read_text(encoding="utf-8-sig"))
    if meta["count"] != count or any(meta["shN"]["codebook"]):
        raise ValueError("Source count mismatch or nonzero higher-order SH (must be preserved separately)")
    data = np.empty(count, dtype=[("xyz", "<f4", (3,)), ("scale", "<f4", (3,)), ("rgba", "u1", (4,)), ("quat", "u1", (4,))])
    xyz = np.stack([source[k] for k in ["x", "y", "z"]], axis=-1) * [1, -1, -1]
    data["xyz"] = xyz
    data["scale"] = np.exp(np.stack([source[f"scale_{i}"] for i in range(3)], axis=-1))
    colors = np.stack([source[f"f_dc_{i}"] for i in range(3)], axis=-1) * 0.28209479177387814 + 0.5
    data["rgba"][:, :3] = np.clip(np.rint(colors * 255), 0, 255).astype(np.uint8)
    data["rgba"][:, 3] = np.clip(np.rint(255 / (1 + np.exp(-source["opacity"]))), 0, 255).astype(np.uint8)
    q = np.stack([-source["rot_1"], source["rot_0"], -source["rot_3"], source["rot_2"]], axis=-1)
    q /= np.linalg.norm(q, axis=-1, keepdims=True)
    data["quat"] = np.clip(np.rint(q * 128 + 128), 0, 255).astype(np.uint8)
    OUTPUT.mkdir(exist_ok=True)
    target = OUTPUT / "seem-church.splat"
    target.write_bytes(data.tobytes())
    manifest = {
        "id": "seem-church", "kind": "gaussian", "representation": "trained-3dgs",
        "title": "Seem 古教堂", "subtitle": "Seem Kirke · 丹麦 · 无人机实景采集",
        "url": "/gaussians/seem-church.splat", "previewUrl": "/gaussians/seem-church-preview.webp",
        "pointCount": count, "bytes": target.stat().st_size, "sha256": sha(target),
        "previewSha256": sha(OUTPUT / "seem-church-preview.webp"),
        "previewSourceUrl": "https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat/e832997f/v1/xl.webp",
        "credit": "roedsgaard / SuperSplat", "license": "CC BY 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "sourceUrl": "https://superspl.at/scene/e832997f", "sourceManifest": "/gaussians/seem-church-source.json",
        "training": "Author: DJI drone photographs → RealityScan camera alignment → LichtFeld Studio training",
        "trainedByAuthor": True, "trainedInThisApp": False, "metricScaleVerified": False, "georeferenced": False,
        "description": "作者以无人机照片采集古教堂，在 RealityScan 中解算相机，再用 LichtFeld Studio 训练的三维高斯场景。保留训练后的空间位置、各向异性尺度、方向、颜色与透明度，可自由环绕观察。本站转换并打包模型，未在本站重新训练。",
        "transformation": "Official SplatTransform 3.10.3: SOG → degree-zero Gaussian PLY (source higher-order SH codebook is entirely zero); 180-degree X rotation for Y-up; 32-byte SPLAT DC/alpha/quaternion quantization. All Gaussians retained; no flattening, synthetic geometry or monocular unprojection.",
        "sourceFiles": [{"name": p.name, "url": "https://d28zzqy0iyovbz.cloudfront.net/e832997f/v1/" + p.name, "bytes": p.stat().st_size, "sha256": sha(p)} for p in sorted(SOURCE.iterdir()) if p.is_file()],
        "bounds": {"min": xyz.min(axis=0).tolist(), "max": xyz.max(axis=0).tolist()},
        "camera": {"position": [-12.421453475952148, 10.829668045043945, -21.73072052001953], "target": [-4.814439652520558, 10.377790210301438, -0.09553461726887491], "fov": 90},
        "packagedAt": datetime.now(timezone.utc).isoformat(),
    }
    raw = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    (OUTPUT / "seem-church-source.json").write_text(raw, encoding="utf-8")
    (ROOT / "src/trainedGaussianCatalog.json").write_text(raw, encoding="utf-8")
    print({"count": count, "bytes": target.stat().st_size, "alphaLevels": len(np.unique(data["rgba"][:, 3])), "sha256": sha(target)})


if __name__ == "__main__":
    main()
