import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Upload, Download, Database, FileCheck2, ExternalLink, RotateCcw, AlertCircle } from "lucide-react";
import { DATASETS } from "./project.js";
import { parseGeoJson } from "./geodata.js";
import { BACKUP_LIMITS, exportProjectBackup, restoreProjectBackup } from "./backup.js";

export function DataCenter({ project, onImport, onMetadata, onRestore, onReset, saveStatus, onRestoreStart, projectLocked = false }) {
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState("");
  const [pending, setPending] = useState(null);
  const [modes, setModes] = useState({});
  const [resetConfirm, setResetConfirm] = useState(false);
  const running = useRef(false);
  const alive = useRef(true);
  const operation = useRef(null);
  const reviewRef = useRef(null);
  const noticeRef = useRef(null);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; operation.current?.abort(); }; }, []);
  useEffect(() => {
    const target = notice?.error ? noticeRef.current : pending ? reviewRef.current : noticeRef.current;
    if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest', behavior: 'auto' }); }
  }, [pending, notice]);
  const locked = Boolean(busy || pending || projectLocked);
  function begin(kind) {
    if (running.current || projectLocked) return false;
    operation.current = new AbortController();
    running.current = true; setBusy(kind); setNotice(null); setResetConfirm(false); return true;
  }
  function finish() { running.current = false; if (alive.current) setBusy(""); }
  function report(error) { if (alive.current) setNotice({ error: true, message: error?.message || "操作失败，请重试；当前项目尚未替换。" }); }

  async function importFile(kind, file) {
    if (!file || !begin(kind)) return;
    try {
      if (kind === "project") {
        if (!file.size || file.size > BACKUP_LIMITS.bundleBytes) throw new Error("请选择非空项目备份，完整文件上限 512 MiB。");
        if (alive.current) setPending({ kind, file, name: file.name });
        return;
      }
      if (file.size > 15 * 1024 * 1024) throw new Error("GeoJSON 图层超过 15 MiB，请按研究区裁剪后导入。");
      const text = await file.text();
      const parsed = parseGeoJson(text, kind);
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const source = { name: file.name, count: parsed.features.length, sha256: Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join(""), importedAt: new Date().toISOString(), timing: "unknown", period: "", citation: "" };
      if (alive.current) setPending({ kind, name: file.name, features: parsed.features, skipped: parsed.skipped, source, mode: modes[kind] || "replace" });
    } catch (error) { report(error); }
    finally { finish(); }
  }

  async function confirmImport() {
    if (!pending || !begin(pending.kind)) return;
    const candidate = pending;
    try {
      if (candidate.kind === "project") {
        const release = onRestoreStart?.() || (() => {});
        try {
          const next = await restoreProjectBackup(candidate.file, undefined, { signal: operation.current.signal });
          // The project and every archive are committed together before UI state changes.
          onRestore(next);
        } finally { release(); }
        if (alive.current) setNotice({ message: `${candidate.name}：备份中包含的图层、笔记与档案已校验并恢复。旧版 JSON 不含三维模型和采集清单；照片原件需单独保管。` });
      } else {
        await onImport(candidate.kind, candidate.features, candidate.source, candidate.mode);
        if (alive.current) setNotice({ message: `${candidate.name}：已${candidate.mode === "append" ? "追加" : "导入"} ${candidate.features.length} 个要素${candidate.skipped ? `，跳过 ${candidate.skipped} 个无效或不支持的要素` : ""}。请核对图层年代与来源。` });
      }
      if (alive.current) setPending(null);
    } catch (error) { report(error); }
    finally { finish(); }
  }

  async function backup() {
    if (pending || !begin("backup")) return;
    try {
      const blob = await exportProjectBackup(project);
      if (!alive.current || operation.current.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = "古址天眸-完整项目.heritage";
        document.body.append(anchor); anchor.click(); anchor.remove();
      } finally { setTimeout(() => URL.revokeObjectURL(url), 10000); }
      if (alive.current) setNotice({ message: `完整备份已生成（${(blob.size / 1024 / 1024).toFixed(2)} MiB），已请求浏览器下载。包含图层、笔记、模型与采集清单；照片原件需单独保管。` });
    } catch (error) { report(error); }
    finally { finish(); }
  }

  const spinner = <span className="operation-spinner" aria-hidden="true" />;
  return <div className="page-scroll data-center-page" aria-busy={Boolean(busy || projectLocked)}>
    <div className="page-title"><div><span className="eyebrow">DATA WORKSPACE</span><h1>数据中心</h1></div><div className="button-row">
      <label className="button">{busy === "project" ? spinner : <Upload size={16} />}{busy === "project" ? "恢复处理中" : "恢复项目"}<input type="file" aria-label="恢复项目备份" accept=".heritage,.json" disabled={locked} onChange={(e) => { importFile("project", e.target.files[0]); e.target.value = ""; }} /></label>
      <button className="button primary" disabled={locked} onClick={backup}>{busy === "backup" ? spinner : <Download size={16} />}{busy === "backup" ? "正在校验并备份" : "完整备份"}</button>
    </div></div>
    <div className="data-workspace-intro"><strong>导入前预览，确认后更新</strong><p>为每个图层选择“追加”或“替换图层”。先检查文件与要素数量，再确认更新；图层年代和出处可在导入后补充。</p></div>
    <div className="summary-strip"><div><Database /><span>已接入图层<strong>{DATASETS.filter(({ id }) => project.datasets[id].length).length}<small> / 5</small></strong></span></div><div><FileCheck2 /><span>坐标参考<strong className="text-metric">WGS84 · EPSG:4326</strong></span></div><div><span>存储位置<strong className="text-metric">此设备浏览器</strong><small>{saveStatus}</small></span></div></div>
    {notice && <div ref={noticeRef} tabIndex={-1} className={`notice ${notice.error ? "error" : "success"}`} role={notice.error ? "alert" : "status"}><AlertCircle size={17} />{notice.message}</div>}
    {projectLocked && !busy && <div className="notice" role="status">{spinner}项目正在恢复，请等待校验和存储完成。</div>}
    {busy && <div className="notice" role="status">{spinner}{busy === "backup" ? "正在读取完整档案并计算校验值，大模型需要稍等。" : busy === "project" ? "正在校验项目与所有模型，完成后统一恢复。" : "正在解析图层并计算文件指纹…"}</div>}
    {pending && <section ref={reviewRef} tabIndex={-1} className="import-review" aria-labelledby="import-review-title">
      <div><span className="eyebrow">REVIEW IMPORT</span><h2 id="import-review-title">{pending.kind === "project" ? "确认恢复项目" : "确认图层更新"}</h2><p className="import-review-file">{pending.name}</p></div>
      {pending.kind === "project" ? <p>恢复将替换当前工作项目。系统会先完整校验，再一次性写入；校验或存储失败不会替换当前项目。建议先取消并备份当前项目。</p> : <><p>当前 {project.datasets[pending.kind].length} 个要素 · 文件含 {pending.features.length} 个有效要素{pending.skipped > 0 && ` · 跳过 ${pending.skipped} 个无效或不支持的要素`}。</p><p>{pending.mode === "append" ? `追加后共 ${project.datasets[pending.kind].length + pending.features.length} 个要素。遗址 ID 冲突时会拒绝追加，请先修正文件。` : "将替换此图层的现有要素。遗址研究笔记和三维档案按稳定 ID 保留；已移出名录的档案仍保留在完整备份中。"}</p></>}
      <div className="button-row"><button className="button primary" disabled={Boolean(busy || projectLocked)} onClick={confirmImport}>{busy ? spinner : <FileCheck2 size={16} />}{pending.kind === "project" ? "校验并恢复项目" : pending.mode === "append" ? "确认追加" : "确认替换图层"}</button><button className="button" disabled={Boolean(busy || projectLocked)} onClick={() => { setPending(null); setNotice({ message: "已取消，当前项目未更改。" }); }}>取消</button></div>
    </section>}
    <section className="section"><div className="section-heading"><h2>项目图层</h2><span className="muted">GeoJSON · 单文件上限 15 MiB</span></div>
      <div className="dataset-table">{DATASETS.map(({ id, title, geometry, purpose, template }) => <article className="dataset" data-state={project.datasets[id].length ? "ready" : "empty"} aria-busy={busy === id} key={id}>
        <div className={`dataset-symbol ${id}`}><Database size={21} /></div><div className="dataset-body"><div className="dataset-name"><h3>{title}</h3><span className={`badge ${project.datasets[id].length ? "green" : "gray"}`}>{project.datasets[id].length ? `${project.datasets[id].length} 个要素` : "待接入"}</span></div><div className="muted truncate dataset-source" title={project.sources[id].name}>{project.sources[id].name}</div><small className="dataset-description">{geometry} · {purpose}{project.sources[id].sha256 && ` · SHA-256 ${project.sources[id].sha256.slice(0, 12)}`}</small>
          <div className="metadata-fields"><label>数据时态<select disabled={locked} aria-label={`${title}数据时态`} value={project.sources[id].timing} onChange={(e) => onMetadata(id, { timing: e.target.value })}><option value="unknown">未核验</option><option value="present">现状数据</option><option value="historical">历史重建</option></select></label><label>所属时期<input disabled={locked} aria-label={`${title}所属时期`} placeholder="如：秦汉时期" value={project.sources[id].period} onChange={(e) => onMetadata(id, { period: e.target.value })} /></label><label className="citation-field">数据出处<input disabled={locked} aria-label={`${title}数据出处`} placeholder="机构、报告或数据版本" value={project.sources[id].citation} onChange={(e) => onMetadata(id, { citation: e.target.value })} /></label></div>
        </div><div className="dataset-actions"><label className="import-mode">导入方式<select aria-label={`${title}导入方式`} disabled={locked} value={modes[id] || "replace"} onChange={(e) => setModes({ ...modes, [id]: e.target.value })}><option value="replace">替换图层</option><option value="append">追加</option></select></label><label className="button">{busy === id ? spinner : <Upload size={15} />}{busy === id ? "正在解析" : "预览导入"}<input type="file" accept=".geojson,.json" aria-label={`导入${title}`} disabled={locked} onChange={(e) => { importFile(id, e.target.files[0]); e.target.value = ""; }} /></label><a href={`/templates/${template}.geojson`} download><Download size={13} />格式模板</a></div>
      </article>)}</div>
    </section>
    <section className="section two-column"><div><h2>地形数据约定</h2><p className="muted">地形值从 GIS 预计算结果读取，不由底图推测。点位属性支持 <code>elevation_m</code>、<code>slope_deg</code>、<code>aspect_deg</code>、<code>tpi</code>、<code>terrain_source</code> 与 <code>precision_m</code>。空值保持缺失。</p><a href="https://grass.osgeo.org/grass-stable/manuals/r.slope.aspect.html" target="_blank" rel="noreferrer">GRASS 地形处理文档 <ExternalLink size={13} /></a></div><div><h2>完整备份与本地存储</h2><p className="muted">数据保存在当前浏览器，不上传服务器。完整 .heritage 备份包含全部图层、笔记、三维模型、采集清单，以及移出名录或尚未关联的旧版档案；不含照片原件。旧版 JSON 项目仍可恢复。清除浏览器数据会删除本地存档。</p><p className="muted">模型单个上限 120 MiB，项目元数据上限 80 MiB，完整备份上限 512 MiB。超限或档案损坏会停止备份，不会静默遗漏文件。</p>{resetConfirm ? <div className="button-row"><span>重置为演示项目？请先备份当前工作。</span><button className="button danger" disabled={locked} onClick={() => { onReset(); setResetConfirm(false); setNotice({ message: "已恢复内置演示点位。恢复原项目的图层、笔记与关联档案，需要使用重置前保存的完整备份。" }); }}>确认重置</button><button className="button" disabled={locked} onClick={() => setResetConfirm(false)}>取消</button></div> : <button className="text-button" disabled={locked} onClick={() => setResetConfirm(true)}><RotateCcw size={15} />恢复演示项目</button>}</div></section>
  </div>;
}
