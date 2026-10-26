"""Create view-limited Gaussian surfaces from licensed photographs + inferred relative depth.

This is NOT multi-view 3DGS training or archaeological restoration. See the generated
manifest for source photographs, transformations, model revision, and limitations.
Install the pinned runtime separately; no model weights are committed to the app.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image, ImageOps, __version__ as pillow_version

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_WEIGHT_SHA256 = "715fade13be8f229f8a70cc02066f656f2423a59effd0579197bbf57860e1378"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def create_splats(rgb, predicted):
    height, width = predicted.shape
    low, high = np.percentile(predicted, [2, 98])
    if not np.isfinite(predicted).all() or high - low < 1e-6:
        raise ValueError("Invalid or constant predicted depth")
    inverse = np.clip((predicted - low) / (high - low), 0, 1)
    depth = 1.4 / (0.7 + inverse * 0.6)  # Arbitrary relative units, NOT meters.
    focal = max(width, height) * 0.95  # Assumed perspective, NOT calibrated intrinsics.
    u, v = np.meshgrid(np.arange(width) + 0.5, np.arange(height) + 0.5)
    xyz = np.stack(((u - width / 2) * depth / focal, -(v - height / 2) * depth / focal, -depth), axis=-1)
    scale = depth / focal * 0.68
    sigma = np.stack((scale, scale, scale * 0.2), axis=-1)
    normal = -xyz / np.linalg.norm(xyz, axis=-1, keepdims=True)
    quat = np.stack((1 + normal[..., 2], -normal[..., 1], normal[..., 0], np.zeros_like(depth)), axis=-1)
    quat /= np.linalg.norm(quat, axis=-1, keepdims=True)
    data = np.empty(width * height, dtype=[("xyz", "<f4", (3,)), ("sigma", "<f4", (3,)), ("rgba", "u1", (4,)), ("quat", "u1", (4,))])
    assert data.dtype.itemsize == 32
    data["xyz"] = xyz.reshape(-1, 3)
    data["sigma"] = sigma.reshape(-1, 3)
    data["rgba"][:, :3] = rgb.reshape(-1, 3)
    data["rgba"][:, 3] = 255
    data["quat"] = np.clip(np.rint(quat.reshape(-1, 4) * 128 + 128), 0, 255).astype(np.uint8)
    return data, inverse


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--depth-repo", type=Path, default=ROOT / "qa/depth-anything-v2")
    parser.add_argument("--checkpoint", type=Path, default=ROOT / "qa/depth-anything-v2/checkpoints/depth_anything_v2_vits.pth")
    parser.add_argument("--max-side", type=int, default=512)
    args = parser.parse_args()
    if not 256 <= args.max_side <= 768:
        raise ValueError("Max side must be between 256 and 768")
    if digest(args.checkpoint) != EXPECTED_WEIGHT_SHA256:
        raise ValueError("Checkpoint does not match the official Hugging Face LFS SHA-256")
    sys.path.insert(0, str(args.depth_repo.resolve()))
    from depth_anything_v2.dpt import DepthAnythingV2
    torch.set_num_threads(4)
    model = DepthAnythingV2(encoder="vits", features=64, out_channels=[48, 96, 192, 384])
    model.load_state_dict(torch.load(args.checkpoint, map_location="cpu", weights_only=True))
    model.eval()
    revision = subprocess.check_output(["git", "-C", str(args.depth_repo), "rev-parse", "HEAD"], text=True).strip()
    output = ROOT / "public/site-archives"
    sources = json.loads((output / "sources.json").read_text(encoding="utf-8-sig"))
    for entry in sources:
        photo = entry["photos"][0]
        image_path = ROOT / "public" / photo["url"].lstrip("/")
        if digest(image_path) != photo["sha256"]:
            raise ValueError("Source image hash changed: " + entry["id"])
        image = ImageOps.exif_transpose(Image.open(image_path)).convert("RGB")
        image.thumbnail((args.max_side, args.max_side), Image.Resampling.LANCZOS)
        rgb = np.asarray(image)
        predicted = model.infer_image(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), input_size=518)
        splats, inverse = create_splats(rgb, predicted)
        asset_path = output / (entry["id"] + ".splat")
        asset_path.write_bytes(splats.tobytes())
        depth_path = output / (entry["id"] + "-depth.png")
        Image.fromarray(np.rint(inverse * 255).astype(np.uint8)).save(depth_path)
        preview_path = output / (entry["id"] + "-preview.jpg")
        image.save(preview_path, quality=90)
        entry["representation"] = "photo-depth-gaussians"
        entry["modelUrl"] = "/site-archives/" + asset_path.name
        entry["depthUrl"] = "/site-archives/" + depth_path.name
        entry["previewUrl"] = "/site-archives/" + preview_path.name
        entry["bytes"] = asset_path.stat().st_size
        entry["pointCount"] = len(splats)
        entry["sha256"] = digest(asset_path)
        entry["depthSha256"] = digest(depth_path)
        entry["previewSha256"] = digest(preview_path)
        entry["processedWidth"], entry["processedHeight"] = image.size
        entry["license"] = photo["license"]
        entry["licenseUrl"] = photo["licenseUrl"]
        entry["generatedAt"] = datetime.now(timezone.utc).isoformat()
        entry["generation"] = {
            "method": "Depth Anything V2 Small relative-depth inference followed by perspective unprojection and view-facing anisotropic Gaussian encoding",
            "model": "Depth-Anything-V2-Small / vits", "codeRevision": revision,
            "codeUrl": "https://github.com/DepthAnything/Depth-Anything-V2", "modelLicense": "Apache-2.0",
            "checkpointUrl": "https://huggingface.co/depth-anything/Depth-Anything-V2-Small/resolve/main/depth_anything_v2_vits.pth",
            "checkpointSha256": EXPECTED_WEIGHT_SHA256, "runtime": "torch " + torch.__version__ + " / CPU",
            "pythonVersion": sys.version.split()[0], "numpyVersion": np.__version__, "pillowVersion": pillow_version, "opencvVersion": cv2.__version__,
            "preprocessing": "EXIF orientation, RGB conversion, LANCZOS resize; original JPEG remains unchanged",
            "depthMapping": "2nd/98th-percentile inverse-depth normalization; relative z=1.4/(0.7+0.6*d)",
            "intrinsics": "Assumed focal length = 0.95 * max(width,height); not calibrated",
            "multiViewTraining": False, "metricScale": False, "georeferenced": False,
            "limitations": "Single photograph visible-surface inference only. No observed back side, complete-site geometry, surveyed dimensions, or archaeological restoration validation. Physical exhibit models remain exhibit models; excavated objects remain object imagery.",
        }
        print(entry["id"], entry["pointCount"], "gaussians", entry["sha256"], flush=True)
    manifest = json.dumps(sources, ensure_ascii=False, indent=2) + "\n"
    (output / "catalog.json").write_text(manifest, encoding="utf-8")
    # Vite forbids JavaScript imports from public/. Keep a byte-identical module copy.
    (ROOT / "src/siteArchiveCatalog.json").write_text(manifest, encoding="utf-8")


if __name__ == "__main__":
    main()
