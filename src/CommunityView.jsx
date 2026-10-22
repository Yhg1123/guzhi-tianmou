import { useEffect, useRef, useState } from "react";
import { get, set, del, keys, getMany } from "idb-keyval";
import { Users, Camera, Images, History, MapPin, Bookmark, Check, Download, X, CircleAlert, ArrowUpRight } from "lucide-react";
import { download } from "./project.js";
import { CAPTURE_ANGLES, PARTICIPATION_TASKS, CONTRIBUTION_PREFIX, VISITS_KEY, MAX_PHOTOS, validatePhotoBatch, makeContribution, contributionManifest, describeCoverage, siteIdentity, isStoredContribution } from "./participation.js";
import "./community.css";

async function readContributions() {
  const recordKeys = (await keys()).filter((key) => typeof key === "string" && key.startsWith(CONTRIBUTION_PREFIX));
  const records = (await getMany(recordKeys)).filter((record) => record !== undefined);
  if (records.some((record) => !isStoredContribution(record))) throw new Error("本地贡献资料格式异常，原记录未被覆盖，请保留浏览器数据后联系维护人员。");
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function inspectPhoto(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = bitmap;
    const canvas = document.createElement("canvas");
    const ratio = Math.min(1, 360 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumbnail = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
    if (!thumbnail) throw new Error("无法创建预览。");
    return { file, thumbnail, sha256, width, height };
  } finally { bitmap.close(); }
}

function PhotoPreview({ photo, onRemove, original = false }) {
  const [url, setUrl] = useState("");
  useEffect(() => { const next = URL.createObjectURL(photo.thumbnail); setUrl(next); return () => URL.revokeObjectURL(next); }, [photo.thumbnail]);
  function saveOriginal() {
    const link = document.createElement("a");
    const next = URL.createObjectURL(photo.file);
    link.href = next; link.download = photo.file.name; link.click();
    setTimeout(() => URL.revokeObjectURL(next), 1000);
  }
  return <article className="contribution-photo"><div>{url && <img src={url} alt={`投稿照片：${photo.file.name}`} />}{onRemove && <button type="button" className="photo-remove" aria-label={`移除 ${photo.file.name}`} onClick={onRemove}><X size={14} /></button>}</div><strong title={photo.file.name}>{photo.file.name}</strong><small>{photo.width} × {photo.height}{Math.max(photo.width, photo.height) < 1024 ? " · 分辨率较低，可作为线索" : ""}</small>{original && <button className="text-button" onClick={saveOriginal}><Download size={12} />下载原图</button>}</article>;
}

export function CommunityView({ sites, selectedId, onSelectSite, onMap, onReconstruction }) {
  const site = sites.find((item) => item.id === selectedId) || sites[0];
  return <CommunityProject key={site ? siteIdentity(site) : "empty"} {...{ site, sites, onSelectSite, onMap, onReconstruction }} />;
}

function CommunityProject({ site, sites, onSelectSite, onMap, onReconstruction }) {
  const [tab, setTab] = useState("tasks");
  const [task, setTask] = useState("capture");
  const [angle, setAngle] = useState("unknown");
  const [capturedOn, setCapturedOn] = useState("");
  const [note, setNote] = useState("");
  const [contributor, setContributor] = useState("");
  const [rights, setRights] = useState(false);
  const [researchConsent, setResearchConsent] = useState(false);
  const [publicConsent, setPublicConsent] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [records, setRecords] = useState([]);
  const [visits, setVisits] = useState([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [removeConfirm, setRemoveConfirm] = useState("");
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    let active = true;
    Promise.all([readContributions(), get(VISITS_KEY)]).then(([saved, plan]) => {
      if (!active) return;
      setRecords(saved); setVisits(Array.isArray(plan) ? plan.filter((key) => typeof key === "string") : []); setReady(true);
    }).catch((error) => { if (active) setNotice({ error: true, message: `读取本地参与记录失败：${error.message}` }); });
    return () => { active = false; alive.current = false; };
  }, []);
  const currentTask = PARTICIPATION_TASKS.find((item) => item.id === task);
  const coverage = site ? describeCoverage(records, site) : null;
  const visitSites = sites.filter((item) => visits.includes(siteIdentity(item)));
  const bookmarked = site && visits.includes(siteIdentity(site));
  function selectSite(id) {
    if (photos.length) {
      setNotice({ error: true, message: "当前照片还未保存，请先保存本地贡献，或移除本批照片后再切换遗址。" });
      setTab("tasks"); return;
    }
    onSelectSite(id);
  }
  async function choosePhotos(input) {
    const files = Array.from(input);
    if (!files.length) return;
    setBusy("photos"); setNotice(null);
    try {
      validatePhotoBatch([...photos.map((photo) => photo.file), ...files]);
      const next = [...photos];
      const seen = new Set(next.map((photo) => photo.sha256));
      const messages = [];
      for (const file of files) {
        try {
          const photo = await inspectPhoto(file);
          if (!alive.current) return;
          if (seen.has(photo.sha256)) { messages.push(`${file.name} 与本批照片重复，已跳过`); continue; }
          seen.add(photo.sha256); next.push(photo);
        } catch { messages.push(`${file.name} 不是可读取的照片，未加入`); }
      }
      if (alive.current) {
        setPhotos(next);
        setNotice({ error: Boolean(messages.length), message: messages.length ? messages.join("；") : `已读取 ${files.length} 张照片。预览与原图仅在此设备处理。` });
      }
    } catch (error) { if (alive.current) setNotice({ error: true, message: error.message }); }
    finally { if (alive.current) setBusy(""); }
  }
  async function saveContribution(event) {
    event.preventDefault(); setBusy("save"); setNotice(null);
    try {
      const latest = await readContributions();
      if (!alive.current) return;
      const record = makeContribution({ site, task, photos, angle, capturedOn, note, contributor, rights, researchConsent, publicConsent }, latest);
      await set(CONTRIBUTION_PREFIX + record.id, record);
      if (!alive.current) return;
      setRecords([record, ...latest]); setPhotos([]); setRights(false); setResearchConsent(false); setPublicConsent(false); setNote(""); setCapturedOn(""); setTab("contributions");
      setNotice({ message: "本地贡献草稿已保存，含照片原图；尚未上传给项目方，也未进入审核或模型训练。" });
    } catch (error) { if (alive.current) setNotice({ error: true, message: `${error.message || "保存失败"} 照片仍保留在本次表单中。` }); }
    finally { if (alive.current) setBusy(""); }
  }
  async function toggleVisit() {
    if (!site) return;
    setBusy("visits");
    try {
      const current = await get(VISITS_KEY);
      const previous = Array.isArray(current) ? current : [];
      const key = siteIdentity(site);
      const next = previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key];
      await set(VISITS_KEY, next);
      if (alive.current) setVisits(next);
    } catch { if (alive.current) setNotice({ error: true, message: "探访清单保存失败，请重试。" }); }
    finally { if (alive.current) setBusy(""); }
  }
  async function removeRecord(id) {
    setBusy("remove");
    try {
      await del(CONTRIBUTION_PREFIX + id);
      if (alive.current) {
        setRecords((current) => current.filter((record) => record.id !== id)); setRemoveConfirm("");
        setNotice({ message: "已移除此条本地草稿及其照片副本，不影响你在设备上保存的原始文件。" });
      }
    } catch { if (alive.current) setNotice({ error: true, message: "移除失败，原记录仍保留。" }); }
    finally { if (alive.current) setBusy(""); }
  }
  return <div className="page-scroll community-page">
    <div className="page-title"><div><span className="eyebrow">HERITAGE TOGETHER</span><h1>公众共建</h1></div><span className="badge amber">本地试点</span></div>
    <section className="community-intro"><div><span className="community-kicker"><Users size={15} />文旅探访 · 数字守护</span><h2>让每一次探访，留下保护的线索</h2><p>旅途中拍下现状，在旧相册里寻找历史。把你的视角留给遗产档案，让更多人认识、记录和守护这些地方。</p></div><div className="community-intro-actions"><button className="button" onClick={onMap}><MapPin size={15} />浏览遗址地图</button><button className="text-button" onClick={onReconstruction}>看看真实三维案例 <ArrowUpRight size={14} /></button></div></section>
    <div className="notice warning community-boundary"><CircleAlert size={17} /><span>本页是参与流程试点：照片原图保存在此设备，尚未上传或交给管理机构。公开征集、专家审核与重建训练将在接入后台后开放。</span></div>
    <div className="community-context"><label>选择参与遗址<select aria-label="选择参与遗址" value={site?.id || ""} disabled={Boolean(busy)} onChange={(event) => selectSite(event.target.value)}>{sites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="button" disabled={!site || !ready || Boolean(busy)} aria-pressed={Boolean(bookmarked)} onClick={toggleVisit}>{bookmarked ? <Check size={15} /> : <Bookmark size={15} />}{bookmarked ? "已加入探访清单" : "加入探访清单"}</button></div>
    {site?.isDemo && <p className="community-demo">当前遗址点位未经核验；下方为任务设计示例，不代表已获得景区或文保管理方的采集委托。</p>}
    {notice && <div className={`notice ${notice.error ? "error" : "success"}`} role={notice.error ? "alert" : "status"}>{notice.message}</div>}
    <div className="community-stats"><div><strong>{records.length}</strong><span>本地贡献草稿</span></div><div><strong>{records.reduce((sum, record) => sum + record.photos.length, 0)}</strong><span>本地保存照片</span></div><div><strong>{visitSites.length}</strong><span>探访清单遗址</span></div></div>
    <div className="tabs community-tabs" role="tablist" aria-label="公众共建工作区"><button role="tab" aria-selected={tab === "tasks"} onClick={() => setTab("tasks")}>参与任务</button><button role="tab" aria-selected={tab === "contributions"} onClick={() => setTab("contributions")}>我的贡献</button><button role="tab" aria-selected={tab === "visits"} onClick={() => setTab("visits")}>探访清单</button></div>
    {tab === "tasks" && <>
      <div className="community-tasks">{PARTICIPATION_TASKS.map((item) => { const Icon = item.icon === "camera" ? Camera : item.icon === "archive" ? Images : History; return <button className={`community-task ${task === item.id ? "selected" : ""}`} aria-pressed={task === item.id} key={item.id} onClick={() => setTask(item.id)} disabled={Boolean(busy)}><Icon size={22} strokeWidth={1.4} /><small>{item.tag}</small><h3>{item.title}</h3><p>{item.description}</p><span>{task === item.id ? "当前任务" : "选择任务"} <ArrowUpRight size={13} /></span></button>; })}</div>
      <div className="contribution-layout"><form className="contribution-form" onSubmit={saveContribution}><div className="section-heading"><div><h2>{currentTask.title} · 登记资料</h2><small className="muted">{site?.name || "暂无遗址，请先在数据中心导入点位"}</small></div><span className="badge gray">本地草稿</span></div><fieldset disabled={!ready || !site || Boolean(busy)}><label className="contribution-drop"><Camera size={25} /><strong>{busy === "photos" ? "正在读取照片…" : "选择你的照片"}</strong><span>JPG / PNG / WEBP · 每批最多 {MAX_PHOTOS} 张 · 合计不超过 60 MB</span><input aria-label="选择公众贡献照片" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { choosePhotos(event.target.files); event.target.value = ""; }} /></label>
        {Boolean(photos.length) && <div className="contribution-photo-grid">{photos.map((photo) => <PhotoPreview key={photo.sha256} photo={photo} onRemove={() => setPhotos((current) => current.filter((item) => item.sha256 !== photo.sha256))} />)}</div>}
        <div className="contribution-fields"><label>拍摄方向<select aria-label="投稿拍摄方向" value={angle} onChange={(event) => setAngle(event.target.value)}>{CAPTURE_ANGLES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>拍摄日期（可留空）<input aria-label="投稿拍摄日期" type="date" value={capturedOn} onChange={(event) => setCapturedOn(event.target.value)} /></label><label className="wide-field">署名（可选）<input aria-label="贡献者署名" maxLength={40} value={contributor} onChange={(event) => setContributor(event.target.value)} placeholder="公开展示前会再次核对署名" /></label><label className="wide-field">照片线索与故事<textarea aria-label="照片线索与故事" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="拍摄位置、年代线索、同一机位的变化，或你不确定的地方…" /></label></div>
        <div className="contribution-consent"><label><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} />我确认这些照片为本人拍摄，或已取得提供资料的授权。</label><label><input type="checkbox" checked={researchConsent} onChange={(event) => setResearchConsent(event.target.checked)} />我同意资料用于该遗址的非商业研究、数字记录与保护。</label><label><input type="checkbox" checked={publicConsent} onChange={(event) => setPublicConsent(event.target.checked)} />允许后续经审核后公开展示照片与署名（可选）。</label></div>
        <button className="button primary" type="submit" disabled={!photos.length || !rights || !researchConsent}>{busy === "save" ? "正在保存…" : "保存本地贡献"}<ArrowUpRight size={15} /></button><small className="contribution-save-note">本地试点登记用途意向，未提交线上授权。项目 JSON 备份不包含本页照片，请保留原始文件。</small>
      </fieldset></form>
      <aside className="contribution-guide"><h2>怎样拍，才更有帮助</h2><p>{currentTask.guidance}</p><ol><li>先拍清楚整体，再补充构件与细节。</li><li>保留原图，不加滤镜、不用 AI 补画。</li><li>只在开放区域拍摄，不触碰、不攀爬文物。</li><li>避开可识别人脸与私人信息；不确定的地方如实备注。</li></ol>{coverage && <div className="capture-coverage"><h3>当前遗址的本地视角记录</h3>{CAPTURE_ANGLES.map(([value, title]) => <div key={value}><span>{title}</span><strong>{coverage.counts[value]} 张</strong></div>)}<small>方向由投稿者填写；这是素材分类，不代表三维覆盖率或修复进度。</small></div>}<div className="participation-next"><h3>你的照片将怎样被使用</h3><p>资料登记 → 项目方审核 → 专业人员筛选与建模 → 发布注明来源的成果 → 向贡献者反馈。</p><small>目前只开放本地资料登记，后续步骤尚未接入。</small></div></aside></div>
    </>}
    {tab === "contributions" && <section className="section"><div className="section-heading"><h2>此设备的全部贡献</h2><button className="button" disabled={!records.length} onClick={() => download("公众共建-本地贡献清单.json", { schema: 1, records: records.map(contributionManifest), includesPhotoBytes: false })}><Download size={14} />导出清单（不含照片）</button></div>{!ready && !notice && <p className="empty-inline">正在读取参与记录…</p>}{ready && !records.length && <div className="community-empty"><Images size={30} strokeWidth={1.2} /><h3>从一张有来历的照片开始</h3><p>选择任务、登记照片，保存后可以在这里查看原图和资料说明。</p><button className="button" onClick={() => setTab("tasks")}>去参与任务</button></div>}{records.map((record) => <article className="contribution-record" key={record.id}><div className="section-heading"><div><span className="badge amber">本地草稿 · 未上传、未审核</span><h3>{record.site.name} · {PARTICIPATION_TASKS.find((item) => item.id === record.task)?.title || "资料登记"}</h3><small>{record.contributor} · {CAPTURE_ANGLES.find(([value]) => value === record.angle)?.[1]} · {record.capturedOn || "拍摄日期不详"}</small></div><button className="text-button" onClick={() => download(`贡献清单-${record.id}.json`, contributionManifest(record))}><Download size={14} />导出资料说明</button></div>{record.note && <p className="contribution-story">{record.note}</p>}<p className="contribution-usage">{record.consent.publicDisplay ? "记录了允许审核后公开展示的意向" : "仅记录研究保护用途，未同意公开展示"}</p><div className="contribution-photo-grid">{record.photos.map((photo) => <PhotoPreview key={photo.sha256} photo={photo} original />)}</div>{removeConfirm === record.id ? <div className="contribution-remove-confirm"><span>请先下载原图；移除后无法从本页恢复。</span><button className="button danger" disabled={Boolean(busy)} onClick={() => removeRecord(record.id)}>确认移除本地副本</button><button className="button" disabled={Boolean(busy)} onClick={() => setRemoveConfirm("")}>取消</button></div> : <button className="text-button" disabled={Boolean(busy)} onClick={() => setRemoveConfirm(record.id)}>移除此本地草稿</button>}</article>)}</section>}
    {tab === "visits" && <section className="section"><div className="section-heading"><h2>我的遗产探访清单</h2><span className="muted">出发前请核实开放信息</span></div>{!visitSites.length && <div className="community-empty"><Bookmark size={30} strokeWidth={1.2} /><h3>把想了解的地方加入清单</h3><p>先浏览遗址，再选择适合自己的参与任务。</p><button className="button" onClick={onMap}>去看遗址地图</button></div>}{visitSites.map((item) => <article className="visit-item" key={siteIdentity(item)}><MapPin size={20} /><div><h3>{item.name}</h3><p>{item.location} · {item.period}</p><small>{item.isDemo ? "演示点位，位置未经核验，不提供出行导航" : "导入点位；开放状态与到访权限需自行核实"}</small></div><button className="button" onClick={() => { selectSite(item.id); setTab("tasks"); }}>查看参与任务 <ArrowUpRight size={14} /></button></article>)}</section>}
  </div>;
}

export default CommunityView;
