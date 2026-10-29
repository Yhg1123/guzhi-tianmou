import { useEffect, useRef, useState } from "react";
import { Box, Camera, ChevronRight, Download, Landmark, Layers, Maximize2, X } from "lucide-react";
import { SplatViewer } from "./SplatViewer.jsx";

export default function ConceptGaussianWorkspace({ scene, onShowImagery, onCapture, inspection = false }) {
  const [expanded, setExpanded] = useState(false);
  const [viewRequest, setViewRequest] = useState(null);
  const [explain, setExplain] = useState(false);
  const modal = useRef(null), trigger = useRef(null), method = useRef(null);
  useEffect(() => {
    if (!expanded) return undefined;
    const dialog = modal.current, previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; dialog.showModal(); dialog.querySelector('[data-close-concept]')?.focus();
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; trigger.current?.focus(); };
  }, [expanded]);
  const focus = (preset) => setViewRequest({ preset, nonce: Date.now() });
  function showMethod() { setExplain(true); requestAnimationFrame(() => method.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" })); }
  const content = <><div className="concept-stage-heading"><span><Box size={16} /><strong>含元殿</strong><small>3D GAUSSIAN SPLATTING</small></span><button ref={expanded ? null : trigger} className="text-button" data-close-concept={expanded || undefined} aria-label={expanded ? "退出含元殿全屏" : "全屏查看含元殿高斯模型"} onClick={() => setExpanded(!expanded)}>{expanded ? <X size={15} /> : <Maximize2 size={15} />}{expanded ? "退出全屏" : "全屏探索"}</button></div><SplatViewer modelUrl={scene.url} name={scene.title} sampleData={scene} viewRequest={viewRequest} /></>;
  return <section className="concept-workspace" aria-label="大明宫含元殿三维高斯模型">
    {inspection && <div className="notice"><Box size={16} />内部画面检查 · 完成各方向检查后再进入项目展示</div>}
    <div className="concept-workspace-grid"><div className="concept-scene">{expanded ? <div className="archive-expanded-placeholder"><Maximize2 size={26} /><span>正在全屏探索含元殿</span><button className="button" onClick={() => setExpanded(false)}>返回工作台</button></div> : content}</div>
      <aside className="concept-inspector"><span className="eyebrow">DAMING PALACE</span><h2>含元殿</h2><span className="badge green">建筑复原构想</span><p>重檐主殿、两侧楼阁与高台回廊，组成一处可以环绕探索的建筑空间。</p>
        <div className="concept-focus-heading"><Landmark size={15} /><strong>走近建筑</strong></div><div className="concept-focus-grid">{[["hall", "主殿细节"], ["east", "东侧楼阁"], ["west", "西侧楼阁"], ["terrace", "台基与阶梯"]].map(([id, title]) => <button key={id} onClick={() => focus(id)}>{id === "terrace" ? <Layers size={15} /> : <Landmark size={15} />}<span>{title}</span><ChevronRight size={13} /></button>)}</div>
        <dl><div><dt>展示方式</dt><dd>可自由环绕、平移与缩放</dd></div><div><dt>素材生成</dt><dd>{scene.training.generatedViewCount} 个一致视角 · 本机训练</dd></div><div><dt>模型数据</dt><dd>{scene.pointCount.toLocaleString()} 个高斯 · {(scene.bytes / 1048576).toFixed(1)} MB</dd></div></dl>
        <button className="text-button concept-method-link" onClick={showMethod}>生成方法与使用范围 <ChevronRight size={13} /></button>
        <div className="concept-inspector-actions"><button className="button full-width" onClick={onShowImagery}><Camera size={15} />查看遗址影像</button><button className="button full-width" onClick={onCapture}>整理重建资料 <ChevronRight size={14} /></button></div>
        <small className="concept-scope-note">由本项目创作场景生成并训练，属于建筑复原构想，未进行实测复原校核。</small>
      </aside></div>
    <div className="concept-view-note"><Box size={16} /><span>拖拽旋转 · 右键平移 · 滚轮放大</span><span>正面、背面、侧面与屋顶均有空间结构</span></div>
    <details className="concept-method" ref={method} open={explain} onToggle={(e) => setExplain(e.currentTarget.open)}><summary>生成方法与使用范围</summary><p>先在本机创作同一个建筑场景，再生成 {scene.training.generatedViewCount} 个具有一致几何和相机参数的视角，使用 {scene.training.trainingViews} 个视角优化高斯模型，另保留 {scene.training.validationViews} 个视角比较。当前画面实时读取本地高斯文件，支持自由旋转。</p><p>这些素材是生成视图。建筑比例、构件和布局包含创作解释，模型没有测量尺度或地理配准；档案坐标仅表示关联项目。历史形制与现存遗迹仍需依据考古资料核验。</p><div className="concept-record-links"><a href={scene.sourceManifest} download><Download size={13} />生成来源与相机清单</a><a href={scene.trainingRecordUrl} download><Download size={13} />本机训练记录</a><a href={scene.trainingLogUrl} target="_blank" rel="noreferrer">原始训练日志</a><a href={scene.url} download><Download size={13} />下载高斯模型</a></div><div className="concept-input-grid">{scene.views.map((view) => <figure key={view.name}><img src={view.url} alt={`含元殿${view.label}的本机生成素材`} loading="lazy" /><figcaption>{view.label} · 生成素材</figcaption></figure>)}</div><details className="concept-validation"><summary>保留视角与高斯渲染对照</summary><p>图像一致性用于检查本次生成场景的再现效果，不代表遗址测量精度。初始化几何来自创作场景，保留视图没有参与图像优化。</p><div className="local-validation-grid">{scene.validation.map((pair) => <figure key={pair.name}><div><img src={pair.inputUrl} alt="保留的生成视角" loading="lazy" /><img src={pair.renderUrl} alt="本机高斯模型的对应视角" loading="lazy" /></div><figcaption>左：保留生成视角　右：高斯模型渲染</figcaption></figure>)}</div></details></details>
    <dialog ref={modal} className="archive-fullscreen concept-fullscreen" aria-label="含元殿三维高斯全屏" onCancel={(e) => { e.preventDefault(); setExpanded(false); }}>{expanded && <div className="concept-scene">{content}</div>}</dialog>
  </section>;
}
