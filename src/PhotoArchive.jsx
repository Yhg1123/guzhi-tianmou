import { useEffect, useRef, useState } from "react";
import { Box, Camera, Download, ExternalLink, Layers, Maximize2, X } from "lucide-react";
import { SplatViewer } from "./SplatViewer.jsx";
import { download } from "./project.js";

export function PhotoArchiveStage({ asset }) {
  const [mode, setMode] = useState("gaussian");
  const [photoId, setPhotoId] = useState(asset.photos[0].id);
  const [expanded, setExpanded] = useState(false);
  const modal = useRef(null);
  const expandButton = useRef(null);
  const photo = asset.photos.find((p) => p.id === photoId) || asset.photos[0];
  useEffect(() => {
    if (!expanded) return undefined;
    const dialog = modal.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    dialog.querySelector('[data-close-viewer]')?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      expandButton.current?.focus();
    };
  }, [expanded]);
  const content = <>
    <div className="archive-view-header"><div className="archive-view-modes" role="group" aria-label="影像查看方式">
      {[["gaussian", "高斯预览", Box], ["photo", "来源照片", Camera], ["depth", "相对深度", Layers]].map(([id, title, Icon]) =>
        <button key={id} aria-pressed={mode === id} onClick={() => setMode(id)}><Icon size={14} />{title}</button>)}
    </div><button className="archive-expand-button" ref={expanded ? null : expandButton} data-close-viewer={expanded || undefined} aria-label={expanded ? "退出全屏查看" : "全屏查看影像"} onClick={() => setExpanded(!expanded)}>{expanded ? <X size={16} /> : <Maximize2 size={15} />}<span>{expanded ? "退出全屏" : "全屏查看"}</span></button></div>
    {mode === "gaussian" ? <SplatViewer modelUrl={asset.modelUrl} sourceAsset={asset} name={asset.subject} /> : <>
      {mode === "photo" && asset.photos.length > 1 && <label className="archive-photo-picker">影像资料<select aria-label="选择档案照片" value={photo.id} onChange={(e) => setPhotoId(e.target.value)}>{asset.photos.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>}
      <figure className="archive-image-stage"><div className="archive-image-frame"><img src={mode === "photo" ? photo.url : asset.depthUrl}
        alt={mode === "photo" ? photo.title + "的来源照片" : asset.subject + "的推断相对深度图"} /></div>
        <figcaption><strong>{mode === "photo" ? photo.title : "相对深度 · 亮处较近，暗处较远"}</strong>
          <span>{mode === "photo" ? `${photo.author} · ${photo.license} · ${photo.capturedOn || "拍摄日期未提供"}` : "Depth Anything V2 Small · 无米制距离"}</span>
          <a href={mode === "photo" ? photo.url : asset.depthUrl} target="_blank" rel="noreferrer">查看完整影像 <ExternalLink size={13} /></a>
        </figcaption>
      </figure></>}
  </>;
  return <><div className="photo-archive-stage">{expanded ? <div className="archive-expanded-placeholder"><Maximize2 size={24} /><span>正在全屏查看影像</span><button className="button" onClick={() => setExpanded(false)}>返回页面</button></div> : content}</div>
    <dialog ref={modal} className="archive-fullscreen" aria-label="影像全屏查看" onCancel={(event) => { event.preventDefault(); setExpanded(false); }}>{expanded && <div className="photo-archive-stage">{content}</div>}</dialog></>;
}

export function PhotoArchiveSources({ asset }) {
  return <section className="heritage-evidence archive-evidence" aria-label="遗址影像来源">
    <div className="section-heading"><div><span className="eyebrow">PHOTOGRAPH TO GAUSSIANS</span><h2>一份影像，一份可追溯的空间记录</h2></div>
      <button className="text-button" onClick={() => download(`${asset.id}-provenance.json`, asset)}><Download size={14} />来源清单</button></div>
    <p>使用下列首张开放照片，经深度推断生成 {asset.pointCount.toLocaleString()} 个可交互高斯点。原图、深度图与模型一同保留，模型沿用原照片许可。</p>
    {asset.processing?.crop && <p className="archive-crop-note">模型保留原片完整横向取景，仅裁去上下方展墙与展柜。来源照片可查看未经裁切的原片，另附局部特写与遗迹陈列对照。</p>}
    <div className="archive-source-grid">{asset.photos.map((photo, i) => <article className="archive-source-card" key={photo.id}>
      <a href={photo.url} target="_blank" rel="noreferrer" aria-label={`查看${photo.title}原图`}><img src={i === 0 ? asset.previewUrl : photo.url} alt={photo.title} loading="lazy" /></a>
      <div><span className="eyebrow">{i === 0 ? "模型来源照片" : "补充影像"}</span><h3>{photo.title}</h3><p>{photo.author} · {photo.capturedOn || "拍摄日期未提供"}</p>
        <div className="archive-source-links"><a href={photo.sourceUrl} target="_blank" rel="noreferrer">来源页 <ExternalLink size={12} /></a>
          <a href={photo.licenseUrl || photo.sourceUrl} target="_blank" rel="noreferrer">{photo.license}</a><a href={photo.url} download>原图 <Download size={12} /></a></div></div>
    </article>)}</div>
    <details className="archive-method"><summary>生成方法与使用范围</summary>
      <p>Depth Anything V2 Small 推断单张照片的相对深度，再将像素反投影为带颜色、尺度与方向的各向异性高斯点。查看器限制转动范围，以便观察原图覆盖的表面。</p>
      <p>这是单图空间预览，未进行多视角 3DGS 训练。背面、遮挡区域与整处遗址的几何未知；相机参数为假定值，尺度和地理位置未标定，不能据此测量或判断修复方案。陈列模型仍是陈列模型，出土文物仍是文物影像；拍摄时间不代表当前现场状态。</p>
      <a href={asset.generation.codeUrl} target="_blank" rel="noreferrer">开源深度模型 · Apache 2.0 <ExternalLink size={12} /></a>
      <p className="archive-checksum">模型 SHA-256：{asset.sha256}</p>
    </details>
  </section>;
}
