import { useEffect, useRef, useState } from "react";
import { get, set } from "idb-keyval";
import { Box, Camera, ChevronRight, CircleAlert, Download, ExternalLink, FolderOpen, Upload } from "lucide-react";
import { SplatViewer } from "./SplatViewer.jsx";
import { download } from "./project.js";

export default function ReconstructionView({ sites, selectedId, onSelectSite }) {
  const site = sites.find((s) => s.id === selectedId) || sites[0];
  return <ReconstructionProject key={`${site?.id}-${site?.lng}-${site?.lat}`} site={site} sites={sites} onSelectSite={onSelectSite} />;
}

function ReconstructionProject({ site, sites, onSelectSite }) {
  const [model, setModel] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const [tab, setTab] = useState("viewer");
  const [notice, setNotice] = useState("");
  const [photos, setPhotos] = useState([]);
  const [checks, setChecks] = useState({ permission: false, coverage: false, scale: false });
  const [saving, setSaving] = useState(false);
  const [captureReady, setCaptureReady] = useState(false);
  const alive = useRef(true);
  const key = site ? `heritage-splat:${site.id}:${site.lng}:${site.lat}` : null;
  useEffect(() => {
    alive.current = true;
    if (key) get(key).then((data) => { if (alive.current) setModel(data || null); }).catch(() => { if (alive.current) setNotice("本地模型存储不可用，仍可在本次会话查看。"); }).finally(() => { if (alive.current) setLoaded(true); });
    else setLoaded(true);
    return () => { alive.current = false; };
  }, [key]);
  useEffect(() => {
    let active = true;
    if (!key) { setCaptureReady(true); return undefined; }
    get(`${key}:capture`).then((saved) => {
      if (active && saved) { setPhotos(saved.photos || []); setChecks(saved.checks || { permission: false, coverage: false, scale: false }); }
    }).catch(() => {}).finally(() => { if (active) setCaptureReady(true); });
    return () => { active = false; };
  }, [key]);
  useEffect(() => {
    if (captureReady && key) set(`${key}:capture`, { photos, checks }).catch(() => { if (alive.current) setNotice("采集清单未能保存，请导出任务清单备份。"); });
  }, [photos, checks, captureReady, key]);
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
      const next = { file, name: file.name, importedAt: new Date().toISOString() };
      if (!alive.current) return;
      setModel(next); setShowSample(false); setSaving(true);
      try { if (key) await set(key, next); if (alive.current) setNotice("模型已关联当前遗址并保存到此设备。"); }
      catch { if (alive.current) setNotice("模型已打开，但本地存储空间不足；关闭后需重新导入。"); }
      finally { if (alive.current) setSaving(false); }
    } catch (error) { if (alive.current) setNotice(error.message); }
  }
  async function selectPhotos(files) {
    const valid = Array.from(files).filter((f) => /\.(jpe?g|png|webp)$/i.test(f.name));
    if (valid.length > 1000 || valid.some((f) => f.size > 50 * 1024 * 1024)) { setNotice("最多选择 1,000 张照片，每张不超过 50 MB。"); return; }
    setPhotos(valid.map((f) => ({ name: f.name, size: f.size, modifiedAt: new Date(f.lastModified).toISOString() })));
    setNotice(`${valid.length} 张照片已登记；这里只登记清单，未上传或开始训练。`);
  }
  const sample = !model || showSample;
  return <div className="reconstruction-page"><div className="page-title"><div><span className="eyebrow">DIGITAL CONSERVATION</span><h1>三维档案</h1></div><label className="button primary"><Upload size={16} />导入高斯模型<input type="file" accept=".ply,.splat,.ksplat" aria-label="导入高斯模型" disabled={!site || saving || !loaded} onChange={(e) => { openModel(e.target.files[0]); e.target.value = ""; }} /></label></div>
    <div className="reconstruction-context"><label><LandmarkLabel /><select aria-label="三维档案关联遗址" value={site?.id || ""} onChange={(e) => onSelectSite(e.target.value)}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><div className="tabs" role="tablist" aria-label="三维工作区"><button role="tab" aria-selected={tab === "viewer"} onClick={() => setTab("viewer")}>模型档案</button><button role="tab" aria-selected={tab === "capture"} onClick={() => setTab("capture")}>重建准备</button></div></div>
    {notice && <div className="notice" role="status"><CircleAlert size={17} />{notice}</div>}
    {tab === "viewer" ? <><div className="reconstruction-grid"><div>{loaded ? <SplatViewer file={sample ? null : model.file} name={model?.name} isSample={sample} /> : <div className="splat-stage"><div className="splat-overlay">读取模型档案…</div></div>}</div><aside className="model-inspector"><div className="inspector-heading"><Box size={19} /><h2>模型信息</h2></div><span className={`badge ${sample ? "amber" : "green"}`}>{sample ? "渲染校验样例" : "本地模型"}</span><h3 className="model-name">{sample ? "合成亭阁" : model.name}</h3><dl className="model-properties"><div><dt>关联遗址</dt><dd>{sample ? "样例不关联真实遗址" : site?.name}</dd></div><div><dt>文件大小</dt><dd>{sample ? "程序生成" : `${(model.file.size / 1024 / 1024).toFixed(2)} MB`}</dd></div><div><dt>坐标与尺度</dt><dd>局部坐标 / 未标定</dd></div><div><dt>重建来源</dt><dd>{sample ? "合成数据，非照片重建" : "用户导入，采集来源待核验"}</dd></div><div><dt>查看器</dt><dd>GaussianSplats3D · MIT</dd></div></dl><div className="model-actions">{model && <button className="button full-width" onClick={() => setShowSample(!showSample)}><Box size={15} />{showSample ? "返回遗址模型" : "查看校验样例"}</button>}<button className="button full-width" onClick={() => setTab("capture")}><Camera size={15} />重建准备 <ChevronRight size={14} /></button></div><p className="model-warning">高斯模型用于现状影像记录，不能凭空复原已消失的古建筑，也不能直接作为测绘或结构安全依据。</p></aside></div><div className="pipeline-strip"><span><Camera size={17} />多视角照片</span><ChevronRight size={15} /><a href="https://github.com/colmap/colmap" target="_blank" rel="noreferrer">COLMAP <small>相机位姿</small></a><ChevronRight size={15} /><a href="https://github.com/nerfstudio-project/gsplat" target="_blank" rel="noreferrer">gsplat <small>高斯训练</small></a><ChevronRight size={15} /><span><Box size={17} />三维档案</span><span className="badge gray">训练端未连接</span></div></> : <div className="capture-layout"><section><div className="section-heading"><h2>采集资料</h2><span className="badge gray">本地清单</span></div><label className="photo-upload"><Camera size={36} strokeWidth={1.2} /><strong>{photos.length ? `${photos.length} 张采集照片` : "登记多视角照片"}</strong><span>JPG / PNG / WEBP</span><span className="button"><FolderOpen size={15} />选择照片</span><input type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="登记采集照片" onChange={(e) => { selectPhotos(e.target.files); e.target.value = ""; }} /></label><div className="photo-list">{photos.slice(0, 8).map((p, i) => <div key={i}><Camera size={14} /><span>{p.name}</span><small>{(p.size / 1024 / 1024).toFixed(1)} MB</small></div>)}{photos.length > 8 && <small>另有 {photos.length - 8} 张</small>}</div><div className="checklist">{[["permission", "已确认拍摄与数据使用授权"], ["coverage", "已检查多视角覆盖、遮挡与曝光"], ["scale", "已准备控制点或尺度参照"]].map(([id, title]) => <label key={id}><input type="checkbox" checked={checks[id]} onChange={(e) => setChecks({ ...checks, [id]: e.target.checked })} />{title}</label>)}</div><button className="button primary" disabled={!site || !photos.length} onClick={() => download("三维重建-任务清单.json", { schema: 1, site, photos, checks, createdAt: new Date().toISOString(), pipeline: ["COLMAP", "gsplat", "GaussianSplats3D"], trainingStatus: "not_started", constraints: "照片清单不含图像字节。照片数不代表重建质量，需检查位姿、覆盖和尺度。" })}><Download size={16} />导出重建任务清单</button></section><aside className="capture-workflow"><h2>重建流程</h2>{[["01", "影像采集", "围绕现存建筑采集连续、多高度视角。保留原始照片、设备信息与采集日期。"], ["02", "相机解算", "COLMAP 提取匹配特征，估计相机位姿；检查注册率与稀疏点云。"], ["03", "高斯训练", "在兼容的 CUDA / PyTorch 环境中运行 gsplat。本站尚未连接训练服务。"], ["04", "档案与检验", "裁剪杂点、导出模型，关联遗址；测量前单独完成尺度和精度校核。"]].map(([n, title, body]) => <div className="workflow-step" key={n}><span>{n}</span><div><h3>{title}</h3><p>{body}</p></div></div>)}<a href="https://github.com/playcanvas/supersplat" target="_blank" rel="noreferrer">SuperSplat 模型编辑器 <ExternalLink size={14} /></a></aside></div>}
  </div>;
}

function LandmarkLabel() { return <span className="muted">关联遗址</span>; }
