import { useState } from "react";
import { Upload, Download, Database, FileCheck2, ExternalLink, RotateCcw, AlertCircle } from "lucide-react";
import { DATASETS, download, serializeProject, restoreProject } from "./project.js";
import { parseGeoJson } from "./geodata.js";

export function DataCenter({ project, onImport, onMetadata, onRestore, onReset, saveStatus }) {
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState("");
  const [resetConfirm, setResetConfirm] = useState(false);
  async function importFile(kind, file) {
    if (!file) return;
    setBusy(kind); setNotice(null);
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error("文件超过 15 MB，请按研究区裁剪后导入。");
      const text = await file.text();
      if (kind === "project") { onRestore(restoreProject(text)); setNotice({ message: "项目已恢复，图层与研究笔记已同步。" }); return; }
      const parsed = parseGeoJson(text, kind);
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      onImport(kind, parsed.features, { name: file.name, count: parsed.features.length, sha256: Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join(""), importedAt: new Date().toISOString(), timing: "unknown", period: "", citation: "" });
      setNotice({ message: `${file.name}：已导入 ${parsed.features.length} 个要素${parsed.skipped ? `，跳过 ${parsed.skipped} 个无效或不支持的要素` : ""}。请核对下方年代与来源。` });
    } catch (error) { setNotice({ error: true, message: error.message }); }
    finally { setBusy(""); }
  }
  return <div className="page-scroll">
    <div className="page-title"><div><span className="eyebrow">DATA WORKSPACE</span><h1>数据中心</h1></div><div className="button-row"><label className="button"><Upload size={16} />恢复项目<input type="file" accept=".json" disabled={Boolean(busy)} onChange={(e) => { importFile("project", e.target.files[0]); e.target.value = ""; }} /></label><button className="button primary" onClick={() => download("古址天眸-项目.json", serializeProject(project))}><Download size={16} />备份项目</button></div></div>
    <div className="summary-strip"><div><Database /><span>已接入图层<strong>{DATASETS.filter(({ id }) => project.datasets[id].length).length}<small> / 5</small></strong></span></div><div><FileCheck2 /><span>坐标参考<strong className="text-metric">WGS84 · EPSG:4326</strong></span></div><div><span>存储位置<strong className="text-metric">此设备浏览器</strong><small>{saveStatus}</small></span></div></div>
    {notice && <div className={`notice ${notice.error ? "error" : "success"}`} role={notice.error ? "alert" : "status"}><AlertCircle size={17} />{notice.message}</div>}
    <section className="section"><div className="section-heading"><h2>项目图层</h2><span className="muted">GeoJSON · 单文件上限 15 MB</span></div>
      <div className="dataset-table">{DATASETS.map(({ id, title, geometry, purpose, template }) => <article className="dataset" key={id}>
        <div className={`dataset-symbol ${id}`}><Database size={21} /></div><div className="dataset-body"><div className="dataset-name"><h3>{title}</h3><span className={`badge ${project.datasets[id].length ? "green" : "gray"}`}>{project.datasets[id].length ? `${project.datasets[id].length} 个要素` : "待接入"}</span></div><div className="muted truncate" title={project.sources[id].name}>{project.sources[id].name}</div><small>{geometry} · {purpose}{project.sources[id].sha256 && ` · SHA-256 ${project.sources[id].sha256.slice(0, 12)}`}</small>
          <div className="metadata-fields"><label>数据时态<select aria-label={`${title}数据时态`} value={project.sources[id].timing} onChange={(e) => onMetadata(id, { timing: e.target.value })}><option value="unknown">未核验</option><option value="present">现状数据</option><option value="historical">历史重建</option></select></label><label>所属时期<input aria-label={`${title}所属时期`} placeholder="如：秦汉时期" value={project.sources[id].period} onChange={(e) => onMetadata(id, { period: e.target.value })} /></label><label className="citation-field">数据出处<input aria-label={`${title}数据出处`} placeholder="机构、报告或数据版本" value={project.sources[id].citation} onChange={(e) => onMetadata(id, { citation: e.target.value })} /></label></div>
        </div><div className="dataset-actions"><label className="button"><Upload size={15} />{busy === id ? "导入中" : project.sources[id].sha256 ? "替换图层" : "导入图层"}<input type="file" accept=".geojson,.json" aria-label={`导入${title}`} disabled={Boolean(busy)} onChange={(e) => { importFile(id, e.target.files[0]); e.target.value = ""; }} /></label><a href={`/templates/${template}.geojson`} download><Download size={13} />格式模板</a></div>
      </article>)}</div>
    </section>
    <section className="section two-column"><div><h2>地形数据约定</h2><p className="muted">地形值从 GIS 预计算结果读取，不由底图推测。点位属性支持 <code>elevation_m</code>、<code>slope_deg</code>、<code>aspect_deg</code>、<code>tpi</code>、<code>terrain_source</code> 与 <code>precision_m</code>。空值保持缺失。</p><a href="https://grass.osgeo.org/grass-stable/manuals/r.slope.aspect.html" target="_blank" rel="noreferrer">GRASS 地形处理文档 <ExternalLink size={13} /></a></div><div><h2>项目存储</h2><p className="muted">图层和笔记保存在当前浏览器，不上传服务器。清除浏览器数据会删除本地存档；三维模型单独存储，JSON 备份不包含模型文件。</p>{resetConfirm ? <div className="button-row"><span>重置图层与笔记？</span><button className="button danger" onClick={() => { onReset(); setResetConfirm(false); setNotice({ message: "已恢复内置演示点位。" }); }}>确认重置</button><button className="button" onClick={() => setResetConfirm(false)}>取消</button></div> : <button className="text-button" onClick={() => setResetConfirm(true)}><RotateCcw size={15} />恢复演示项目</button>}</div></section>
  </div>;
}
