import { siteName } from "./presentation.js";
import { useEffect, useRef, useState } from "react";
import { get, set } from "idb-keyval";
import { ArrowLeft, Box, Camera, ChevronRight, CircleAlert, Download, ExternalLink, Upload } from "lucide-react";
import { SplatViewer } from "./SplatViewer.jsx";
import { download } from "./project.js";
import { heritageSample as defaultSample, pointCloudSamples } from "./heritageSample.js";
import { heritagePhotographs } from "./referenceSites.js";
import { siteModelKey, isSiteModel } from "./reconstruction.js";
import { findSiteArchive } from "./siteArchives.js";
import { PhotoArchiveStage, PhotoArchiveSources } from "./PhotoArchive.jsx";
import TrainedGaussianView from "./TrainedGaussianView.jsx";
import CaptureWorkspace from "./CaptureWorkspace.jsx";
import { experimentalGaussianCases, gaussianCaseId, gaussianCaseRoute, localGaussianCase } from "./trainedGaussians.js";
import { reconstructionRoute } from "./reconstruction.js";
const publicCases = [...pointCloudSamples, ...heritagePhotographs];

export default function ReconstructionView({ sites, selectedId, onSelectSite, onMap }) {
  const site = sites.find((s) => s.id === selectedId) || (!selectedId ? sites[0] : null);
  const [caseId, setCaseId] = useState(() => gaussianCaseId(window.location.hash));
  useEffect(() => { const change = () => setCaseId(gaussianCaseId(window.location.hash)); window.addEventListener("hashchange", change); return () => window.removeEventListener("hashchange", change); }, []);
  const onBack = () => { window.location.hash = site ? reconstructionRoute(site.id) : "map"; };
  if (caseId) {
    const scene = experimentalGaussianCases.find((c) => c.id === caseId);
    return scene ? <TrainedGaussianView key={scene.id} scene={scene} site={site} onSelect={(id) => { window.location.hash = gaussianCaseRoute(id, site?.id); }} onBack={onBack} /> : <div className="reconstruction-page"><div className="page-title"><div><span className="eyebrow">RECONSTRUCTION ARCHIVE</span><h1>{["lingyue", "seem-church"].includes(caseId) ? "外部模型入口已停用" : "未找到三维场景"}</h1></div></div><p className="muted">请返回对应遗址整理原片，或导入该遗址的本地模型。无关建筑不会替代项目成果。</p><button className="button primary" onClick={onBack}><ArrowLeft size={15} />返回遗址档案</button></div>;
  }
  return <ReconstructionProject key={`${site?.id}-${site?.lng}-${site?.lat}`} site={site} sites={sites} onSelectSite={onSelectSite} onMap={onMap} />;
}

function ReconstructionProject({ site, sites, onSelectSite, onMap }) {
  const [localModel, setModel] = useState(null);
  const archive = findSiteArchive(site);
  const model = localModel || (archive ? { name: archive.subject, url: archive.modelUrl, bytes: archive.bytes, archive } : null);
  const [loaded, setLoaded] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const [sampleMode, setSampleMode] = useState(heritagePhotographs.find((item) => item.siteId === site?.id)?.id || "heritage");
  const [tab, setTab] = useState("viewer");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  const modelInput = useRef(null);
  const key = siteModelKey(site);
  useEffect(() => {
    alive.current = true;
    if (key) get(key).then((data) => { if (alive.current && data) { if (isSiteModel(data, site)) setModel(data); else setNotice("本地模型记录未通过校验，原记录已保留，请重新导入对应模型。"); } }).catch(() => { if (alive.current) setNotice("本地模型存储不可用，仍可在本次会话查看。"); }).finally(() => { if (alive.current) setLoaded(true); });
    else setLoaded(true);
    return () => { alive.current = false; };
  }, [key]);
  async function openModel(file) {
    if (!file) return;
    setNotice("");
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      if (!["ply", "splat", "ksplat"].includes(ext)) throw new Error("支持 Gaussian PLY、SPLAT、KSPLAT 文件。");
      if (!file.size || file.size > 120 * 1024 * 1024) throw new Error("模型须大于 0 且不超过 120 MB，请先在 SuperSplat 中裁剪或压缩。");
      if (ext === "splat" && file.size % 32 !== 0) throw new Error("SPLAT 文件长度不符合标准 32 字节点记录格式。");
      if (ext === "ply") {
        const header = await file.slice(0, 65536).text();
        if (!header.startsWith("ply") || !header.includes("end_header") || !(header.includes("scale_0") || header.includes("packed_scale"))) throw new Error("这不是支持的高斯 PLY；普通点云或网格 PLY 不能直接作为 3DGS 模型。");
      }
      const next = { file, name: file.name, importedAt: new Date().toISOString(), site: { id: site.id, name: site.name, lng: site.lng, lat: site.lat } };
      if (!alive.current) return;
      setModel(next); setShowSample(false); setSaving(true);
      try { if (key) await set(key, next); if (alive.current) setNotice("模型已关联当前遗址并保存到此设备。"); }
      catch { if (alive.current) setNotice("模型已打开，但本地存储空间不足；关闭后需重新导入。"); }
      finally { if (alive.current) setSaving(false); }
    } catch (error) { if (alive.current) setNotice(error.message); }
  }
  const heritageSample = publicCases.find((item) => item.id === sampleMode) || defaultSample;
  const sample = showSample;
  const realSample = sample && sampleMode !== "synthetic";
  return <div className="reconstruction-page"><div className="page-title"><div><span className="eyebrow">DIGITAL CONSERVATION</span><h1>三维档案</h1></div><div className="button-row"><button className="button" onClick={onMap}><ArrowLeft size={15} />返回地图</button><label className="button primary"><Upload size={16} />导入高斯模型<input ref={modelInput} type="file" accept=".ply,.splat,.ksplat" aria-label="导入高斯模型" disabled={!site || saving || !loaded} onChange={(e) => { openModel(e.target.files[0]); e.target.value = ""; }} /></label></div></div>
    <div className="reconstruction-context"><label><LandmarkLabel previewingSample={sample && tab === "viewer"} /><select aria-label="三维档案关联遗址" value={site?.id || ""} onChange={(e) => onSelectSite(e.target.value)}>{!site && <option value="" disabled>请选择遗址</option>}{sites.map((s) => <option key={s.id} value={s.id}>{siteName(s)}</option>)}</select></label><div className="tabs" role="tablist" aria-label="三维工作区"><button role="tab" aria-selected={tab === "viewer"} onClick={() => setTab("viewer")}>{archive && !localModel ? "影像档案" : "模型档案"}</button><button role="tab" aria-selected={tab === "capture"} onClick={() => setTab("capture")}>重建准备</button></div></div>
    {tab === "viewer" && archive && !localModel && !sample && <div className="gaussian-upgrade-entry"><div><Camera size={20} /><span><strong>{siteName(site)} · 多视角重建资料</strong><small>现有资料为{archive.subjectType}影像；对应的多视角三维模型尚未建成。</small></span></div><button className="button primary" onClick={() => setTab("capture")}>整理重建原片 <ChevronRight size={14} /></button></div>}
    {notice && <div className="notice" role="status"><CircleAlert size={17} />{notice}</div>}
    {tab === "viewer" && loaded && !model && !sample ? <><SiteModelEmpty site={site} onImport={() => modelInput.current?.click()} onCapture={() => setTab("capture")} onBrowse={() => setShowSample(true)} /><HeritageCaseGallery active={sample ? sampleMode : ""} onSelect={(id) => { setSampleMode(id); setShowSample(true); }} /></> : tab === "viewer" ? <ModelWorkspace model={model} loaded={loaded} sample={sample} realSample={realSample} heritageSample={heritageSample} sampleMode={sampleMode} setSampleMode={setSampleMode} site={site} onToggleSample={() => setShowSample(!showSample)} onCapture={() => setTab("capture")} onSelectCase={(id) => { setSampleMode(id); setShowSample(true); }} /> : <CaptureWorkspace site={site} />}
    <details className="quality-project-link"><summary>本机训练检查记录</summary><p className="muted">托斯卡纳建筑的训练实验未通过画面检查，已与项目遗址分开保存。</p><button className="text-button" onClick={() => { window.location.hash = gaussianCaseRoute(localGaussianCase, site?.id); }}>查看问题记录与原片对照 <ChevronRight size={13} /></button></details>
  </div>;
}


function ModelWorkspace({ model, loaded, sample, realSample, heritageSample, sampleMode, setSampleMode, site, onToggleSample, onCapture, onSelectCase }) {
  const asset = !sample && model?.archive;
  const publicPhoto = realSample && heritageSample.kind === "photo";
  const [archiveView, setArchiveView] = useState({ mode: "photo", photo: null });
  const archivePhoto = asset && (archiveView.photo || asset.photos[0]);
  const archiveImage = asset && archiveView.mode === "photo";
  return <>
    {sample && <div className="sample-source-bar"><div><span className="badge green">开放实景案例</span><span>{heritageSample.subtitle}</span></div><select aria-label="选择公开三维案例" value={sampleMode} onChange={(e) => setSampleMode(e.target.value)}>{publicCases.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.kind === "photo" ? "实景照片" : "真实点云"}</option>)}</select></div>}
    <div className={"reconstruction-grid" + (asset ? " has-photo-archive" : "")}><div>{!loaded ? <div className="splat-stage"><div className="splat-overlay">读取模型档案…</div></div> : asset ? <PhotoArchiveStage asset={asset} onViewChange={setArchiveView} /> : publicPhoto ?
      <figure className="heritage-photo-stage"><img src={heritageSample.url} alt={heritageSample.description} /><figcaption><strong>{heritageSample.title} · {heritageSample.capturedOn}</strong><span>{heritageSample.credit} · {heritageSample.license}</span><a href={heritageSample.url} target="_blank" rel="noreferrer">查看完整照片 <ExternalLink size={13} /></a></figcaption></figure> :
      <SplatViewer file={sample ? null : model?.file} name={model?.name} isSample={sample} sampleMode={sampleMode} sampleData={heritageSample} />}</div>
      <aside className="model-inspector"><div className="inspector-heading"><Box size={19} /><h2>{asset ? "影像档案" : "模型信息"}</h2></div>
        <span className="badge green">{asset ? archiveView.mode === "photo" ? "来源照片" : archiveView.mode === "depth" ? "相对深度" : "单图空间预览" : realSample ? publicPhoto ? "开放实景照片" : "摄影测量点云" : "本地模型"}</span>
        <h3 className="model-name">{archiveImage ? archivePhoto.title : realSample ? heritageSample.title : model?.name || siteName(site)}</h3>
        <dl className="model-properties">
          <div><dt>关联遗址</dt><dd>{sample ? heritageSample.subtitle + "；独立公开案例" : siteName(site)}</dd></div>
          {asset && <div><dt>影像内容</dt><dd>{asset.subjectType}</dd></div>}
          {(!asset || archiveView.mode !== "depth") && <div><dt>文件大小</dt><dd>{((archiveImage ? archivePhoto.bytes : sample ? heritageSample.bytes : model?.file?.size || model?.bytes || 0) / 1048576).toFixed(2)} MB</dd></div>}
          <div><dt>坐标与尺度</dt><dd>{archiveImage ? "照片未完成测量校核" : publicPhoto ? "照片影像" : asset ? "相对尺度 · 未地理配准" : "局部坐标 / 未标定"}</dd></div>
          <div><dt>{archiveImage ? "影像来源" : "生成来源"}</dt><dd>{archiveImage ? "开放许可真实摄影" : asset ? archiveView.mode === "depth" ? "单图相对深度推断" : "开放照片 → 深度推断 → 高斯点" : realSample ? publicPhoto ? "开放许可真实摄影" : "公开摄影测量 · 彩色点云采样" : "用户导入，采集来源待核验"}</dd></div>
          <div><dt>查看器</dt><dd>{archiveImage || publicPhoto ? "完整来源照片" : asset && archiveView.mode === "depth" ? "相对深度影像" : "GaussianSplats3D · MIT"}</dd></div>
        </dl>
        {(asset || realSample) && <div className="sample-credit"><strong>{asset ? archiveImage ? archivePhoto.author : asset.photos[0].author : heritageSample.credit}</strong><span>{asset ? archiveImage ? archivePhoto.license : asset.license : heritageSample.license}</span><a href={asset ? archiveImage ? archivePhoto.sourceUrl : asset.photos[0].sourceUrl : heritageSample.sourceUrl} target="_blank" rel="noreferrer">原始来源与许可 <ExternalLink size={12} /></a>{asset && <a href={asset.modelUrl} download><Download size={12} />下载照片衍生模型</a>}{heritageSample.sourceManifest && !asset && <a href={heritageSample.sourceManifest} download>下载来源清单 <Download size={12} /></a>}</div>}
        <div className="model-actions"><button className="button full-width" onClick={onToggleSample}><Box size={15} />{sample ? "返回遗址档案" : "浏览开放实景"}</button><button className="button full-width" onClick={onCapture}><Camera size={15} />重建准备 <ChevronRight size={14} /></button></div>
        <p className="model-warning">{asset ? "单张照片的可见表面推断，背面未知；完整重建需要多视角照片。可切换原图与深度图对照。" : realSample ? publicPhoto ? "来源明确的真实摄影，不是三维模型或当前项目现场采集成果。" : "摄影测量点云采样，未训练 3DGS，显示尺度未标定。" : "模型的采集来源与精度需另行核验，不能直接作为测绘或结构安全依据。"}</p>
      </aside>
    </div>
    {asset ? <PhotoArchiveSources asset={asset} /> : <><div className="pipeline-strip"><span><Camera size={17} />多视角照片</span><ChevronRight size={15} /><a href="https://github.com/colmap/colmap" target="_blank" rel="noreferrer">COLMAP <small>相机位姿</small></a><ChevronRight size={15} /><a href="https://github.com/nerfstudio-project/gsplat" target="_blank" rel="noreferrer">gsplat <small>高斯训练</small></a><ChevronRight size={15} /><span><Box size={17} />三维档案</span><span className="badge gray">采集清单不自动训练</span></div>{realSample && <HeritageDataSources sample={heritageSample} />}</>}
    <HeritageCaseGallery active={sample ? sampleMode : ""} onSelect={onSelectCase} />
  </>;
}

function SiteModelEmpty({ site, onImport, onCapture, onBrowse }) {
  return <><div className="site-model-empty" role="region" aria-label="当前遗址三维模型"><span className="site-model-emblem"><Box size={36} strokeWidth={1.2} /></span><span className="eyebrow">SITE MODEL ARCHIVE</span><h2>{site ? siteName(site) + "的三维模型待接入" : "未找到对应遗址"}</h2><p>{site ? "导入与本遗址对应的模型后，点击地图定位标即可直接查看。" : "此链接对应的遗址不在当前项目中，请返回地图重新选择。"}</p><div className="button-row"><button className="button primary" disabled={!site} onClick={onImport}><Upload size={16} />导入遗址模型</button><button className="button" disabled={!site} onClick={onCapture}><Camera size={16} />准备重建资料</button></div><button className="text-button" onClick={onBrowse}>浏览开放遗产案例 <ChevronRight size={14} /></button></div></>;
}

function LandmarkLabel({ previewingSample }) { return <span className="muted">{previewingSample ? "本地档案遗址" : "关联遗址"}</span>; }

function HeritageDataSources({ sample }) {
  return <section className="heritage-evidence section" aria-label="实景数据来源">
    <div className="section-heading"><div><span className="eyebrow">SOURCE & PROVENANCE</span><h2>从真实资料到数字档案</h2></div><a href={sample.sourceUrl} target="_blank" rel="noreferrer">查看数据与许可 <ExternalLink size={13} /></a></div>
    <div className="evidence-metrics"><div><strong>{sample.imageCount.toLocaleString("en-US")}</strong><span>{sample.kind === "photo" ? "收录公开照片" : "来源数据集影像"}</span></div>{sample.pointCount && <div><strong>{sample.pointCount.toLocaleString("en-US")}</strong><span>当前预览采样点</span></div>}<div><strong>{sample.kind === "photo" ? "CC0" : "CC BY"}</strong><span>按来源许可使用</span></div></div>
    <p>{sample.description}</p><div className="evidence-links"><a className="button" href={sample.sourceUrl} target="_blank" rel="noreferrer"><Camera size={15} />原始来源与完整资料 <ExternalLink size={13} /></a><a className="button" href={sample.url} download><Download size={15} />下载{sample.kind === "photo" ? "公开照片" : "预览模型"}</a></div>
    <small className="muted">{sample.kind === "photo" ? "本地保留原始开放照片；拍摄日期不代表现状调查日期，此处展示原始照片；关联遗址另有照片高斯预览。" : "原始照片及完整数据请按来源站点流程获取。此处为保留真实 XYZ/RGB 的点云采样，未完成高斯训练、测量标定或地理配准。"}</small>
  </section>;
}

function HeritageCaseGallery({ active, onSelect }) {
  return <section className="heritage-case-library" aria-label="开放遗产案例库"><div className="section-heading"><div><span className="eyebrow">OPEN HERITAGE COLLECTION</span><h2>让遗产，有更多被看见的方式</h2><p className="muted">2 份真实三维点云 · 2 处开放摄影案例 · 每份资料保留来源</p></div><span className="badge gray">独立案例库 · 不覆盖本地档案</span></div><div className="heritage-case-grid">{publicCases.map((item) => <button key={item.id} className={"heritage-case" + (active === item.id ? " selected" : "")} aria-pressed={active === item.id} onClick={() => onSelect(item.id)}><img src={item.previewUrl} alt={item.title + (item.kind === "photo" ? "真实摄影" : "真实点云预览")} width="600" height="380" loading="lazy" /><div><span>{item.kind === "photo" ? "开放摄影 · CC0" : "三维点云 · CC BY"}</span><h3>{item.title}<ChevronRight size={16} /></h3><small>{item.subtitle}</small></div></button>)}</div></section>;
}
