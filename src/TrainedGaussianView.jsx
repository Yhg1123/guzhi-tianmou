import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Box, Download, ExternalLink, Globe, Maximize2, X } from "lucide-react";
import { SplatViewer } from "./SplatViewer.jsx";
import { trainedGaussianCases } from "./trainedGaussians.js";

export default function TrainedGaussianView({ scene, onSelect, onBack }) {
  return <div className="reconstruction-page trained-gaussian-page">
    <div className="page-title"><div><span className="eyebrow">3D GAUSSIAN SPLATTING</span><h1>实景 3D 高斯</h1></div><button className="button" onClick={onBack}><ArrowLeft size={15} />返回遗址档案</button></div>
    <div className="trained-case-context"><label>选择场景<select aria-label="选择3D高斯场景" value={scene.id} onChange={(e) => onSelect(e.target.value)}>{trainedGaussianCases.map((c) => <option key={c.id} value={c.id}>{c.title} · {c.delivery === "online" ? "在线实景" : "本地模型"}</option>)}</select></label><span className="badge green">独立公开场景</span></div>
    <div className="reconstruction-grid trained-workspace-grid"><GaussianSceneStage key={scene.id} scene={scene} />
      <aside className="model-inspector"><div className="inspector-heading"><Box size={18} /><h2>三维场景信息</h2></div><span className="badge green">实景 3DGS</span><h3 className="model-name">{scene.title}</h3>
        <dl className="model-properties"><div><dt>拍摄地点</dt><dd>{scene.subtitle}</dd></div><div><dt>模型类型</dt><dd>训练后的三维高斯场景</dd></div><div><dt>高斯数量</dt><dd>{scene.pointCountLabel}</dd></div><div><dt>加载方式</dt><dd>{scene.delivery === "online" ? "来源平台在线加载" : `${(scene.bytes / 1048576).toFixed(1)} MB · 本地静态文件`}</dd></div><div><dt>空间操作</dt><dd>自由转动、平移、缩放</dd></div><div><dt>尺度与位置</dt><dd>未完成本站测量校核或地理配准</dd></div></dl>
        <div className="sample-credit"><strong>{scene.credit}</strong><span>{scene.license}</span><a href={scene.sourceUrl} target="_blank" rel="noreferrer">原始场景与作者 <ExternalLink size={12} /></a>{scene.licenseUrl && <a href={scene.licenseUrl} target="_blank" rel="noreferrer">许可条款 <ExternalLink size={12} /></a>}{scene.delivery === "local" && <><a href={scene.url} download><Download size={12} />下载高斯模型</a><a href={scene.sourceManifest} download><Download size={12} />来源与转换清单</a></>}</div>
        <p className="model-warning">此处是作者发布的独立实景场景，不代表当前项目中的咸阳、大明宫或其他遗址。模型已由来源作者训练；本站未重新训练。</p>
      </aside>
    </div>
    <section className="heritage-evidence"><div className="section-heading"><div><span className="eyebrow">CAPTURED IN THREE DIMENSIONS</span><h2>从不同方向，看同一处建筑</h2></div><a href={scene.sourceUrl} target="_blank" rel="noreferrer">来源说明 <ExternalLink size={13} /></a></div><p>{scene.description}</p>
      <div className="trained-evidence-grid"><div><strong>实景三维</strong><span>空间位置、方向、尺度和透明度来自训练后的高斯场景。</span></div><div><strong>自由观察</strong><span>模型具有空间体积，可以转到不同方位查看，超出采集覆盖的位置仍可能存在缺口。</span></div><div><strong>{scene.delivery === "online" ? "作者托管" : "本地可用"}</strong><span>{scene.delivery === "online" ? "使用来源平台提供的公开嵌入；加载进度及控制以画面为准。" : "完整保留约 96 万个高斯；未用普通点云或单图深度替代。"}</span></div></div>
      {scene.heritageSourceUrl && <a href={scene.heritageSourceUrl} target="_blank" rel="noreferrer">北京市文物局 · 灵岳寺档案 <ExternalLink size={12} /></a>}
    </section>
  </div>;
}

function GaussianSceneStage({ scene }) {
  const [expanded, setExpanded] = useState(false);
  const modal = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (!expanded) return undefined;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.current.showModal(); modal.current.querySelector('[data-close-scene]')?.focus();
    return () => { modal.current?.close(); document.body.style.overflow = old; trigger.current?.focus(); };
  }, [expanded]);
  const content = <><div className="gaussian-stage-heading"><span><Box size={15} />{scene.title}<small>{scene.delivery === "online" ? "在线 3DGS" : "本地 3DGS"}</small></span><button className="text-button" ref={expanded ? null : trigger} data-close-scene={expanded || undefined} aria-label={expanded ? "退出高斯全屏" : "全屏查看高斯场景"} onClick={() => setExpanded(!expanded)}>{expanded ? <X size={15} /> : <Maximize2 size={15} />}{expanded ? "退出全屏" : "全屏查看"}</button></div>
    {scene.delivery === "online" ? <div className="online-gaussian-stage"><iframe title={`${scene.title}3D高斯实景`} src={scene.embedUrl} allow="fullscreen; xr-spatial-tracking" referrerPolicy="strict-origin-when-cross-origin" /><div className="online-gaussian-note"><Globe size={12} />来源平台在线加载 · 进度与视角控制见画面<a href={scene.embedUrl} target="_blank" rel="noreferrer">独立窗口 <ExternalLink size={11} /></a></div></div> : <SplatViewer modelUrl={scene.url} name={scene.title} sampleData={scene} />}</>;
  return <><div className="gaussian-scene-stage">{expanded ? <div className="archive-expanded-placeholder"><Maximize2 size={24} /><span>正在全屏查看</span><button className="button" onClick={() => setExpanded(false)}>返回页面</button></div> : content}</div><dialog ref={modal} className="archive-fullscreen trained-fullscreen" aria-label="三维高斯全屏查看" onCancel={(e) => { e.preventDefault(); setExpanded(false); }}>{expanded && <div className="gaussian-scene-stage">{content}</div>}</dialog></>;
}
