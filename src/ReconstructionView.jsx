import { useEffect, useRef, useState } from "react";
import { Box, Camera, ChevronRight, CircleAlert, Download, ExternalLink, FolderOpen, Upload } from "lucide-react";
import { SplatViewer } from "./SplatViewer.jsx";
import { download } from "./project.js";
import { loadSiteArchive, saveSiteModel, saveSiteCapture } from "./archive.js";
import { createModelImportSession, validateModelFile, readArchiveForEditing, currentModelViewerStatus } from "./modelValidation.js";

export default function ReconstructionView({ project, sites, selectedId, onSelectSite }) {
  const site = sites.find((s) => s.id === selectedId) || sites[0];
  return <ReconstructionProject key={`${project.archiveId}:${site?.id || "none"}`} project={project} site={site} sites={sites} onSelectSite={onSelectSite} />;
}

function ReconstructionProject({ project, site, sites, onSelectSite }) {
  const [modelState, setModelState] = useState({ model: null, candidate: null, saving: false });
  const { model, candidate, saving } = modelState;
  const [loaded, setLoaded] = useState(false);
  const [viewerState, setViewerState] = useState(null);
  const [showSample, setShowSample] = useState(false);
  const [tab, setTab] = useState("viewer");
  const [notice, setNotice] = useState("");
  const [photos, setPhotos] = useState([]);
  const [checks, setChecks] = useState({ permission: false, coverage: false, scale: false });
  const [captureReady, setCaptureReady] = useState(false);
  const sessionRef = useRef(null);
  const importRequest = useRef(0);
  const captureWrites = useRef(Promise.resolve());
  const key = site ? `${project.archiveId}:${site.id}` : null;
  useEffect(() => {
    let active = true;
    const session = createModelImportSession({
      persist: (next) => saveSiteModel(project, site, next),
      onChange: setModelState,
    });
    sessionRef.current = session;
    if (key) readArchiveForEditing(() => loadSiteArchive(project, site)).then(({ archive, captureReady: writable, error }) => {
      if (!active) return;
      if (error) setNotice("本地档案读取失败；采集清单暂不可编辑，请重新打开本页后再试。");
      session.restore(archive?.model);
      if (archive?.capture) {
        setPhotos(archive.capture.photos || []);
        setChecks(archive.capture.checks || { permission: false, coverage: false, scale: false });
      }
      setCaptureReady(writable);
      setLoaded(true);
    });
    else { setLoaded(true); setCaptureReady(true); }
    return () => { active = false; importRequest.current += 1; session.dispose(); };
  }, [key]);
  useEffect(() => {
    if (!captureReady || !key) return;
    let active = true;
    // Keep rapid checkbox/photo-list edits ordered for this specific archive.
    captureWrites.current = captureWrites.current.catch(() => {}).then(() => {
      return saveSiteCapture(project, site, { photos, checks });
    }).catch(() => { if (active) setNotice("采集清单未能保存，请导出任务清单备份。"); });
    return () => { active = false; };
  }, [photos, checks, captureReady, key]);
  async function openModel(file) {
    if (!file) return;
    const request = ++importRequest.current;
    const session = sessionRef.current;
    setNotice("");
    try {
      await validateModelFile(file);
      if (request !== importRequest.current || session !== sessionRef.current) return;
      session.stage({ file, name: file.name, importedAt: new Date().toISOString() });
      setShowSample(false); setTab("viewer");
      setNotice("正在验证模型；加载成功后才会替换当前遗址档案。");
    } catch (error) { if (request === importRequest.current) setNotice(error.message); }
  }
  async function modelReady(token) {
    if (!token) return;
    const outcome = await sessionRef.current?.accept(token);
    if (!outcome?.accepted) return;
    setNotice(outcome.saved ? "模型已通过加载验证，并保存到当前遗址的本地档案。" : "模型已通过加载验证，但本地保存失败；仅本次会话可用，请保留原文件。");
  }
  function modelFailed(token, error) {
    if (!token || !sessionRef.current?.reject(token)) return;
    const previous = sessionRef.current.snapshot().model;
    setNotice(`模型验证失败：${error.message || "文件无法加载"}。${previous ? "原有模型档案未被替换。" : "未保存为有效模型档案。"}`);
  }
  async function selectPhotos(files) {
    const valid = Array.from(files).filter((f) => /\.(jpe?g|png|webp)$/i.test(f.name));
    if (valid.length > 1000 || valid.some((f) => f.size > 50 * 1024 * 1024)) { setNotice("最多选择 1,000 张照片，每张不超过 50 MB。"); return; }
    setPhotos(valid.map((f) => ({ name: f.name, size: f.size, modifiedAt: new Date(f.lastModified).toISOString() })));
    setNotice(`${valid.length} 张照片已登记；这里只登记清单，未上传或开始训练。`);
  }
  const displayedModel = candidate?.model || model;
  const sample = !displayedModel || showSample;
  const viewerStatus = currentModelViewerStatus(displayedModel, viewerState);
  return <div className="reconstruction-page"><div className="page-title"><div><span className="eyebrow">DIGITAL CONSERVATION</span><h1>三维档案</h1></div><label className="button primary"><Upload size={16} />导入高斯模型<input type="file" accept=".ply,.splat,.ksplat" aria-label="导入高斯模型" disabled={!site || saving || !loaded} onChange={(e) => { openModel(e.target.files[0]); e.target.value = ""; }} /></label></div>
    <div className="reconstruction-context"><label><LandmarkLabel /><select aria-label="三维档案关联遗址" value={site?.id || ""} onChange={(e) => onSelectSite(e.target.value)}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><div className="tabs" role="tablist" aria-label="三维工作区"><button role="tab" aria-selected={tab === "viewer"} onClick={() => setTab("viewer")}>模型档案</button><button role="tab" aria-selected={tab === "capture"} onClick={() => setTab("capture")}>重建准备</button></div></div>
    {notice && <div className="notice" role="status"><CircleAlert size={17} />{notice}</div>}
    {tab === "viewer" ? <><div className="reconstruction-grid"><div>{loaded ? <SplatViewer file={sample ? null : displayedModel.file} name={displayedModel?.name} isSample={sample} onStatusChange={sample ? undefined : (status) => setViewerState({ file: displayedModel.file, status })} onReady={sample ? undefined : () => modelReady(candidate)} onError={sample ? undefined : (error) => modelFailed(candidate, error)} /> : <div className="splat-stage"><div className="splat-overlay">读取模型档案…</div></div>}</div><aside className="model-inspector"><div className="inspector-heading"><Box size={19} /><h2>模型信息</h2></div><span className={`badge ${sample || candidate || viewerStatus !== "ready" ? "amber" : "green"}`}>{sample ? "渲染校验样例" : viewerStatus === "error" ? "当前加载失败" : candidate || viewerStatus !== "ready" ? "待加载验证" : saving ? "已验证 · 保存中" : "已验证模型"}</span><h3 className="model-name">{sample ? "合成亭阁" : displayedModel.name}</h3><dl className="model-properties"><div><dt>关联遗址</dt><dd>{sample ? "样例不关联真实遗址" : site?.name}</dd></div><div><dt>文件大小</dt><dd>{sample ? "程序生成" : `${(displayedModel.file.size / 1024 / 1024).toFixed(2)} MB`}</dd></div><div><dt>坐标与尺度</dt><dd>局部坐标 / 未标定</dd></div><div><dt>重建来源</dt><dd>{sample ? "合成数据，非照片重建" : "用户导入，采集来源待核验"}</dd></div><div><dt>查看器</dt><dd>GaussianSplats3D · MIT</dd></div></dl><div className="model-actions">{displayedModel && <button className="button full-width" onClick={() => setShowSample(!showSample)}><Box size={15} />{showSample ? "返回遗址模型" : "查看校验样例"}</button>}<button className="button full-width" onClick={() => setTab("capture")}><Camera size={15} />重建准备 <ChevronRight size={14} /></button></div><p className="model-warning">高斯模型用于现状影像记录，不能凭空复原已消失的古建筑，也不能直接作为测绘或结构安全依据。</p></aside></div><div className="pipeline-strip"><span><Camera size={17} />多视角照片</span><ChevronRight size={15} /><a href="https://github.com/colmap/colmap" target="_blank" rel="noreferrer">COLMAP <small>相机位姿</small></a><ChevronRight size={15} /><a href="https://github.com/nerfstudio-project/gsplat" target="_blank" rel="noreferrer">gsplat <small>高斯训练</small></a><ChevronRight size={15} /><span><Box size={17} />三维档案</span><span className="badge gray">训练端未连接</span></div></> : <div className="capture-layout"><section><div className="section-heading"><h2>采集资料</h2><span className="badge gray">{captureReady ? "本地清单" : loaded ? "档案读取失败" : "读取中"}</span></div><label className="photo-upload"><Camera size={36} strokeWidth={1.2} /><strong>{photos.length ? `${photos.length} 张采集照片` : "登记多视角照片"}</strong><span>JPG / PNG / WEBP</span><span className="button"><FolderOpen size={15} />选择照片</span><input type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="登记采集照片" disabled={!captureReady} onChange={(e) => { selectPhotos(e.target.files); e.target.value = ""; }} /></label><div className="photo-list">{photos.slice(0, 8).map((p, i) => <div key={i}><Camera size={14} /><span>{p.name}</span><small>{(p.size / 1024 / 1024).toFixed(1)} MB</small></div>)}{photos.length > 8 && <small>另有 {photos.length - 8} 张</small>}</div><div className="checklist">{[["permission", "已确认拍摄与数据使用授权"], ["coverage", "已检查多视角覆盖、遮挡与曝光"], ["scale", "已准备控制点或尺度参照"]].map(([id, title]) => <label key={id}><input type="checkbox" disabled={!captureReady} checked={Boolean(checks[id])} onChange={(e) => setChecks({ ...checks, [id]: e.target.checked })} />{title}</label>)}</div><button className="button primary" disabled={!site || !photos.length} onClick={() => download("三维重建-任务清单.json", { schema: 1, site, photos, checks, createdAt: new Date().toISOString(), pipeline: ["COLMAP", "gsplat", "GaussianSplats3D"], trainingStatus: "not_started", constraints: "照片清单不含图像字节。照片数不代表重建质量，需检查位姿、覆盖和尺度。" })}><Download size={16} />导出重建任务清单</button></section><aside className="capture-workflow"><h2>重建流程</h2>{[["01", "影像采集", "围绕现存建筑采集连续、多高度视角。保留原始照片、设备信息与采集日期。"], ["02", "相机解算", "COLMAP 提取匹配特征，估计相机位姿；检查注册率与稀疏点云。"], ["03", "高斯训练", "在兼容的 CUDA / PyTorch 环境中运行 gsplat。本站尚未连接训练服务。"], ["04", "档案与检验", "裁剪杂点、导出模型，关联遗址；测量前单独完成尺度和精度校核。"]].map(([n, title, body]) => <div className="workflow-step" key={n}><span>{n}</span><div><h3>{title}</h3><p>{body}</p></div></div>)}<a href="https://github.com/playcanvas/supersplat" target="_blank" rel="noreferrer">SuperSplat 模型编辑器 <ExternalLink size={14} /></a></aside></div>}
  </div>;
}

function LandmarkLabel() { return <span className="muted">关联遗址</span>; }
