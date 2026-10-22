Temple of Bel Tourist Photo Reconstruction — visualization sample

Attribution:
Scott McAvoy, Cultural Heritage Engineering Initiative (CHEI) 2020:
Temple of Bel Tourist Photo Reconstruction - Photogrammetry - Terrestrial.
Distributed by Open Heritage 3D. https://doi.org/10.26301/zjnn-wx58

License: CC BY, as stated on the publisher's record.
The publisher does not specify the license version; none is inferred here.
Source record: https://www.openheritage3d.org/project.php?id=zjnn-wx58

Files:
- temple-of-bel.splat: 592,454 real XYZ/RGB points sampled from Potree LOD 0–3.
- temple-of-bel-source.json: provenance, transformations, size and SHA-256.
- temple-of-bel-metadata.json: original source metadata, retained unmodified.

Changes: source positions are decoded, centered and rotated from Z-up to Y-up.
Constant isotropic point sprites are written in the standard SPLAT container.
This is NOT a trained 3D Gaussian Splatting reconstruction. No appearance or
geometry is invented. Missing parts and photographic artifacts remain visible.

The source model has no scale calibration and reports local deformation.
Do not use the preview for measurements, engineering or georegistration.
It is not associated with the selected archaeological record in the app.

The original 1,581 photos and full dataset are NOT bundled with this project.
For those files, follow the publisher's data-download process.

Reproduce the sample with: node scripts/prepare-heritage-sample.mjs
This fetches bounded byte ranges rather than the complete, multi-GB octree.
