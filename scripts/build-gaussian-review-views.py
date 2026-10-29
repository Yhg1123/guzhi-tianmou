"""Expose actual withheld camera poses for renderer/photograph comparison.

No model is generated or approved here. The CB run remains rejected. Portrait
review images were rotated by the original packager; rotate the camera basis
and intrinsics with them, never change pixels without changing calibration.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    source = json.loads((ROOT / 'public/generated/cb/source.json').read_text(encoding='utf8'))
    prep = source['preparation']
    fx, fy = prep['processedIntrinsics'][0][0], prep['processedIntrinsics'][1][1]
    cx, cy = prep['processedIntrinsics'][0][2], prep['processedIntrinsics'][1][2]
    width, height = prep['dimensions']
    views = []
    for i, pair in enumerate(source['validation']):
        photo = next(p for p in prep['photographs'] if p['name'] == pair['name'])
        if photo['split'] != 'validation':
            raise ValueError('Review must retain withheld-view identity')
        matrix = photo['frame']['transform_matrix']
        right, up, back = ([matrix[r][c] for r in range(3)] for c in range(3))
        position = [matrix[r][3] for r in range(3)]
        intrinsics = dict(width=width, height=height, fx=fx, fy=fy, cx=cx, cy=cy)
        if photo['orientation']:
            up = right
            intrinsics = dict(width=height, height=width, fx=fy, fy=fx, cx=cy, cy=width-cx)
        image = ROOT / 'public' / pair['inputUrl'].lstrip('/')
        views.append({
            'id': Path(photo['name']).stem,
            'label': f'保留视角 {i+1:02d}',
            'name': photo['name'],
            'position': position,
            'target': [position[a] - back[a]*10 for a in range(3)],
            'up': up,
            'intrinsics': intrinsics,
            'inputUrl': pair['inputUrl'],
            'renderUrl': pair['renderUrl'],
            'inputSha256': hashlib.sha256(image.read_bytes()).hexdigest(),
            'originalSha256': photo['sha256'],
            'displayRotationDegrees': 90 if photo['orientation'] else 0,
            'method': 'Published withheld camera pose, matching processed image calibration; portrait rotation applied to camera basis and intrinsics as well as the review image.'
        })
    (ROOT / 'src/localGaussianCaptureViews.json').write_text(json.dumps(views, ensure_ascii=False, indent=2), encoding='utf8')
    print(f'Wrote {len(views)} withheld camera views; model quality remains rejected')


if __name__ == '__main__':
    main()
