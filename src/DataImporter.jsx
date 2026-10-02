import { useState } from "react";
import { parseGeoJson } from "./geodata.js";

const fields = [
  ["sites", "遗址点位", "Point；建议含 name、period、site_type、location 字段"],
  ["waterways", "河流水系", "LineString 或 MultiLineString"],
  ["routes", "古道线路", "LineString 或 MultiLineString，可选"],
];

export function DataImporter({ sources, onImport, onReset, onClose }) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleFile(kind, file) {
    if (!file) return;
    setError("");
    setMessage("");
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error("文件超过 15 MB，请按研究区裁剪后再导入。");
      const text = await file.text();
      const parsed = parseGeoJson(text, kind);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      onImport(kind, parsed, file.name, { sha256, importedAt: new Date().toISOString() });
      setMessage(`${file.name} 已导入 ${parsed.features.length} 个有效要素${parsed.skipped ? `，跳过 ${parsed.skipped} 个不支持的要素` : ""}。`);
    } catch (caught) {
      setError(caught.message || "导入失败，请检查文件格式。");
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="data-dialog" role="dialog" aria-modal="true" aria-labelledby="data-dialog-title">
        <div className="dialog-heading">
          <div><h2 id="data-dialog-title">数据管理</h2><p>导入 WGS84 / EPSG:4326 GeoJSON。文件只在当前浏览器会话中处理。</p></div>
          <button className="icon-button" type="button" title="关闭" aria-label="关闭" onClick={onClose}><i className="ri-close-line" /></button>
        </div>
        <div className="dataset-list">
          {fields.map(([kind, title, hint]) => (
            <div className="dataset-row" key={kind}>
              <div><strong>{title}</strong><small>{hint}</small><span>当前：{sources[kind].name} · {sources[kind].count} 个要素{sources[kind].sha256 ? ` · SHA-256 ${sources[kind].sha256.slice(0, 10)}…` : ""}</span></div>
              <label className="upload-button"><i className="ri-upload-2-line" /> 导入
                <input type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={(event) => { handleFile(kind, event.target.files?.[0]); event.target.value = ""; }} />
              </label>
            </div>
          ))}
        </div>
        {error && <p className="import-error" role="alert">{error}</p>}
        {message && <p className="import-success" role="status">{message}</p>}
        <div className="dialog-footer">
          <a href="/templates/heritage-sites.geojson" download>遗址点位模板</a>
          <a href="/templates/waterways.geojson" download>水系模板</a>
          <button type="button" onClick={() => { onReset(); setMessage("已恢复演示点位，并清空导入图层。"); setError(""); }}>恢复演示数据</button>
        </div>
      </section>
    </div>
  );
}
