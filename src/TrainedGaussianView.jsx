import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Box, Camera, Download, ExternalLink, Maximize2, X } from "lucide-react";
import { SplatViewer } from "./SplatViewer.jsx";
import { trainedGaussianCases } from "./trainedGaussians.js";

export default function TrainedGaussianView({ scene, onSelect, onBack }) {
  return <div className="reconstruction-page trained-gaussian-page">
    <div className="page-title"><div><span className="eyebrow">LOCAL GAUSSIAN RECONSTRUCTION</span><h1>本机高斯重建</h1></div><button className="button" onClick={onBack}><ArrowLeft size={15} />遗址影像与模型档案</button></div>
    <div className="trained-case-context"><label>生成场景<select aria-label="选择3D高斯场景" value={scene.id} onChange={(e) => onSelect(e.target.value)}>{trainedGaussianCases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label><span className="badge green">本机生成 · 3DGS</span></div>
    <div className="reconstruction-grid trained-workspace-grid"><GaussianSceneStage key={scene.id} scene={scene} />
      <aside className="model-inspector"><div className="inspector-heading"><Box size={18} /><h2>生成结果</h2></div><span className="badge green">本机训练完成</span><h3 className="model-name">{scene.title}</h3>
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
  const modal = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (!expanded) return undefined;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.current.showModal(); modal.current.querySelector('[data-close-scene]')?.focus();
    return () => { modal.current?.close(); document.body.style.overflow = old; trigger.current?.focus(); };
  }, [expanded]);
  const content = <><div className="gaussian-stage-heading"><span><Box size={15} />{scene.title}<small>本机生成 · 3DGS</small></span><div className="local-model-modes" role="group" aria-label="模型版本"><button aria-pressed={!showRaw} onClick={() => setShowRaw(false)}>建筑展示</button><button aria-pressed={showRaw} onClick={() => setShowRaw(true)}>训练原版</button></div><button className="text-button" ref={expanded ? null : trigger} data-close-scene={expanded || undefined} aria-label={expanded ? "退出高斯全屏" : "全屏查看高斯场景"} onClick={() => setExpanded(!expanded)}>{expanded ? <X size={15} /> : <Maximize2 size={15} />}{expanded ? "退出全屏" : "全屏查看"}</button></div><SplatViewer modelUrl={showRaw ? scene.rawUrl : scene.url} name={scene.title} sampleData={scene} /></>;
  return <><div className="gaussian-scene-stage">{expanded ? <div className="archive-expanded-placeholder"><Maximize2 size={24} /><span>正在全屏查看</span><button className="button" onClick={() => setExpanded(false)}>返回页面</button></div> : content}</div><dialog ref={modal} className="archive-fullscreen trained-fullscreen" aria-label="三维高斯全屏查看" onCancel={(e) => { e.preventDefault(); setExpanded(false); }}>{expanded && <div className="gaussian-scene-stage">{content}</div>}</dialog></>;
}
