"""Package a completed locally trained concept without calling it site capture."""
import hashlib,json,re,shutil
from pathlib import Path
from datetime import datetime,timezone
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'qa/daming-concept'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    prep=json.loads((BASE/'preparation.json').read_text(encoding='utf8'))
    run=json.loads((BASE/'trained/run.json').read_text(encoding='utf8'))
    if run['status']!='completed'or run['completedSteps']!=24000 or run['preparationSha256']!=sha(BASE/'preparation.json'):
        raise ValueError('Cannot package an incomplete or mismatched run')
    if prep['inputKind']!='locally-authored-multiview-renders'or not prep['notCapturedPhotographs']or not prep['notSurveyedRestoration']:
        raise ValueError('Generated-input provenance required')
    if sha(BASE/'trained/training.log')!=run['trainingLogSha256']:raise ValueError('Training log changed')
    validation=[v for v in prep['views']if v['split']=='validation']
    metrics=[]
    for native in run['validationHistory']:
        views=[]
        for view in validation:
            path=BASE/'prepared/images'/view['name'];prediction=BASE/f"trained/eval_{native['iteration']}"/view['name']
            image=Image.open(path).convert('RGBA');render=Image.open(prediction).convert('RGB')
            image=image.resize(render.size,Image.Resampling.BILINEAR)
            ref=np.asarray(image);pred=np.asarray(render)
            mask=ref[:,:,3]>=250
            mse=float(np.mean(((pred.astype(float)-ref[:,:,:3])/255)**2,axis=2)[mask].mean())
            views.append({'name':view['name'],'pixels':int(mask.sum()),'psnr':float(-10*np.log10(max(mse,1e-12)))})
        metrics.append({'iteration':native['iteration'],'psnr':float(np.mean([v['psnr']for v in views])),'views':views})
    selected=max(metrics,key=lambda v:v['psnr'])
    checkpoint=next(c for c in run['checkpoints']if c['iteration']==selected['iteration'])
    model=BASE/'trained'/checkpoint['file']
    if sha(model)!=checkpoint['sha256']:raise ValueError('Selected model changed')
    raw=model.read_bytes();offset=raw.index(b'end_header\n')+11;header=raw[:offset].decode()
    names=[s.split()[-1]for s in header.splitlines()if s.startswith('property float ')]
    if len(names)!=23 or 'comment SH degree: 1'not in header:raise ValueError('Expected learned degree-one Gaussian fields')
    data=np.frombuffer(raw[offset:],dtype=[(n,'<f4')for n in names]);count=len(data)
    if not all(np.isfinite(data[n]).all()for n in names):raise ValueError('Invalid learned fields')
    xyz=np.column_stack([data[n]for n in ['x','y','z']])
    out=ROOT/'public/generated/daming';(out/'views').mkdir(parents=True,exist_ok=True);(out/'validation').mkdir(exist_ok=True)
    shutil.copyfile(model,out/'model.ply')
    shutil.copyfile(BASE/'trained/training.log',out/'training.txt')
    review_path=BASE/'review.json'
    review=json.loads(review_path.read_text(encoding='utf8'))if review_path.exists()else{'sceneId':'daming-hanyuan','modelSha256':sha(model),'status':'pending','checks':{}}
    if review.get('modelSha256')!=sha(model):raise ValueError('Visual review belongs to a different model')
    shots=[]
    for index,label in [(1,'前侧'),(6,'东侧'),(12,'背面'),(18,'西侧'),(49,'屋顶'),(88,'近景')]:
        view=prep['views'][index];target=out/'views'/view['name'];shutil.copyfile(BASE/'prepared/images'/view['name'],target)
        shots.append({'name':view['name'],'label':label,'url':'/generated/daming/views/'+view['name'],'sha256':sha(target),'sourceKind':prep['inputKind'],'azimuth':view['azimuth'],'elevation':view['elevation']})
    pairs=[]
    for v in validation[:6]:
        stem=Path(v['name']).stem
        for role,path in [('input',BASE/'prepared/images'/v['name']),('render',BASE/f"trained/eval_{selected['iteration']}"/v['name'])]:
            shutil.copyfile(path,out/'validation'/f'{stem}-{role}.png')
        pairs.append({'name':v['name'],'inputUrl':f'/generated/daming/validation/{stem}-input.png','renderUrl':f'/generated/daming/validation/{stem}-render.png'})
    shutil.copyfile(BASE/'art-reference.png',out/'visual-reference.png')
    run={**run,'args':[str(a).replace(str(ROOT),'workspace')for a in run['args']],'foregroundValidation':metrics,'selectedCheckpoint':selected,'validationCaveat':'Image reproduction of the locally authored concept; use input alpha >=250 and RGB MSE. Held-out renders are not used in image optimization, but all initial geometry comes from the authored scene. No archaeological or geometric survey accuracy is implied.'}
    (out/'training.json').write_text(json.dumps(run,ensure_ascii=False,indent=2),encoding='utf8')
    manifest={'schema':1,'id':'daming-hanyuan','kind':'gaussian','representation':'trained-3dgs','interpretation':'architectural-concept','inputKind':prep['inputKind'],'title':'含元殿 · 复原构想','subtitle':'大明宫 · 唐代宫殿建筑意象','site':{'id':'demo-daming','name':'大明宫遗址','lng':108.969,'lat':34.307},'url':'/generated/daming/model.ply','rawUrl':'/generated/daming/model.ply','previewUrl':shots[0]['url'],'rawSha256':sha(model),'sha256':sha(model),'rawBytes':len(raw),'bytes':len(raw),'rawPointCount':count,'pointCount':count,'shDegree':1,'trainedInThisApp':True,'trainedByAuthor':False,'metricScaleVerified':False,'georeferenced':False,'notCapturedPhotographs':True,'notSurveyedRestoration':True,'credit':'古址天眸 · 本机创作与训练','sourceManifest':'/generated/daming/source.json','trainingRecordUrl':'/generated/daming/training.json','trainingLogUrl':'/generated/daming/training.txt','visualReferenceUrl':'/generated/daming/visual-reference.png','visualReferenceSha256':sha(out/'visual-reference.png'),'visualReferenceRole':'AI-generated art direction only; not a training input or viewer capture','qualityReview':review,'training':run,'preparation':prep,'views':shots,'validation':pairs,'camera':{'position':[55,37,78],'target':[0,0,0],'fov':38,'fitMargin':1.02},'viewpoints':{'top':{'position':[.02,160,.02],'target':[0,0,0],'fov':38},'hall':{'position':[31,17,48],'target':[0,9,0],'fov':40},'east':{'position':[53,16,28],'target':[34,6,3.8],'fov':42},'west':{'position':[-53,16,28],'target':[-34,6,3.8],'fov':42},'terrace':{'position':[24,13,38],'target':[0,2,12],'fov':45}},'bounds':{'min':xyz.min(axis=0).tolist(),'max':xyz.max(axis=0).tolist()},'references':[{'url':'https://www.mct.gov.cn/whzx/whyw/201112/t20111201_707767.htm','role':'Historical context and identity, not a geometric survey'},{'url':'https://commons.wikimedia.org/wiki/Category:Daming_Palace','role':'Research/reference imagery only, no external finished geometry used'}],'geometryPolicy':'Locally authored coherent 3D scene, calibrated generated views and area-sampled authored initialization, then actual Gaussian optimization. Complete learned covariance, rotation, opacity and SH retained. No single-image depth or borrowed finished model. Site coordinates are an archive association, not a georeferenced model.','packagedAt':datetime.now(timezone.utc).isoformat()}
    (out/'source.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    catalog={k:v for k,v in manifest.items()if k not in ['preparation','training']}
    catalog['training']={k:v for k,v in run.items()if k in ['status','tool','version','startedAt','endedAt','device','generatedViewCount','trainingViews','validationViews','completedSteps','initialPoints','selectedCheckpoint','validationCaveat']}
    (ROOT/'src/damingConceptCatalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding='utf8')
    (out/'README.md').write_text('# 含元殿 · 复原构想\n\n本项目自行构建建筑场景、生成一致多视角并在本机训练的 3D Gaussian Splatting。输入不是实拍照片，此模型不是实测复原或考古证据。创作单位没有米制标定，站点坐标仅用于档案关联。\n\n完整 Gaussian 参数、全部生成视角的哈希、相机、创作与训练记录见 source.json；实际训练日志见 training.txt。visual-reference.png 是 AI 生成的视觉设计参考，未作为训练照片，也不是查看器画面。views/ 为同一个本地创作场景的训练输入节选；validation/ 为保留输入及本机模型渲染对照。\n\n代码可重建本地创作场景；不包含借用的第三方成品网格或高斯模型。\n',encoding='utf8')
    print('Packaged concept',count,'Gaussians, checkpoint',selected['iteration'],'foreground PSNR',selected['psnr'],'review',review['status'],flush=True)


if __name__=='__main__':main()
