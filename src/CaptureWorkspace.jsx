import { useEffect, useRef, useState } from "react";
import { get, getMany, setMany } from "idb-keyval";
import { Camera, Check, CircleAlert, Download, FolderOpen, X } from "lucide-react";
import { download } from "./project.js";
import { siteModelKey } from "./reconstruction.js";
import { siteName } from "./presentation.js";
import { CAPTURE_DIRECTIONS, captureCatalogKey, captureImageKey, validateCaptureFiles, inspectCapturePhoto, validCaptureCatalog, captureManifest, buildCaptureZip } from "./captureData.js";

export default function CaptureWorkspace({ site }) {
  const [photos, setPhotos] = useState([]);
  const [checks, setChecks] = useState({ permission: false, coverage: false, scale: false });
  const [subject, setSubject] = useState("");
  const [direction, setDirection] = useState("unknown");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState("");
  const [legacy, setLegacy] = useState(null);
  const alive = useRef(false), pending = useRef(Promise.resolve());
  const catalogKey = captureCatalogKey(site);
  useEffect(() => {
    alive.current = true;
    let active = true;
    if (!catalogKey) return () => { alive.current = false; };
    Promise.all([get(catalogKey), get(`${siteModelKey(site)}:capture`)]).then(async ([catalog, old]) => {
      if (catalog && !validCaptureCatalog(catalog, site)) throw new Error("原片目录格式异常，原记录未被覆盖。");
      if (catalog) {
        const originals = await getMany(catalog.photos.map((p) => captureImageKey(site, p.sha256)));
        const full = catalog.photos.map((p, i) => {
          const original = originals[i];
          if (!(original?.file instanceof Blob) || original.file.size !== p.bytes || !(original.thumbnail instanceof Blob)) throw new Error(`${p.name} 的原片记录缺失，原目录未被覆盖。`);
          return { ...p, ...original };
        });
        if (active) { setPhotos(full); setSubject(catalog.subject); setChecks(catalog.checks); }
      }
      if (active) { setLegacy(old?.photos?.length ? old : null); setReady(true); }
    }).catch((error) => { if (active) setNotice(`读取失败：${error.message} 请保留浏览器数据。`); });
    return () => { active = false; alive.current = false; };
  }, [catalogKey]);
  useEffect(() => {
    if (!busy && saved) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, saved]);
  const bytes = photos.reduce((sum, photo) => sum + photo.bytes, 0);
  const counts = Object.fromEntries(CAPTURE_DIRECTIONS.map(([id]) => [id, photos.filter((p) => p.direction === id).length]));
  function persist(nextPhotos, nextChecks = checks, nextSubject = subject, extra = []) {
    const catalog = { schema: 2, site: { id: site.id, name: site.name, lng: site.lng, lat: site.lat }, photos: nextPhotos.map(({ file, thumbnail, ...p }) => p), checks: nextChecks, subject: nextSubject, updatedAt: new Date().toISOString() };
    if (!validCaptureCatalog(catalog, site)) return Promise.reject(new Error("原片目录未通过校验，未覆盖存档。"));
    setSaved(false);
    setSaveError("");
    const write = pending.current.catch(() => {}).then(() => setMany([...extra, [catalogKey, catalog]]));
    pending.current = write;
    write.then(() => { if (alive.current && pending.current === write) { setSaved(true); setSaveError(""); setNotice((message) => message.startsWith("保存失败：") ? "资料已重新保存到此设备。" : message); } }).catch((error) => { if (alive.current && pending.current === write) { setSaveError(error.message); setNotice(`保存失败：${error.message}，请导出原片资料包备份。`); } });
    return write;
  }
  async function addPhotos(input) {
    const files = Array.from(input); if (!files.length) return;
    setBusy("正在读取原片…"); setNotice("");
    try {
      validateCaptureFiles(files, bytes);
      if (files.length + photos.length > 300) throw new Error("每处遗址最多保存 300 张原片，请分批整理。");
      const next = [...photos], seen = new Set(photos.map((p) => p.sha256)), extra = [];
      let duplicate = 0;
      const failed = [];
      for (const file of files) {
        try {
          const photo = await inspectCapturePhoto(file, direction);
          if (!alive.current) return;
          if (seen.has(photo.sha256)) { duplicate++; continue; }
          seen.add(photo.sha256); next.push(photo);
          extra.push([captureImageKey(site, photo.sha256), { file: photo.file, thumbnail: photo.thumbnail }]);
          setBusy(`已读取 ${next.length - photos.length} 张原片…`);
        } catch (error) { failed.push(`${file.name}：${error.message}`); }
      }
      if (extra.length) { await persist(next, checks, subject, extra); if (alive.current) setPhotos(next); }
      if (alive.current) setNotice(`新增 ${extra.length} 张原片，跳过 ${duplicate} 张重复照片。${failed.length ? `未加入：${failed.join("；")}` : "原图已保存到此设备，尚未开始相机解算或训练。"}`);
    } catch (error) { if (alive.current) setNotice(error.message); }
    finally { if (alive.current) setBusy(""); }
  }
  async function removePhoto(photo) {
    setBusy("正在更新资料…");
    try {
      const next = photos.filter((p) => p.sha256 !== photo.sha256);
      await persist(next, checks, subject, [[captureImageKey(site, photo.sha256), null]]);
      if (alive.current) { setPhotos(next); setNotice(`已从此遗址资料移除 ${photo.name}。`); }
    } catch {} finally { if (alive.current) setBusy(""); }
  }
  async function exportPhotos() {
    setBusy("正在校验并打包原片…"); setNotice("");
    try {
      // A failed local write must not also block backup of originals that are
      // still available in this session. Hash validation remains mandatory.
      await pending.current.catch(() => {});
      const manifest = captureManifest(site, photos, checks, subject);
      const blob = await buildCaptureZip(manifest, photos);
      if (!alive.current) return;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `${siteName(site)}-原片资料.zip`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setNotice(`已导出 ${photos.length} 张原片、文件校验值和遗址资料。资料包未包含已训练模型。`);
    } catch (error) { if (alive.current) setNotice(error.message); }
    finally { if (alive.current) setBusy(""); }
  }
  function changeMetadata(key, value) {
    const nextChecks = key === "subject" ? checks : { ...checks, [key]: value };
    const nextSubject = key === "subject" ? value : subject;
    setChecks(nextChecks); setSubject(nextSubject);
    persist(photos, nextChecks, nextSubject).catch(() => {});
  }
  return <div className="capture-workspace">
    <div className="capture-real-steps" aria-label="当前遗址的重建状态">{[["原片整理", photos.length ? `${photos.length} 张已保存` : "等待对应原片"], ["相机解算", "尚未开始"], ["高斯训练", "尚未开始"], ["画面验收", "尚未进行"]].map(([title, value], i) => <div key={title}><span>0{i+1}</span><strong>{title}</strong><small>{value}</small></div>)}</div>
    {notice && <div className="notice" role="status"><CircleAlert size={16} />{notice}</div>}
    <div className="capture-layout"><section><div className="section-heading"><div><h2>整理{site ? siteName(site) : "遗址"}的原片</h2><p className="muted">原图留在此设备。只收集同一主体，不用无关照片补齐模型。</p></div><span className="badge gray">{busy || (!ready ? "读取原片目录…" : saveError ? "保存失败 · 请导出备份" : saved ? "已保存到此设备" : "保存中…")}</span></div>
      <fieldset className="capture-form" disabled={!ready || !site || Boolean(busy)}><label>拍摄主体<input aria-label="拍摄主体" maxLength={120} value={subject} placeholder="如：含元殿遗址台基东侧，或馆内复原陈列" onChange={(e) => changeMetadata("subject", e.target.value)} /></label><label>本批拍摄方向<select aria-label="本批拍摄方向" value={direction} onChange={(e) => setDirection(e.target.value)}>{CAPTURE_DIRECTIONS.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
      <label className="photo-upload capture-original-upload"><Camera size={30} strokeWidth={1.2} /><strong>添加连续拍摄的原图</strong><span>JPG / PNG / WEBP · SHA-256 去重 · 每处最多 250 MB</span><span className="button"><FolderOpen size={15} />选择原片</span><input type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="添加重建原片" onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} /></label>
      <div className="capture-direction-counts" aria-label="人工标注的拍摄方向">{CAPTURE_DIRECTIONS.map(([id, title]) => <span key={id}>{title}<strong>{counts[id]}</strong></span>)}</div><p className="muted capture-limit-note">方向是人工标注；照片数量不能证明重叠、环绕覆盖或可重建性，需在相机解算后检查。</p>
      <div className="capture-original-grid">{photos.map((photo) => <CapturePhoto key={photo.sha256} photo={photo} onRemove={() => removePhoto(photo)} />)}</div>
      <div className="checklist">{[["permission", "已确认拍摄与资料使用授权"], ["coverage", "已人工检查同一主体、连续视角与曝光"], ["scale", "已准备尺度参照（仍需单独校核）"]].map(([id, title]) => <label key={id}><input type="checkbox" checked={checks[id]} onChange={(e) => changeMetadata(id, e.target.checked)} />{title}</label>)}</div>
      <div className="button-row"><button className="button primary" disabled={!photos.length || !checks.permission || !subject.trim()} onClick={exportPhotos}><Download size={15} />导出原片资料包</button><small className="muted">{photos.length} 张 · {(bytes / 1048576).toFixed(1)} MB</small></div></fieldset>
      {legacy && <details className="capture-legacy"><summary>保留的旧采集清单（{legacy.photos.length} 张文件记录）</summary><p>旧版只保存文件名，没有原片。原清单未改动，可导出后重新加入实际照片。</p><button className="text-button" onClick={() => download("旧采集清单.json", { ...legacy, includesPhotoBytes: false })}>导出旧清单 <Download size={13} /></button></details>}
    </section><aside className="capture-workflow"><h2>把原片变成可用的三维档案</h2>{[["01", "同一主体、连续视角", "整体与构件分别整理；相邻照片保留重叠，记录正面、侧面、背面和较高机位。已有单图资料只能作为影像参考。"], ["02", "先检查相机与覆盖", "解算相机位姿并检查注册、重投影误差与空间覆盖。文件去重和方向标注都不能代替这一步。"], ["03", "本机训练后看画面", "使用开源引擎训练，逐张比较保留原片与模型渲染，再检查正面、侧面和背面。重影、空洞或浮点未解决时不进入正式展示。"], ["04", "绑定对应遗址", "通过检查的模型关联同一主体、遗址身份与原始坐标；保留原片、许可、模型版本和训练日志。"]].map(([n, title, body]) => <div className="workflow-step" key={n}><span>{n}</span><div><h3>{title}</h3><p>{body}</p></div></div>)}<div className="capture-service-state"><Check size={15} /><span>原图保存、去重、校验和打包可用</span></div><p className="muted">此页尚未接通任意照片自动解算与训练。导出资料包不会提交到云端，也不会自动生成模型。</p></aside></div>
  </div>;
}

function CapturePhoto({ photo, onRemove }) {
  const [url, setUrl] = useState("");
  useEffect(() => { const next = URL.createObjectURL(photo.thumbnail); setUrl(next); return () => URL.revokeObjectURL(next); }, [photo.thumbnail]);
  return <article><div>{url && <img src={url} alt={photo.name + " 原片预览"} />}<button aria-label={`移除原片 ${photo.name}`} onClick={onRemove}><X size={14} /></button></div><strong title={photo.name}>{photo.name}</strong><small>{photo.width} × {photo.height} · {CAPTURE_DIRECTIONS.find(([id]) => id === photo.direction)?.[1]}</small><small>{Math.max(photo.width, photo.height) < 1024 ? "分辨率较低，保留作线索" : "原片可解码 · 已记录校验值"}</small></article>;
}
