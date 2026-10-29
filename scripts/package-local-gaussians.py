"""Publish only a completed locally trained model, with all learned Gaussian fields.

Input photographs/calibration are credited separately from this machine's SIFT
initialization and Brush optimization. Never imports an externally trained scene.
"""
import hashlib,json,re,shutil
from pathlib import Path
from datetime import datetime,timezone
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    base=ROOT/'qa/local-training/cb';trained=base/'trained-architecture';prepared=base/'prepared-architecture'
    run=json.loads((trained/'run.json').read_text())
    prep=json.loads((base/'prepared-architecture-preparation.json').read_text())
    if run['status']!='completed' or run['exitCode']!=0 or run['photoCount']!=166 or run['preparationSha256']!=sha(base/'prepared-architecture-preparation.json'):
        raise ValueError('Cannot publish an incomplete or unmatched local training run')
    if prep['usesFinishedGaussianModel'] or prep['usesPublishedPointCloud'] or prep['usesMonocularDepth']:
        raise ValueError('This publication must be generated from our multi-view initialization')
    log=(trained/'training.log').read_text(encoding='utf8')
    native_metrics=[{'iteration':int(i),'psnr':float(p),'ssim':float(s)}for i,p,s in re.findall(r'Eval iter (\d+): PSNR ([\d.eE+-]+), ssim ([\d.eE+-]+)',log)]
    if len(native_metrics)<2 or native_metrics[-1]['iteration']!=12000:raise ValueError('Missing completed validation evidence')
    val_photos=[p for p in prep['photographs']if p['split']=='validation']
    metrics=[]
    # Brush 0.3's native evaluation includes untrained background RGB. Report a
    # separate, reproducible architecture-region PSNR for this masked workflow.
    for checkpoint in native_metrics:
        per_view=[]
        for photo in val_photos:
            prediction=np.asarray(Image.open(trained/f"eval_{checkpoint['iteration']}"/photo['processed']).convert('RGB'))
            size=(prediction.shape[1],prediction.shape[0])
            reference=np.asarray(Image.open(prepared/'images'/photo['processed']).convert('RGB').resize(size,Image.Resampling.BILINEAR))
            mask=np.asarray(Image.open(prepared/'masks'/photo['processed']).convert('L').resize(size,Image.Resampling.BILINEAR))>=254
            mse=float(np.mean(((prediction.astype(float)-reference)/255)**2,axis=2)[mask].mean())
            if not mask.any()or not np.isfinite(mse):raise ValueError('Invalid held-out architecture comparison')
            per_view.append({'name':photo['name'],'pixels':int(mask.sum()),'psnr':float(-10*np.log10(max(mse,1e-12)))})
        metrics.append({'iteration':checkpoint['iteration'],'psnr':float(np.mean([v['psnr']for v in per_view])),'views':per_view})
    selected=max(metrics,key=lambda m:m['psnr'])
    source=trained/next(c['file']for c in run['checkpoints']if c['iteration']==selected['iteration'])
    if sha(trained/'model_12000.ply')!=run['outputSha256']:raise ValueError('Final checkpoint checksum changed')
    raw=source.read_bytes();end=raw.index(b'end_header\n')+len(b'end_header\n');head=raw[:end].decode()
    names=[l.split()[-1]for l in head.splitlines()if l.startswith('property float ')]
    count=int(re.search(r'element vertex (\d+)',head).group(1))
    if len(names)!=23 or 'comment SH degree: 1'not in head:raise ValueError('Expected degree-one trained Gaussian PLY')
    data=np.frombuffer(raw[end:],dtype=[(n,'<f4')for n in names])
    if len(data)!=count or not all(np.isfinite(data[n]).all()for n in names):raise ValueError('Invalid trained parameters')
    xyz=np.column_stack([data[n]for n in ['x','y','z']]);scales=np.exp(np.column_stack([data[f'scale_{i}']for i in range(3)]))
    if not (scales>0).all():raise ValueError('Invalid Gaussian scales')
    out=ROOT/'public/generated/cb';(out/'photos').mkdir(parents=True,exist_ok=True);(out/'validation').mkdir(exist_ok=True)
    # Keep the original PLY bytes: positions, covariance, alpha, rotation, DC and SH.
    shutil.copyfile(source,out/'raw-model.ply')
    refs=[]
    for i in [0,12,24,36,48,60,72,84,96,108,120,132,144,156,165]:
        photo=prep['photographs'][i]
        image=Image.open(base/'raw/images'/photo['name']).convert('RGB')
        if photo['orientation']:image=image.rotate(90,expand=True)
        image.thumbnail((680,480));target=out/'photos'/photo['name'].replace('.png','.jpg');image.save(target,quality=88)
        original=next(p for p in prep['source']['photos']if p['name']==photo['name'])
        refs.append({'name':photo['name'],'previewUrl':'/generated/cb/photos/'+target.name,'sourceUrl':original['url'],'originalSha256':photo['sha256'],'previewSha256':sha(target),'use':photo['split']})
    validation=[]
    for photo in val_photos[::max(1,len(val_photos)//4)][:4]:
        original=Image.open(prepared/'images'/photo['processed']).convert('RGBA')
        prediction=Image.open(trained/f"eval_{selected['iteration']}"/photo['processed']).convert('RGBA')
        if photo['orientation']:original=original.rotate(90,expand=True);prediction=prediction.rotate(90,expand=True)
        original.thumbnail((680,480));prediction.thumbnail((680,480))
        stem=Path(photo['name']).stem
        original.save(out/'validation'/f'{stem}-input.png');prediction.save(out/'validation'/f'{stem}-render.png')
        validation.append({'name':photo['name'],'inputUrl':f'/generated/cb/validation/{stem}-input.png','renderUrl':f'/generated/cb/validation/{stem}-render.png'})
    # A close source camera is useful for verification but makes a poor orbit
    # pivot. Fit navigation to the common optical focus of wide exterior views.
    matrices=[];rhs=[]
    for i in [0,12,18,24,30,36,144,150,156,165]:
        capture=np.array(prep['photographs'][i]['frame']['transform_matrix']);direction=-capture[:3,2]
        m=np.eye(3)-np.outer(direction,direction);matrices.append(m);rhs.append(m@capture[:3,3])
    target=np.linalg.solve(np.sum(matrices,axis=0),np.sum(rhs,axis=0))
    seed_bytes=(prepared/'init.ply').read_bytes();seed_offset=seed_bytes.index(b'end_header\n')+11
    seeds=np.frombuffer(seed_bytes[seed_offset:],dtype=[('xyz','<f4',(3,)),('rgb','u1',(3,))])['xyz']
    radius=float(np.quantile(np.linalg.norm(seeds-target,axis=1),.95))
    # Standard display cleanup: remove very transparent and oversized splats,
    # preserving the exact learned record of every retained Gaussian. The full
    # checkpoint remains downloadable, with its original bytes and hash.
    alpha=1/(1+np.exp(-data['opacity']))
    max_scale=radius*.1
    keep=(alpha>=.015)&(scales.max(axis=1)<=max_scale)
    indices=np.flatnonzero(keep).astype('<u4')
    if len(indices)<len(data)*.2:raise ValueError('Display filter removed too much geometry')
    filtered=data[keep]
    filtered_head=head.replace(f'element vertex {count}',f'element vertex {len(filtered)}').replace('end_header\n','comment Workspace display filter; complete checkpoint available separately\nend_header\n')
    (out/'model.ply').write_bytes(filtered_head.encode()+filtered.tobytes())
    (out/'kept-indices.bin').write_bytes(indices.tobytes())
    display={'rawCount':count,'keptCount':len(filtered),'minimumOpacity':.015,'maximumOneSigmaScale':max_scale,'referenceSeedRadius':radius,'rule':'Keep trained records with opacity >=0.015 and largest one-sigma scale <=0.1 times the navigation reference radius. Conservative presentation cleanup only; no points added or parameters changed.','indicesUrl':'/generated/cb/kept-indices.bin','indicesSha256':sha(out/'kept-indices.bin')}
    xyz=xyz[keep]
    capture=np.array(prep['photographs'][24]['frame']['transform_matrix'])
    direction=capture[:3,3]-target;direction[1]=0;direction/=np.linalg.norm(direction)
    distance=radius/np.sin(np.deg2rad(55/2))
    position=target+direction*distance;position[1]=capture[1,3]
    camera={'position':position.tolist(),'target':target.tolist(),'fov':55,'fitMargin':1.08,'framing':'Wide exterior camera-ray least-squares focus and 95th-percentile independently triangulated seed radius, keeping source camera height; navigation framing only, not a surveyed position'}
    short_run={**run,'args':[str(a).replace(str(ROOT),'workspace')for a in run['args']],'device':re.search(r'Using adapter AdapterInfo \{ name: "([^"]+)"',log).group(1),'selectedCheckpoint':selected,'validationHistory':metrics,'nativeWholeImageHistory':native_metrics,'modelSha256':sha(source),'modelBytes':source.stat().st_size,'trainingLogSha256':sha(trained/'training.log'),'validationCaveat':'Architecture-region PSNR: resize prepared RGB and mask to exported render size with Pillow bilinear; use source mask >=254; RGB MSE on valid pixels, PSNR averaged over 20 withheld views. Native Brush whole-image metrics include untrained background and are retained separately. No geometric accuracy is implied. Best checkpoint selected by architecture-region validation PSNR.'}
    (out/'training.json').write_text(json.dumps(short_run,ensure_ascii=False,indent=2),encoding='utf8')
    shutil.copyfile(trained/'training.log',out/'training.txt')
    manifest={'schema':1,'id':'local-cb','kind':'gaussian','representation':'trained-3dgs','delivery':'local','title':'托斯卡纳穹顶建筑','subtitle':'意大利 · 托斯卡纳 · 原始影像场景 5_CB','url':'/generated/cb/model.ply','rawUrl':'/generated/cb/raw-model.ply','rawPointCount':count,'rawBytes':source.stat().st_size,'rawSha256':sha(source),'displayFilter':display,'previewUrl':refs[1]['previewUrl'],'pointCount':len(filtered),'bytes':(out/'model.ply').stat().st_size,'sha256':sha(out/'model.ply'),'shDegree':1,'credit':'古址天眸 · 本机训练 / 原始摄影：Pellis 等','license':'CC BY 4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','sourceUrl':'https://zenodo.org/records/14626611','sourceManifest':'/generated/cb/source.json','trainingRecordUrl':'/generated/cb/training.json','trainingLogUrl':'/generated/cb/training.txt','trainedInThisApp':True,'trainedByAuthor':False,'metricScaleVerified':False,'georeferenced':False,'description':'由本机对公开许可的历史建筑多视角照片重新训练生成。使用来源相机参数和建筑标注，本机完成特征匹配、三角化初始化与高斯优化；没有下载成品高斯模型，也没有使用单图深度表面替代。展示版仅过滤低透明度与超大浮点，完整训练文件另外保留。','training':short_run,'preparation':prep,'photographs':refs,'validation':validation,'camera':camera,'bounds':{'min':xyz.min(axis=0).tolist(),'max':xyz.max(axis=0).tolist()},'packagedAt':datetime.now(timezone.utc).isoformat(),'geometryPolicy':'Source camera coordinates retained. Every learned Gaussian/SH field retained in complete raw PLY; exact unmodified records retained by display filter, no new geometry. Only photographed regions optimized; unseen portions not manufactured.'}
    text=json.dumps(manifest,ensure_ascii=False,indent=2)
    (out/'source.json').write_text(text,encoding='utf8')
    catalog={k:v for k,v in manifest.items()if k not in ['preparation','training']}
    catalog['training']={k:v for k,v in short_run.items()if k in ['status','startedAt','endedAt','tool','version','device','photoCount','trainingImages','validationImages','initialPoints','selectedCheckpoint','validationCaveat']}
    catalog['training']['completedSteps']=12000
    (ROOT/'src/localGaussianCatalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding='utf8')
    print(f'Published locally trained model: {count} Gaussians, checkpoint {selected}, SHA256 {sha(source)}')
if __name__=='__main__':main()
