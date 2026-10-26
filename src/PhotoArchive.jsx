import { useState } from "react";
import { Box, Camera, Download, ExternalLink, Layers } from "lucide-react";
import { SplatViewer } from "./SplatViewer.jsx";
import { download } from "./project.js";

export function PhotoArchiveStage({ asset }) {
  const [mode, setMode] = useState("gaussian");
  const photo = asset.photos[0];
  return <div className="photo-archive-stage">
    <div className="archive-view-modes" role="group" aria-label="影像查看方式">
      {[["gaussian", "高斯预览", Box], ["photo", "来源照片", Camera], ["depth", "相对深度", Layers]].map(([id, title, Icon]) =>
        <button key={id} aria-pressed={mode === id} onClick={() => setMode(id)}><Icon size={14} />{title}</button>)}
    </div>
    {mode === "gaussian" ? <SplatViewer modelUrl={asset.modelUrl} sourceAsset={asset} name={asset.subject} /> :
      <figure className="archive-image-stage"><img src={mode === "photo" ? photo.url : asset.depthUrl}
        alt={mode === "photo" ? asset.subject + "的来源照片" : asset.subject + "的推断相对深度图"} />
        <figcaption><strong>{mode === "photo" ? asset.subject : "相对深度 · 亮处较近，暗处较远"}</strong>
          <span>{mode === "photo" ? `${photo.author} · ${photo.license} · ${photo.capturedOn || "拍摄日期未提供"}` : "Depth Anything V2 Small · 无米制距离"}</span>
          <a href={mode === "photo" ? photo.url : asset.depthUrl} target="_blank" rel="noreferrer">查看完整影像 <ExternalLink size={13} /></a>
        </figcaption>
      </figure>}
  </div>;
}

export function PhotoArchiveSources({ asset }) {
  return <section className="heritage-evidence archive-evidence" aria-label="遗址影像来源">
    <div className="section-heading"><div><span className="eyebrow">PHOTOGRAPH TO GAUSSIANS</span><h2>一份影像，一份可追溯的空间记录</h2></div>
      <button className="text-button" onClick={() => download(`${asset.id}-provenance.json`, asset)}><Download size={14} />来源清单</button></div>
    <p>使用下列首张开放照片，经深度推断生成 {asset.pointCount.toLocaleString()} 个可交互高斯点。原图、深度图与模型一同保留，模型沿用原照片许可。</p>
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
