"""Prepare an auditable local multi-view training run from the licensed CB photos.

Uses the published camera calibration/poses, but independently matches SIFT
features and triangulates the initial geometry from TRAINING photos. No finished
Gaussian model, ground-truth point cloud or single-image depth model is used.
"""
import argparse, csv, hashlib, json
from pathlib import Path
from datetime import datetime, timezone
import cv2
import numpy as np
from PIL import Image


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--raw', type=Path, default=Path('qa/local-training/cb/raw'))
    parser.add_argument('--output', type=Path, default=Path('qa/local-training/cb/prepared'))
    parser.add_argument('--max-side', type=int, default=960)
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    raw, out = args.raw, args.output
    (out/'images').mkdir(parents=True, exist_ok=True)
    (out/'masks').mkdir(parents=True, exist_ok=True)
    cv2.setNumThreads(4)
    cameras_path = raw/'2_exterior_parameters.txt'
    if not cameras_path.exists(): cameras_path = raw/'exterior.txt'
    cameras = {row['PhotoID']: row for row in csv.DictReader(cameras_path.open())}
    K = np.array([[3054.45715, 0, 1943.11827], [0, 3054.45715, 1285.3628], [0, 0, 1]])
    distortion = np.array([-0.0821528, -0.00131558, -5.76325e-05, 0.000540635, 0.0190999])
    width, height = 3872, 2592
    new_K, _ = cv2.getOptimalNewCameraMatrix(K, distortion, (width, height), 0)
    mapping = cv2.initUndistortRectifyMap(K, distortion, None, new_K, (width, height), cv2.CV_32FC1)
    w, h = args.max_side, round(height*args.max_side/width)
    small_K = np.diag([w/width, h/height, 1]) @ new_K
    entries = sorted((raw/'images').glob('5_CB_*.png'))
    if args.limit: entries = entries[:args.limit]
    source = json.loads((raw/'source.json').read_text(encoding='utf-8-sig')) if (raw/'source.json').exists() else None
    annotations = json.loads((raw/'labels-source.json').read_text(encoding='utf-8-sig')) if (raw/'labels-source.json').exists() else None
    if not annotations:raise ValueError('Download and verify the architectural annotation maps first')
    if not args.limit and (not source or len(entries) != len(source['photos'])):
        raise ValueError('Fetch and verify the complete selected photo set before training')
    records, features, images, poses = [], [], [], []
    detector = cv2.SIFT_create(nfeatures=6500, contrastThreshold=0.025)
    for idx, path in enumerate(entries):
        row = cameras[path.stem]
        R = np.array([float(row[f'R{i}{j}']) for i in range(1,4) for j in range(1,4)]).reshape(3,3)
        C = np.array([float(row[k]) for k in ['X','Y','K']])
        if not np.allclose(R @ R.T, np.eye(3), atol=1e-5) or not np.isclose(np.linalg.det(R), 1, atol=1e-5):
            raise ValueError('Invalid source camera rotation')
        rgb = np.asarray(Image.open(path).convert('RGB'))
        if rgb.shape != (height, width, 3): raise ValueError('Unexpected source sensor dimensions')
        label_path=raw/'labels'/path.name
        expected_label=next(v for v in annotations['labels'] if v['name']==path.name)
        if sha(label_path)!=expected_label['sha256']:raise ValueError('Annotation checksum changed')
        labels=np.asarray(Image.open(label_path))
        architecture=((labels<=9)*255).astype(np.uint8)
        architecture=cv2.resize(cv2.remap(architecture,*mapping,interpolation=cv2.INTER_NEAREST),(w,h),interpolation=cv2.INTER_NEAREST)
        architecture=cv2.erode(architecture,np.ones((3,3),np.uint8),iterations=1)
        rgb = cv2.resize(cv2.remap(rgb, *mapping, interpolation=cv2.INTER_LINEAR), (w,h), interpolation=cv2.INTER_AREA)
        target = out/'images'/f'{path.stem}.png'
        # Semantic projection gaps are unknown pixels, not holes in the building.
        # Brush's separate masks ignore these pixels instead of forcing alpha=0.
        Image.fromarray(rgb).save(target,compress_level=3)
        mask_target=out/'masks'/target.name
        Image.fromarray(architecture).save(mask_target)
        matrix = np.eye(4); matrix[:3,:3] = R.T; matrix[:3,3] = C
        frame = {'file_path':f'images/{path.stem}.png', 'transform_matrix':matrix.tolist()}
        keys, desc = detector.detectAndCompute(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), architecture)
        features.append((np.array([k.pt for k in keys]), desc))
        images.append(rgb)
        cv_R = np.diag([1.,-1.,-1.]) @ R
        poses.append((small_K @ np.c_[cv_R,-cv_R@C], cv_R, C))
        digest=sha(path)
        expected=next((p for p in source['photos'] if p['name']==path.name),None) if source else None
        if (not expected and not args.limit) or expected and digest!=expected['sha256']:raise ValueError('Original photograph checksum changed')
        records.append({'name':path.name,'bytes':path.stat().st_size,'sha256':digest,'processed':target.name,'processedSha256':sha(target),'maskSha256':sha(mask_target),'annotationSha256':sha(label_path),'orientation':int(row['Orientation']),'split':'validation' if idx%8==7 else 'train','frame':frame})
        print(f'Prepared {path.name}: {len(keys)} features', flush=True)
    train_indices = [i for i,r in enumerate(records) if r['split']=='train']
    flann = cv2.FlannBasedMatcher(dict(algorithm=1,trees=5),dict(checks=64))
    points, colors, pair_records = [], [], []
    pair_set=set()
    for at,i in enumerate(train_indices):
        nearby=sorted((j for j in train_indices if j!=i),key=lambda j:np.linalg.norm(poses[i][2]-poses[j][2]))[:8]
        nearby += [train_indices[at+n] for n in [1,2,4] if at+n<len(train_indices)]
        for j in nearby:pair_set.add(tuple(sorted((i,j))))
    for i,j in sorted(pair_set):
            ka,da = features[i]; kb,db = features[j]
            if da is None or db is None:continue
            good = [m for m,n in flann.knnMatch(da,db,k=2) if m.distance<0.83*n.distance]
            if len(good)<12:continue
            uv1=np.array([ka[m.queryIdx] for m in good]);uv2=np.array([kb[m.trainIdx] for m in good])
            P1,R1,C1=poses[i];P2,R2,C2=poses[j]
            hom=cv2.triangulatePoints(P1,P2,uv1.T,uv2.T)
            xyz=(hom[:3]/hom[3]).T
            z1=(xyz-C1)@R1[2];z2=(xyz-C2)@R2[2]
            def project(P):
                p=np.c_[xyz,np.ones(len(xyz))]@P.T
                return p[:,:2]/p[:,2:]
            error=np.maximum(np.linalg.norm(project(P1)-uv1,axis=1),np.linalg.norm(project(P2)-uv2,axis=1))
            a=xyz-C1;b=xyz-C2
            cos=np.sum(a*b,axis=1)/(np.linalg.norm(a,axis=1)*np.linalg.norm(b,axis=1))
            ok=(z1>0.1)&(z2>0.1)&(error<1.5)&(cos<np.cos(np.deg2rad(1)))&np.isfinite(xyz).all(axis=1)
            pixels=np.rint(uv1[ok]).astype(int); pixels[:,0]=np.clip(pixels[:,0],0,w-1);pixels[:,1]=np.clip(pixels[:,1],0,h-1)
            points.append(xyz[ok]);colors.append(images[i][pixels[:,1],pixels[:,0]])
            pair_records.append({'a':records[i]['name'],'b':records[j]['name'],'matches':len(good),'triangulated':int(ok.sum()),'medianReprojectionPixels':float(np.median(error[ok])) if ok.any() else None})
            print(f'Matched {i:02d}/{j:02d}: {ok.sum()} triangulated',flush=True)
    xyz=np.concatenate(points); rgb=np.concatenate(colors)
    if len(xyz)<1000: raise ValueError('Insufficient triangulated geometry; do not label this a reconstructed model')
    # Discard isolated distant matches before they can distort scene bounds.
    lo,hi=np.quantile(xyz,[.01,.99],axis=0)
    valid=((xyz>=lo)&(xyz<=hi)).all(axis=1)
    rejected=int((~valid).sum());xyz=xyz[valid];rgb=rgb[valid]
    # One point per small spatial voxel prevents coincident seeds from repeated pairs.
    extent=np.quantile(xyz,.98,axis=0)-np.quantile(xyz,.02,axis=0)
    voxel=float(np.linalg.norm(extent)/1800)
    _,keep=np.unique(np.floor(xyz/voxel).astype(np.int64),axis=0,return_index=True)
    xyz=xyz[keep];rgb=rgb[keep]
    if len(xyz)>100000:
        keep=np.random.default_rng(42).choice(len(xyz),100000,replace=False);xyz=xyz[keep];rgb=rgb[keep]
    seed=out/'init.ply'
    dtype=np.dtype([('xyz','<f4',(3,)),('rgb','u1',(3,))]);data=np.empty(len(xyz),dtype=dtype);data['xyz']=xyz;data['rgb']=rgb
    with seed.open('wb') as f:
        f.write(('ply\nformat binary_little_endian 1.0\nelement vertex '+str(len(xyz))+'\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n').encode());f.write(data.tobytes())
    config={'camera_model':'OPENCV','fl_x':float(small_K[0,0]),'fl_y':float(small_K[1,1]),'cx':float(small_K[0,2]),'cy':float(small_K[1,2]),'w':w,'h':h,'ply_file_path':'init.ply'}
    for split,suffix in [('train','train'),('validation','val')]:
        frames=[r['frame'] for r in records if r['split']==split]
        if frames:(out/f'transforms_{suffix}.json').write_text(json.dumps({**config,'frames':frames},indent=2))
    manifest={'schema':1,'createdAt':datetime.now(timezone.utc).isoformat(),'method':'Published camera poses and architectural labels; OpenCV undistortion; independent SIFT matching and two-view triangulation from training images only','rawIntrinsics':K.tolist(),'distortion':distortion.tolist(),'processedIntrinsics':small_K.tolist(),'dimensions':[w,h],'voxel':voxel,'rejectedDistantMatches':rejected,'seedPointCount':len(xyz),'seedSha256':sha(seed),'pairs':pair_records,'photographs':records,'source':source,'annotations':annotations,'maskPolicy':'Source classes 0–9 retained; unknown/background class 10 ignored through separate loss masks, never forced transparent. One processed-pixel erosion. RGB and masks share undistortion. This avoids treating annotation gaps as physical holes.','validationPolicy':'Every eighth photograph excluded from triangulation and training; source camera poses retained','usesFinishedGaussianModel':False,'usesPublishedPointCloud':False,'usesMonocularDepth':False}
    (out.parent/f'{out.name}-preparation.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
    print(f'Prepared {len(records)} photos; independently triangulated {len(xyz)} 3D points',flush=True)

if __name__=='__main__': main()
