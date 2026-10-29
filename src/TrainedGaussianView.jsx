import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Box, Camera, CircleAlert, Download, ExternalLink, Maximize2, X } from "lucide-react";
import { SplatViewer } from "./SplatViewer.jsx";
import { experimentalGaussianCases } from "./trainedGaussians.js";
import { siteName } from "./presentation.js";

export default function TrainedGaussianView({ scene, site, onSelect, onBack }) {
  const [inspect, setInspect] = useState(false);
  const review = scene.qualityReview;
  if (inspect) return <><div className="quality-inspection-banner" role="status"><CircleAlert size={17} /><span>内部训练检查 · 未通过展示验收 · 此建筑与{site ? siteName(site) : "项目遗址"}无关联</span><button className="text-button" onClick={() => setInspect(false)}>收起模型</button></div><TrainingInspection {...{ scene, onSelect, onBack }} /></>;
  return <div className="reconstruction-page gaussian-quality-page">
    <div className="page-title"><div><span className="eyebrow">RECONSTRUCTION REVIEW</span><h1>重建质量检查</h1></div><button className="button" onClick={onBack}><ArrowLeft size={15} />{site ? `返回${siteName(site)}档案` : "返回遗址档案"}</button></div>
    <section className="quality-verdict"><CircleAlert size={26} /><div><span className="badge amber">未通过展示验收</span><h2>{scene.title}</h2><p>本次训练已完成，但画面质量尚不合格。已退出正常遗址展示，保留原片、训练模型与问题记录以便继续改进。</p><small>原始影像地点：{scene.subtitle} · {scene.license}</small></div></section>
    <div className="quality-findings">{review.findings.map((item, i) => <article key={item.id}><span>0{i+1}</span><h3>{item.title}</h3><p>{item.detail}</p></article>)}</div>
    <section className="heritage-evidence quality-evidence" aria-label="未通过检查的画面对照"><div className="section-heading"><div><span className="eyebrow">PHOTOGRAPH / RECONSTRUCTION</span><h2>先看原片，再看重建</h2></div><span className="muted">同一保留视角 · 未参与训练</span></div><p>下面的对照用于检查结构与细节；训练步数、点数和图像分数都不能替代画面验收。</p><div className="local-validation-grid">{scene.validation.map((v) => <figure key={v.name}><div><img src={v.inputUrl} alt={v.name + " 保留原片"} /><img src={v.renderUrl} alt={v.name + " 本机训练渲染，存在模糊和噪点"} /></div><figcaption>{v.name} · 左：原片　右：训练渲染</figcaption></figure>)}</div></section>
    <div className="quality-next-actions"><div><strong>项目重建继续使用对应遗址的原始资料</strong><p>当前实验不能填补其他遗址的模型空缺。返回档案可整理原片、补充多视角资料或导入对应模型。</p></div><button className="button primary" onClick={onBack}>继续整理遗址资料 <ArrowLeft size={14} /></button></div>
    <details className="quality-technical"><summary>开发检查与训练记录</summary><p>打开后从实际拍摄机位检查本地模型；可切换原片和实时高斯渲染。自由环绕仍可能暴露缺口，不能作为正式成果展示。</p><div className="button-row"><button className="button" onClick={() => setInspect(true)}><Box size={15} />打开内部模型检查</button><a className="button" href={scene.trainingRecordUrl} download><Download size={14} />训练记录</a><a className="button" href={scene.trainingLogUrl} download>原始日志</a></div><small>检查绑定模型 SHA-256：{review.modelSha256}</small></details>
  </div>;
}

function TrainingInspection({ scene, onSelect, onBack }) {
  return <div className="reconstruction-page trained-gaussian-page">
    <div className="page-title"><div><span className="eyebrow">LOCAL GAUSSIAN RECONSTRUCTION</span><h1>本机高斯重建</h1></div><button className="button" onClick={onBack}><ArrowLeft size={15} />遗址影像与模型档案</button></div>
    <div className="trained-case-context"><label>训练实验<select aria-label="选择3D高斯场景" value={scene.id} onChange={(e) => onSelect(e.target.value)}>{experimentalGaussianCases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label><span className="badge amber">画面检查未通过</span></div>
    <div className="reconstruction-grid trained-workspace-grid"><GaussianSceneStage key={scene.id} scene={scene} />
      <aside className="model-inspector"><div className="inspector-heading"><Box size={18} /><h2>训练记录</h2></div><span className="badge amber">训练完成 · 画面未通过</span><h3 className="model-name">{scene.title}</h3>
        <dl className="model-properties"><div><dt>影像地点</dt><dd>{scene.subtitle}</dd></div><div><dt>输入照片</dt><dd>{scene.training.photoCount} 张 · 多视角摄影</dd></div><div><dt>本机优化</dt><dd>{scene.training.completedSteps.toLocaleString()} 步 · {scene.rawPointCount.toLocaleString()} 个高斯</dd></div><div><dt>生成设备</dt><dd>{scene.training.device}</dd></div><div><dt>建筑展示版</dt><dd>{scene.pointCountLabel} 个高斯 · {(scene.bytes / 1048576).toFixed(1)} MB</dd></div><div><dt>尺度与位置</dt><dd>来源局部坐标 · 未完成本站测量校核</dd></div></dl>
        <div className="sample-credit"><strong>古址天眸 · 本机生成</strong><span>原始摄影：Pellis 等 · {scene.license}</span><a href={scene.url} download><Download size={12} />下载建筑展示版</a><a href={scene.rawUrl} download><Download size={12} />完整训练原模型</a><a href={scene.trainingRecordUrl} download><Download size={12} />本机训练记录</a><a href={scene.sourceManifest} download><Download size={12} />完整来源与处理清单</a><a href={scene.sourceUrl} target="_blank" rel="noreferrer">原始照片数据集 <ExternalLink size={12} /></a></div>
        <p className="model-warning">公开照片中的独立建筑，与当前中国遗址档案分开保存。遮挡、孔洞和采集之外的区域仍需补拍；生成结果不能直接作为测绘成果。</p>
      </aside>
    </div>
    <section className="heritage-evidence" aria-label="本机生成记录"><div className="section-heading"><div><span className="eyebrow">PHOTOGRAPHS TO GAUSSIANS</span><h2>从原片到三维，生成过程可追溯</h2></div><a href={scene.trainingLogUrl} target="_blank" rel="noreferrer">查看真实训练日志 <ExternalLink size={13} /></a></div><p>{scene.description}</p>
      <div className="trained-evidence-grid"><div><strong>{scene.training.trainingImages} 张训练照片</strong><span>使用公开相机参数，本机匹配图像特征并三角化初始化，建筑标注用于剔除背景。</span></div><div><strong>{scene.training.completedSteps.toLocaleString()} 步本地优化</strong><span>{scene.training.tool} {scene.training.version} 在本机显卡运行。保留训练后的尺度、旋转、透明度和一阶球谐颜色。</span></div><div><strong>{scene.training.validationImages} 张保留视角</strong><span>未参与三角化与优化。按验证图像 PSNR 选择导出版本，图像指标不代表测量精度。</span></div></div>
      <details className="local-training-validation"><summary>查看保留视角对照与质量记录</summary><p className="muted">训练原模型导出自第 {scene.training.selectedCheckpoint.iteration.toLocaleString()} 步，保留视角建筑区域平均 PSNR 为 {scene.training.selectedCheckpoint.psnr.toFixed(2)} dB。以下为原模型校验；展示版另外过滤透明与超大浮点，完整参数和计算方法见记录。未知标注不作为物理空洞。</p><div className="local-validation-grid">{scene.validation.map((v) => <figure key={v.name}><div><img src={v.inputUrl} alt={v.name + " 保留的建筑影像"} loading="lazy" /><img src={v.renderUrl} alt={v.name + " 本机模型新视角渲染"} loading="lazy" /></div><figcaption>{v.name} · 左：保留照片　右：模型渲染</figcaption></figure>)}</div></details>
    </section>
    <section className="heritage-evidence" aria-label="训练原片节选"><div className="section-heading"><div><span className="eyebrow">SOURCE PHOTOGRAPHS</span><h2><Camera size={18} />训练原片节选</h2></div><span className="muted">{scene.training.photoCount} 张照片保留原始哈希与来源</span></div><div className="local-source-grid">{scene.photographs.map((p) => <a key={p.name} href={p.sourceUrl} target="_blank" rel="noreferrer"><img src={p.previewUrl} alt={p.name + " 原始摄影缩略图"} loading="lazy" /><span>{p.name}<ExternalLink size={11} /></span></a>)}</div><p className="muted">摄影数据：Pellis、Masiero、Betti、Tucci、Grussenmeyer · CC BY 4.0。缩略图仅作资料核对，三维画面由本机训练的高斯文件实时绘制。</p></section>
  </div>;
}

function GaussianSceneStage({ scene }) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [captureId, setCaptureId] = useState(scene.captureViews[0].id);
  const [showPhoto, setShowPhoto] = useState(false);
  const capture = scene.captureViews.find((view) => view.id === captureId);
  const diagnosticScene = useMemo(() => ({ ...scene, captureCamera: capture, autoRotate: false }), [scene, capture]);
  const modal = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (!expanded) return undefined;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.current.showModal(); modal.current.querySelector('[data-close-scene]')?.focus();
    return () => { modal.current?.close(); document.body.style.overflow = old; trigger.current?.focus(); };
  }, [expanded]);
  const content = <><div className="gaussian-stage-heading"><span><Box size={15} />{scene.title}<small>内部训练检查</small></span><div className="local-model-modes" role="group" aria-label="模型版本"><button aria-pressed={!showRaw} onClick={() => setShowRaw(false)}>过滤版本</button><button aria-pressed={showRaw} onClick={() => setShowRaw(true)}>训练原版</button></div><button className="text-button" ref={expanded ? null : trigger} data-close-scene={expanded || undefined} aria-label={expanded ? "退出高斯全屏" : "全屏查看高斯场景"} onClick={() => setExpanded(!expanded)}>{expanded ? <X size={15} /> : <Maximize2 size={15} />}{expanded ? "退出全屏" : "全屏查看"}</button></div><div className="capture-comparison-toolbar"><label>拍摄机位<select aria-label="选择保留拍摄机位" value={captureId} onChange={(e) => setCaptureId(e.target.value)}>{scene.captureViews.map((view) => <option key={view.id} value={view.id}>{view.label} · {view.name}</option>)}</select></label><div role="group" aria-label="原片和实时模型对照"><button aria-pressed={!showPhoto} onClick={() => setShowPhoto(false)}>实时高斯</button><button aria-pressed={showPhoto} onClick={() => setShowPhoto(true)}>保留原片</button></div></div>{showPhoto ? <figure className="capture-comparison-photo"><img src={capture.inputUrl} alt={capture.name + " 保留原片，用于对照拍摄机位"} /><figcaption>保留照片 · {capture.name} · 来源相机机位</figcaption></figure> : <SplatViewer modelUrl={showRaw ? scene.rawUrl : scene.url} name={scene.title} sampleData={diagnosticScene} />}</>;
  return <><div className="gaussian-scene-stage">{expanded ? <div className="archive-expanded-placeholder"><Maximize2 size={24} /><span>正在全屏查看</span><button className="button" onClick={() => setExpanded(false)}>返回页面</button></div> : content}</div><dialog ref={modal} className="archive-fullscreen trained-fullscreen" aria-label="三维高斯全屏查看" onCancel={(e) => { e.preventDefault(); setExpanded(false); }}>{expanded && <div className="gaussian-scene-stage">{content}</div>}</dialog></>;
}
