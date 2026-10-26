import { useEffect, useMemo, useRef, useState } from "react";
import { get, set } from "idb-keyval";
import L from "leaflet";
import { Thermometer, Droplets, RefreshCw, Download, Upload, Wind, CloudRain, CircleAlert, ExternalLink, Radio, MapPin } from "lucide-react";
import { referenceSites } from "./referenceSites.js";
import { download } from "./project.js";
import { METRICS, WEATHER_REFRESH_MS, SENSOR_STALE_MS, weatherUrl, parseWeather, parseWeatherSnapshot, parseSensorData, summarizeEnvironment, environmentColor, environmentSnapshot } from "./environment.js";
import "./environment.css";

const valueText = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : "—";
const timeText = (time, date = false) => time ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: date ? "2-digit" : undefined, day: date ? "2-digit" : undefined, hour: "2-digit", minute: "2-digit", hour12: false }).format(time) : "待接入";
const SENSOR_KEY = "heritage-environment-sensors-v1";
async function readJson(response) {
  if (!response.ok) throw new Error("数据服务返回 HTTP " + response.status);
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 2 * 1024 * 1024) throw new Error("响应超过 2 MB，请减少记录数量。"); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(await new Blob(chunks).text());
}

function EnvironmentMap({ sites, records, selectedId, metric, onSelect, asOf }) {
  const host = useRef(null); const map = useRef(null); const group = useRef(null);
  useEffect(() => {
    const instance = L.map(host.current, { scrollWheelZoom: false }).setView([36, 105], 4);
    map.current = instance;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 18 }).addTo(instance);
    group.current = L.layerGroup().addTo(instance);
    const resize = new ResizeObserver(() => instance.invalidateSize()); resize.observe(host.current);
    return () => { resize.disconnect(); instance.remove(); map.current = null; group.current = null; };
  }, []);
  const locationKey = sites.map((site) => [site.id, site.lat, site.lng].join(":")).join("|");
  useEffect(() => { if (sites.length && map.current) map.current.fitBounds(sites.map((site) => [site.lat, site.lng]), { padding: [55, 55], maxZoom: 10 }); }, [locationKey]);
  useEffect(() => {
    if (!group.current) return;
    group.current.clearLayers();
    const byId = new Map(records.map((record) => [record.siteId, record]));
    for (const site of sites) {
      const observation = byId.get(site.id); const stale = observation && asOf - observation.timestamp > SENSOR_STALE_MS;
      const value = stale ? null : observation?.[metric]; const active = site.id === selectedId;
      const marker = L.circleMarker([site.lat, site.lng], { radius: active ? 12 : 9, color: active ? "#254e40" : "white", weight: active ? 3 : 2, fillColor: environmentColor(value, metric), fillOpacity: .95 }).addTo(group.current);
      const label = document.createElement("span"); label.textContent = site.name + " · " + (stale ? "过期参考" : valueText(value) + METRICS[metric].unit);
      marker.bindTooltip(label, { permanent: active, direction: "top" }); marker.on("click", () => onSelect(site.id));
    }
  }, [sites, records, selectedId, metric, onSelect, asOf]);
  return <div className="environment-map" ref={host} aria-label={METRICS[metric].title + "点位分布地图"} />;
}

function EnvironmentChart({ record, metric, weather }) {
  const canvas = useRef(null); const meta = METRICS[metric];
  const points = useMemo(() => (record?.history || []).filter((point) => point.timestamp >= record.timestamp - 24 * 3600000 && point.timestamp <= record.timestamp + (weather ? 24 : 0) * 3600000), [record, weather]);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const draw = () => {
      const width = element.clientWidth; const height = 210; const dpr = Math.min(devicePixelRatio || 1, 2);
      element.width = width * dpr; element.height = height * dpr;
      const ctx = element.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);
      const values = points.map((point) => point[metric]).filter(Number.isFinite);
      if (!values.length || points.length < 2 || width < 100) return;
      const low = metric === "humidity" ? 0 : Math.floor(Math.min(...values) - 2); const high = metric === "humidity" ? 100 : Math.ceil(Math.max(...values) + 2);
      const left = 43, right = width - 14, top = 15, bottom = 177;
      const first = points[0].timestamp, last = points.at(-1).timestamp;
      if (last === first) return;
      const x = (t) => left + (t - first) / (last - first) * (right - left);
      const y = (value) => bottom - (value - low) / (high - low) * (bottom - top);
      ctx.font = "11px sans-serif"; ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) { const value = low + (high - low) * i / 4; const at = y(value); ctx.strokeStyle = "#e5ece7"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, at); ctx.lineTo(right, at); ctx.stroke(); ctx.fillStyle = "#78877f"; ctx.fillText(value.toFixed(0), left - 9, at + 4); }
      for (let i = 0; i < 5; i++) { const t = first + (last - first) * i / 4; ctx.textAlign = i === 0 ? "left" : i === 4 ? "right" : "center"; ctx.fillText(timeText(t, true), x(t), 200); }
      for (let i = 1; i < points.length; i++) {
        if (!Number.isFinite(points[i - 1][metric]) || !Number.isFinite(points[i][metric])) continue;
        ctx.beginPath(); ctx.lineWidth = 2; ctx.strokeStyle = meta.color; ctx.setLineDash(weather && points[i].timestamp > record.timestamp ? [5, 4] : []); ctx.moveTo(x(points[i - 1].timestamp), y(points[i - 1][metric])); ctx.lineTo(x(points[i].timestamp), y(points[i][metric])); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const point of points) { if (!Number.isFinite(point[metric])) continue; ctx.beginPath(); ctx.fillStyle = meta.color; ctx.arc(x(point.timestamp), y(point[metric]), 2.5, 0, Math.PI * 2); ctx.fill(); }
      if (weather && record.timestamp >= first && record.timestamp <= last) { const current = x(record.timestamp); ctx.strokeStyle = "#82968a"; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(current, top); ctx.lineTo(current, bottom); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = "#4d6d59"; ctx.textAlign = "left"; ctx.fillText("资料时次", Math.min(current + 5, right - 50), top + 6); }
    };
    const observer = new ResizeObserver(draw); observer.observe(element); draw(); return () => observer.disconnect();
  }, [points, metric, meta, record, weather]);
  const hasPoints = points.some((point) => Number.isFinite(point[metric]));
  return <div className="environment-chart"><canvas ref={canvas} role="img" aria-label={meta.title + "逐小时趋势，单位" + meta.unit + "；完整数值见下方表格"} />{!hasPoints && <p className="environment-chart-empty">尚无可绘制的逐时数据</p>}<details><summary>查看逐时数值 · 北京时间</summary><div className="environment-hour-table"><table><thead><tr><th>时间</th><th>{meta.title}（{meta.unit}）</th><th>资料性质</th></tr></thead><tbody>{points.map((point) => <tr key={point.timestamp}><td>{timeText(point.timestamp, true)}</td><td>{valueText(point[metric])}</td><td>{weather ? point.timestamp > record.timestamp ? "模型预报" : "逐时模型值" : "导入观测"}</td></tr>)}</tbody></table></div></details></div>;
}

export default function EnvironmentView({ sites: projectSites, onData }) {
  const responseCache = useRef(new Map()); const [asOf, setAsOf] = useState(Date.now);
  const [mode, setMode] = useState("weather"); const [scope, setScope] = useState("public"); const [projectEnabled, setProjectEnabled] = useState(false);
  const [selectedId, setSelectedId] = useState(referenceSites[0].id); const [metric, setMetric] = useState("temperature");
  const [version, setVersion] = useState(0); const [state, setState] = useState({ key: "", records: [], fetchedAt: null }); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const [sensor, setSensor] = useState(null); const [sensorUrl, setSensorUrl] = useState(""); const [endpoint, setEndpoint] = useState("");
  const sites = useMemo(() => (scope === "public" ? referenceSites : projectSites.slice(0, 30)), [scope, projectSites]);
  const siteKey = sites.map((site) => [site.id, site.lat, site.lng].join(":")).join("|");
  const requestKey = mode + "|" + (mode === "weather" ? siteKey : endpoint || "local-sensors");
  const records = state.key === requestKey ? state.records : [];
  const offline = state.key === requestKey && state.offline;
  const selectedSite = sites.find((site) => site.id === selectedId) || sites[0];
  const record = records.find((item) => item.siteId === selectedSite?.id);
  const unmatched = records.filter((item) => !sites.some((site) => site.id === item.siteId)).length;
  const summary = summarizeEnvironment(records.filter((item) => sites.some((site) => site.id === item.siteId) && asOf - item.timestamp <= SENSOR_STALE_MS && item.timestamp <= asOf + 300000), metric);
  const isOld = record && asOf - record.timestamp > SENSOR_STALE_MS;
  useEffect(() => { const timer = setInterval(() => setAsOf(Date.now()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let alive = true;
    get(SENSOR_KEY).then((saved) => { if (alive && saved) { parseSensorData(saved); setSensor(saved); } }).catch(() => { if (alive) setError("本地观测记录读取失败，原资料未被覆盖。"); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (mode === "sensor" && !endpoint) {
      setLoading(false); setState({ key: requestKey, records: sensor ? parseSensorData(sensor) : [], fetchedAt: null }); return;
    }
    if (!sites.length || mode === "weather" && scope === "project" && !projectEnabled) { setLoading(false); return; }
    const controller = new AbortController(); let alive = true;
    const timeout = setTimeout(() => controller.abort(), 20000);
    setState(responseCache.current.get(requestKey) || { key: requestKey, records: [], fetchedAt: null });
    setLoading(true); setError("");
    fetch(mode === "weather" ? weatherUrl(sites) : endpoint, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" })
      .then(readJson).then((payload) => mode === "weather" ? parseWeather(payload, sites) : parseSensorData(payload))
      .then((next) => { if (alive) { const result = { key: requestKey, records: next, fetchedAt: Date.now() }; if (responseCache.current.size >= 8) responseCache.current.delete(responseCache.current.keys().next().value); responseCache.current.set(requestKey, result); setAsOf(Date.now()); setState(result); } })
      .catch(async (issue) => {
        if (!alive) return;
        const message = issue.name === "AbortError" ? "数据请求超时" : issue.message;
        if (mode === "weather" && scope === "public" && !responseCache.current.has(requestKey)) {
          try {
            const archive = parseWeatherSnapshot(await fetch("/samples/environment-weather-reference.json", { credentials: "omit" }).then(readJson), sites);
            if (!alive) return;
            const result = { key: requestKey, ...archive, offline: true };
            responseCache.current.set(requestKey, result); setState(result);
            setError("天气服务暂不可用，正在显示随应用保存的历史快照（非实时）。快照时间见下方，超过 1 小时不计入当前汇总。"); return;
          } catch { /* No usable archive: show the source error without inventing values. */ }
        }
        if (alive) setError(message + "。同一数据源的上次结果仍保留；请检查网络或重试。");
      })
      .finally(() => { clearTimeout(timeout); if (alive) setLoading(false); });
    return () => { alive = false; clearTimeout(timeout); controller.abort(); };
  }, [requestKey, version, sensor, scope, projectEnabled]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden && (mode === "weather" || endpoint)) setVersion((v) => v + 1); }, WEATHER_REFRESH_MS);
    return () => clearInterval(timer);
  }, [mode, endpoint]);
  async function importSensor(file) {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("观测文件不超过 2 MB。");
      const raw = JSON.parse(await file.text()); parseSensorData(raw);
      await set(SENSOR_KEY, raw); setSensor(raw); setEndpoint(""); setMode("sensor"); setError("");
    } catch (issue) { setError("导入未完成：" + issue.message + " 原观测资料保留。"); }
  }
  function connect() {
    try { const url = new URL(sensorUrl); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("请输入不含账号密码的 HTTP(S) JSON 地址。"); setEndpoint(url.href); setVersion((v) => v + 1); setError(""); } catch (issue) { setError(issue.message); }
  }
  return <div className="page-scroll environment-page">
    <div className="page-title"><div><span className="eyebrow">HERITAGE ENVIRONMENT OBSERVATORY</span><h1>环境总览</h1><p className="environment-subtitle">从地点到变化，让温度与湿度成为可追溯的记录。</p></div><div className="button-row"><button className="button" disabled={loading || !records.length} onClick={() => download("遗产环境-数据快照.json", { ...environmentSnapshot(mode, sites, records, state.fetchedAt), offlineArchive: Boolean(offline) })}><Download size={15} />导出快照</button><button className="button primary" disabled={loading || mode === "sensor" && !endpoint || mode === "weather" && scope === "project" && !projectEnabled} onClick={() => setVersion((v) => v + 1)}><RefreshCw size={15} className={loading ? "environment-spinning" : ""} />{loading ? "读取中…" : "刷新数据"}</button></div></div>
    <div className="environment-source-tabs tabs"><button aria-pressed={mode === "weather"} onClick={() => { setMode("weather"); setError(""); }}><CloudRain size={16} />公开天气参考</button><button aria-pressed={mode === "sensor"} onClick={() => { setMode("sensor"); setError(""); }}><Radio size={16} />现场观测接入</button></div>
    <div className="environment-status"><span className={"badge " + (mode === "weather" ? "green" : "gray")}>{mode === "weather" ? offline ? "离线历史快照 · 非实时" : "Open-Meteo · 天气模型" : endpoint ? "自定义 JSON 数据服务" : "本地观测资料"}</span><span>{state.key === requestKey && state.fetchedAt ? "获取于 " + timeText(state.fetchedAt, true) + " · 北京时间" : mode === "sensor" ? records.length ? "本地观测资料已读取" : "等待现场资料或数据服务" : loading ? "正在连接数据源" : "尚未获取数据"}</span><span>{mode === "weather" || endpoint ? "每 10 分钟刷新，后台标签页暂停" : "导入后保存在此设备"}</span></div>
    <p className="environment-data-note">{mode === "weather" ? "公开天气为附近网格的 2 米气温与相对湿度模型值，不能代替文物表面、洞窟或展柜的现场监测。地图为点位着色，不推断点位之间的连续温度场。" : "现场资料按提供者标注显示；请核对仪器、单位、校准和测点位置。超过 1 小时的数据标为过期参考。"} <a href={mode === "weather" ? "https://open-meteo.com/en/docs" : "/templates/environment-sensor-example.json"} target="_blank" rel="noreferrer">数据说明<ExternalLink size={12} /></a></p>
    {error && <div className="notice error" role="alert"><CircleAlert size={16} />{error}</div>}
    {unmatched > 0 && <div className="notice warning" role="status">有 {unmatched} 处观测未匹配当前点位集合，请核对 siteId 或切换到相应项目；这些记录未计入当前地图与汇总。</div>}
    <div className="environment-controls"><label>点位集合<select aria-label="环境点位集合" value={scope} onChange={(e) => { setScope(e.target.value); setProjectEnabled(false); }}><option value="public">公开遗产参考点 · 3 处</option><option value="project">当前项目 · {Math.min(projectSites.length, 30)} 处</option></select></label><div className="environment-metric-switch" role="group" aria-label="环境地图指标">{Object.entries(METRICS).map(([key, item]) => <button key={key} aria-pressed={metric === key} onClick={() => setMetric(key)}>{key === "temperature" ? <Thermometer size={16} /> : <Droplets size={16} />}{item.title}</button>)}</div><button className="text-button" onClick={onData}>管理与追加点位<ExternalLink size={13} /></button></div>
    {scope === "project" && mode === "weather" && <div className="notice warning"><span>公开天气服务会接收当前点位经纬度；含演示点位时，结果只对应演示坐标。{projectSites.length > 30 ? "本页仅请求前 30 处，请按研究区拆分。" : ""}</span>{mode === "weather" && !projectEnabled && <button className="button" onClick={() => setProjectEnabled(true)}>加载项目天气</button>}</div>}
    {mode === "sensor" && <section className="environment-sensor-panel"><div><h2>让现场设备接入同一张图</h2><p>导入带时区、点位 ID、温湿度的 JSON，或连接提供同样格式的只读服务。当前没有内置现场传感器。</p><div className="button-row"><label className="button"><Upload size={15} />导入现场观测 JSON<input aria-label="导入现场观测JSON" type="file" accept=".json,application/json" onChange={(e) => { importSensor(e.target.files[0]); e.target.value = ""; }} /></label><a className="text-button" href="/templates/environment-sensor-example.json" download>下载空白模板<Download size={13} /></a></div></div><div className="environment-endpoint"><label>只读 JSON 服务地址<input type="url" aria-label="现场JSON服务地址" value={sensorUrl} onChange={(e) => setSensorUrl(e.target.value)} placeholder="https://你的数据服务/api/environment" /></label><button className="button" onClick={connect} disabled={!sensorUrl.trim() || loading}>连接服务</button><small>服务需允许本网页跨域读取，私有凭据由你的服务端处理。</small></div></section>}
    <div className="environment-summary"><div><span>有效{METRICS[metric].title}点位</span><strong>{summary.count}<small> / {sites.length}</small></strong></div><div><span>点位最高值</span><strong>{valueText(summary.max)}<small>{METRICS[metric].unit}</small></strong></div><div><span>点位最低值</span><strong>{valueText(summary.min)}<small>{METRICS[metric].unit}</small></strong></div><div><span>点位均值</span><strong>{valueText(summary.mean)}<small>{METRICS[metric].unit}</small></strong></div></div>
    <div className="environment-main-grid"><section className="environment-map-panel"><div className="section-heading"><h2>{METRICS[metric].title}点位总览</h2><span className="muted">WGS84 · {scope === "public" ? "公开参考位置" : "项目点位，含演示位置时须核验"}</span></div><EnvironmentMap sites={sites} records={records} selectedId={selectedSite?.id} metric={metric} onSelect={setSelectedId} asOf={asOf} /><div className="environment-map-legend">{(metric === "temperature" ? [[-10,"< 0°C"],[5,"0–10"],[15,"10–20"],[25,"20–30"],[35,"≥ 30"]] : [[10,"< 20%"],[30,"20–40"],[50,"40–60"],[70,"60–80"],[90,"≥ 80"]]).map(([value,label]) => <span key={value}><i style={{backgroundColor:environmentColor(value,metric)}} />{label}</span>)}<span><i style={{backgroundColor:"#9aa9a3"}} />无数据</span></div></section>
      <aside className="environment-detail"><span className="eyebrow">SELECTED LOCATION</span><label>当前点位<select aria-label="环境当前点位" value={selectedSite?.id || ""} onChange={(e) => setSelectedId(e.target.value)}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><p className="environment-location"><MapPin size={14} />{selectedSite?.location || "暂无点位"}</p><div className="environment-readings"><div><Thermometer size={20} /><span>气温</span><strong>{valueText(record?.temperature)}<small>°C</small></strong></div><div><Droplets size={20} /><span>相对湿度</span><strong>{valueText(record?.humidity,0)}<small>%</small></strong></div><div><Wind size={18} /><span>风速</span><strong>{valueText(record?.windSpeed)}<small>m/s</small></strong></div><div><CloudRain size={18} /><span>前一时段降水</span><strong>{valueText(record?.precipitation)}<small>mm</small></strong></div></div><p className={"environment-age" + (isOld ? " old" : "")}>{record ? (isOld ? "过期参考 · " : "数据时次 · ") + timeText(record.timestamp,true) : loading ? "等待服务响应…" : "当前点位暂无数据"}</p><p className="environment-detail-source">{record?.source || "尚未接入"}<br />{mode === "weather" ? "天气模型参考；降水聚合时段见导出快照 interval（秒）。" : "缺失指标保持为空，不使用天气值填充现场观测。"}</p><details><summary>点位与来源</summary><p>{selectedSite?.recordSource || "用户导入点位，来源待核验"}</p><p>{selectedSite ? Math.abs(selectedSite.lat).toFixed(5) + (selectedSite.lat < 0 ? "° S, " : "° N, ") + Math.abs(selectedSite.lng).toFixed(5) + (selectedSite.lng < 0 ? "° W" : "° E") : ""}</p><p>位置精度待核验；不是保护范围或设备布点坐标。</p></details></aside>
    </div>
    <section className="environment-trend"><div className="section-heading"><div><span className="eyebrow">TEMPORAL VIEW</span><h2>{selectedSite?.name || "点位"} · {METRICS[metric].title}趋势</h2></div><span className="muted">{mode === "weather" ? offline ? "快照时次前 24 小时模型值 / 后 24 小时预报（虚线）" : "过去 24 小时模型值 / 未来 24 小时预报（虚线）" : "最近时次之前 24 小时的导入观测"}</span></div><EnvironmentChart record={record} metric={metric} weather={mode === "weather"} /></section>
    <section className="environment-site-list"><div className="section-heading"><h2>逐点数据与可用性</h2><span className="muted">缺失值为 —，不计入汇总</span></div><div className="table-scroll"><table><thead><tr><th>遗产点位</th><th>气温</th><th>相对湿度</th><th>时次（北京时间）</th><th>数据性质</th></tr></thead><tbody>{sites.map((site) => { const row=records.find((item)=>item.siteId===site.id); return <tr key={site.id} className={site.id===selectedSite?.id?"selected-row":""}><td><button className="table-link" onClick={()=>setSelectedId(site.id)}>{site.name}</button></td><td>{valueText(row?.temperature)} °C</td><td>{valueText(row?.humidity,0)} %</td><td>{timeText(row?.timestamp,true)}</td><td>{row ? (asOf-row.timestamp>SENSOR_STALE_MS?"过期参考 · ":"")+(mode==="weather"?"天气模型":"导入观测") : "待接入"}</td></tr>; })}</tbody></table></div></section>
    <p className="environment-attribution">天气数据：<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>。当前免费接口用于非商业原型与研究，商业接入需按服务条款配置。图表仅分析已获取的数据，不作结构安全或文物病害结论。</p>
  </div>;
}
