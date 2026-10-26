import { useEffect, useMemo, useRef, useState } from "react";
import { get, set } from "idb-keyval";
import L from "leaflet";
import { Thermometer, Droplets, RefreshCw, Download, Upload, Wind, CloudRain, CircleAlert, Radio, MapPin, Clock3, SlidersHorizontal, X, ArrowUpRight, ArrowDownRight, Info, ChevronDown } from "lucide-react";
import { referenceSites } from "./referenceSites.js";
import { download } from "./project.js";
import { METRICS, REFRESH_OPTIONS, refreshCadence, connectionStatus, trendWindow, SENSOR_STALE_MS, weatherUrl, parseWeather, parseWeatherSnapshot, parseSensorData, summarizeEnvironment, environmentColor, environmentSnapshot } from "./environment.js";
import "./environment.css";
import { siteName } from "./presentation.js";
import { TencentMap, MapProviderSelect, defaultMapProvider } from "./TencentMap.jsx";

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
  const [provider, setProvider] = useState(defaultMapProvider);
  const [unavailable, setUnavailable] = useState(false);
  const points = useMemo(() => {
    const byId = new Map(records.map((record) => [record.siteId, record]));
    return sites.map((site) => {
      const observation = byId.get(site.id); const stale = observation && asOf - observation.timestamp > SENSOR_STALE_MS;
      const value = stale ? null : observation?.[metric];
      return { ...site, active: site.id === selectedId, color: environmentColor(value, metric), label: siteName(site) + " · " + (stale ? "过期参考" : valueText(value) + METRICS[metric].unit) };
    });
  }, [sites, records, selectedId, metric, asOf]);
  return <div className="environment-map">{provider === "tencent" ? <TencentMap points={points} fitLocations scrollable={false} onSelect={onSelect} onUnavailable={() => { setProvider("osm"); setUnavailable(true); }} label={METRICS[metric].title + "点位分布地图"} /> : <OpenEnvironmentMap sites={sites} records={records} selectedId={selectedId} metric={metric} onSelect={onSelect} asOf={asOf} />}<MapProviderSelect value={provider} onChange={(value) => { setProvider(value); setUnavailable(false); }} />{unavailable && <div className="basemap-status" role="status">腾讯地图暂不可用，已切换 OpenStreetMap</div>}</div>;
}

function OpenEnvironmentMap({ sites, records, selectedId, metric, onSelect, asOf }) {
  const host = useRef(null); const map = useRef(null); const group = useRef(null);
  const locations = useRef(sites); locations.current = sites;
  useEffect(() => {
    const instance = L.map(host.current, { zoomControl: false, scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([36, 105], 4);
    map.current = instance;
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 18 }).addTo(instance);
    group.current = L.layerGroup().addTo(instance);
    const resize = new ResizeObserver(() => { instance.invalidateSize(); if (locations.current.length) instance.fitBounds(locations.current.map((site) => [site.lat, site.lng]), { padding: [45, 45], maxZoom: 10 }); }); resize.observe(host.current);
    return () => { resize.disconnect(); instance.stop(); instance.remove(); map.current = null; group.current = null; };
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
      const label = document.createElement("span"); label.textContent = siteName(site) + " · " + (stale ? "过期参考" : valueText(value) + METRICS[metric].unit);
      marker.bindTooltip(label, { permanent: active, direction: "top" }); marker.on("click", () => onSelect(site.id));
    }
  }, [sites, records, selectedId, metric, onSelect, asOf]);
  return <div className="map-canvas" ref={host} aria-label={METRICS[metric].title + "点位分布地图"} />;
}

function EnvironmentChart({ record, metric, weather, range = 48 }) {
  const canvas = useRef(null); const meta = METRICS[metric];
  const points = useMemo(() => trendWindow(record, weather, range), [record, weather, range]);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const draw = () => {
      const width = element.clientWidth; const height = element.clientHeight || 160; const dpr = Math.min(devicePixelRatio || 1, 2);
      element.width = width * dpr; element.height = height * dpr;
      const ctx = element.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);
      const values = points.map((point) => point[metric]).filter(Number.isFinite);
      if (!values.length || width < 100) return;
      const low = metric === "humidity" ? 0 : Math.floor(Math.min(...values) - 2); const high = metric === "humidity" ? 100 : Math.ceil(Math.max(...values) + 2);
      const left = 43, right = width - 14, top = 12, bottom = height - 29;
      const first = points[0].timestamp - (points.length === 1 ? 3600000 : 0), last = points.at(-1).timestamp + (points.length === 1 ? 3600000 : 0);
      if (last === first) return;
      const x = (t) => left + (t - first) / (last - first) * (right - left);
      const y = (value) => bottom - (value - low) / (high - low) * (bottom - top);
      ctx.font = "11px sans-serif"; ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) { const value = low + (high - low) * i / 4; const at = y(value); ctx.strokeStyle = "#e5ece7"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, at); ctx.lineTo(right, at); ctx.stroke(); ctx.fillStyle = "#78877f"; ctx.fillText(value.toFixed(0), left - 9, at + 4); }
      for (let i = 0; i < 3; i++) { const t = first + (last - first) * i / 2; ctx.textAlign = i === 0 ? "left" : i === 2 ? "right" : "center"; ctx.fillText(timeText(t, true), x(t), height - 7); }
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
  return <div className="environment-chart"><canvas ref={canvas} role="img" aria-label={meta.title + "逐小时趋势，单位" + meta.unit + "；完整数值见下方表格"} />{!hasPoints && <p className="environment-chart-empty">尚无可绘制的逐时数据</p>}<details><summary>查看逐时数值 · 北京时间</summary><div className="environment-hour-table"><table><thead><tr><th>时间</th><th>{meta.title}（{meta.unit}）</th><th>资料性质</th></tr></thead><tbody>{points.map((point) => <tr key={point.timestamp}><td>{timeText(point.timestamp, true)}</td><td>{valueText(point[metric])}</td><td>{weather ? point.timestamp > record.timestamp ? "预报" : "天气记录" : "导入观测"}</td></tr>)}</tbody></table></div></details></div>;
}

export default function EnvironmentView({ sites: projectSites, onData }) {
  const responseCache = useRef(new Map());
  const [asOf, setAsOf] = useState(Date.now);
  const [clock, setClock] = useState(Date.now);
  const [mode, setMode] = useState("weather");
  const [scope, setScope] = useState("public");
  const [projectEnabled, setProjectEnabled] = useState(false);
  const [selectedId, setSelectedId] = useState(referenceSites[0].id);
  const [metric, setMetric] = useState("temperature");
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({ key: "", records: [], fetchedAt: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sensor, setSensor] = useState(null);
  const [sensorUrl, setSensorUrl] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [automatic, setAutomatic] = useState(true);
  const [cadences, setCadences] = useState({ weather: 60, sensor: 30 });
  const [nextUpdate, setNextUpdate] = useState(null);
  const [range, setRange] = useState(48);
  const [accessOpen, setAccessOpen] = useState(false);
  const sites = useMemo(() => scope === "public" ? referenceSites : projectSites.slice(0, 30), [scope, projectSites]);
  const siteKey = sites.map((site) => [site.id, site.lat, site.lng].join(":")).join("|");
  const requestKey = mode + "|" + (mode === "weather" ? siteKey : endpoint || "local-sensors");
  const records = state.key === requestKey ? state.records : [];
  const offline = state.key === requestKey && state.offline;
  const selectedSite = sites.find((site) => site.id === selectedId) || sites[0];
  const record = records.find((item) => item.siteId === selectedSite?.id);
  const knownRecords = records.filter((item) => sites.some((site) => site.id === item.siteId));
  const freshRecords = knownRecords.filter((item) => asOf - item.timestamp <= SENSOR_STALE_MS && item.timestamp <= asOf + 300000);
  const summary = summarizeEnvironment(freshRecords, metric);
  const unmatched = records.length - knownRecords.length;
  const isOld = record && asOf - record.timestamp > SENSOR_STALE_MS;
  const status = connectionStatus({ loading, offline, error, records: knownRecords, now: asOf, mode, endpoint, automatic });
  const canRequest = sites.length > 0 && (mode === "weather" ? scope === "public" || projectEnabled : Boolean(endpoint));
  const refreshMs = refreshCadence(mode, cadences[mode]);
  const secondsLeft = nextUpdate ? Math.max(0, Math.ceil((nextUpdate - clock) / 1000)) : null;
  const latestTime = knownRecords.length ? Math.max(...knownRecords.map((item) => item.timestamp)) : null;
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); const staleTimer = setInterval(() => setAsOf(Date.now()), 60000); return () => { clearInterval(timer); clearInterval(staleTimer); }; }, []);
  useEffect(() => {
    let alive = true;
    get(SENSOR_KEY).then((saved) => { if (alive && saved) { parseSensorData(saved); setSensor(saved); } }).catch(() => { if (alive) setError("观测记录读取失败，已保留原资料。"); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (mode === "sensor" && !endpoint) { setLoading(false); setState({ key: requestKey, records: sensor ? parseSensorData(sensor) : [], fetchedAt: null }); return; }
    if (!canRequest) { setLoading(false); return; }
    const controller = new AbortController(); let alive = true;
    const timeout = setTimeout(() => controller.abort(), 20000);
    setState(responseCache.current.get(requestKey) || { key: requestKey, records: [], fetchedAt: null });
    setLoading(true); setError("");
    fetch(mode === "weather" ? weatherUrl(sites) : endpoint, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" })
      .then(readJson).then((payload) => mode === "weather" ? parseWeather(payload, sites) : parseSensorData(payload))
      .then((next) => {
        if (!alive) return;
        const result = { key: requestKey, records: next, fetchedAt: Date.now() };
        if (responseCache.current.size >= 8) responseCache.current.delete(responseCache.current.keys().next().value);
        responseCache.current.set(requestKey, result); setAsOf(Date.now()); setState(result);
      })
      .catch(async (issue) => {
        if (!alive) return;
        if (mode === "weather" && scope === "public" && !responseCache.current.has(requestKey)) {
          try {
            const archive = parseWeatherSnapshot(await fetch("/samples/environment-weather-reference.json", { credentials: "omit" }).then(readJson), sites);
            if (!alive) return;
            const result = { key: requestKey, ...archive, offline: true };
            responseCache.current.set(requestKey, result); setState(result);
            setError("连接暂不可用，当前显示已存历史记录，恢复连接后自动更新。"); return;
          } catch { /* Keep unavailable values empty. */ }
        }
        if (alive) setError(issue.name === "AbortError" ? "连接超时，正在等待下次同步。" : "数据源暂不可用，已保留同一来源的上次记录。");
      }).finally(() => { clearTimeout(timeout); if (alive) setLoading(false); });
    return () => { alive = false; clearTimeout(timeout); controller.abort(); };
  }, [requestKey, version, sensor, canRequest]);
  useEffect(() => {
    setNextUpdate(null);
    if (!automatic || !canRequest || loading) return;
    const due = Date.now() + refreshMs; setNextUpdate(due);
    const timer = setTimeout(() => { if (!document.hidden) setVersion((value) => value + 1); else setNextUpdate(null); }, refreshMs);
    const resume = () => { if (!document.hidden) setVersion((value) => value + 1); };
    document.addEventListener("visibilitychange", resume);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", resume); };
  }, [automatic, canRequest, refreshMs, loading, requestKey, state.fetchedAt]);
  async function importSensor(file) {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("文件不超过 2 MB。");
      const raw = JSON.parse(await file.text()); parseSensorData(raw);
      await set(SENSOR_KEY, raw); setSensor(raw); setEndpoint(""); setMode("sensor"); setError(""); setAsOf(Date.now());
    } catch (issue) { setError("导入未完成：" + issue.message + " 原资料保留。"); }
  }
  function connect() {
    try { const url = new URL(sensorUrl); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("请输入不含账号密码的 HTTP(S) JSON 地址。"); setEndpoint(url.href); setVersion((value) => value + 1); setError(""); } catch (issue) { setError(issue.message); }
  }
  return <div className="page-scroll environment-page">
    <header className="observatory-heading"><div><span className="eyebrow">ENVIRONMENT OBSERVATORY</span><h1>环境总览<span>持续感知，守护每一处遗产</span></h1></div><div className={"connection-state " + status.key} role="status"><i />{status.label}</div></header>
    <div className="observatory-toolbar"><div className="environment-source-tabs" aria-label="环境数据来源">{[["weather", "天气环境", CloudRain], ["sensor", "现场监测", Radio]].map(([id, title, Icon]) => <button key={id} aria-pressed={mode === id} onClick={() => { setMode(id); setError(""); if (id === "sensor" && !sensor && !endpoint) setAccessOpen(true); }}><Icon size={16} />{title}</button>)}</div><div className="observatory-refresh"><label className="update-toggle"><input type="checkbox" aria-label="自动更新" checked={automatic} onChange={(event) => setAutomatic(event.target.checked)} /><span />自动更新</label><select aria-label="数据更新频率" value={cadences[mode]} onChange={(event) => setCadences((current) => ({ ...current, [mode]: Number(event.target.value) }))}>{REFRESH_OPTIONS[mode].map((seconds) => <option key={seconds} value={seconds}>{seconds < 60 ? seconds + " 秒" : seconds / 60 + " 分钟"}</option>)}</select><button className="button" aria-label="导出环境快照" disabled={!records.length || loading} onClick={() => download("遗产环境-数据快照.json", { ...environmentSnapshot(mode, sites, records, state.fetchedAt), offlineArchive: Boolean(offline) })}><Download size={15} />导出</button><button className="button primary" disabled={loading || !canRequest} onClick={() => setVersion((value) => value + 1)}><RefreshCw size={15} className={loading ? "environment-spinning" : ""} />{loading ? "同步中" : "立即更新"}</button></div></div>
    <div className="observatory-timing"><span><Clock3 size={13} />数据时间 <b>{timeText(latestTime, true)}</b></span><span>最近同步 {state.key === requestKey ? timeText(state.fetchedAt) : "—"}</span><span>{automatic && canRequest ? secondsLeft == null ? "等待同步" : "下次更新 " + String(Math.floor(secondsLeft / 60)).padStart(2, "0") + ":" + String(secondsLeft % 60).padStart(2, "0") : mode === "sensor" && !endpoint ? "通过文件更新" : "手动更新"}</span><button className="text-button" onClick={() => setAccessOpen(!accessOpen)}><SlidersHorizontal size={13} />数据接入</button></div>
    {error && <div className={"observation-message " + (offline ? "archive" : "warning")} role="status"><CircleAlert size={15} /><span>{error}</span>{offline && <b>记录时间 {timeText(latestTime, true)}</b>}</div>}
    {scope === "project" && mode === "weather" && !projectEnabled && <div className="observation-message"><MapPin size={15} /><span>加载后将当前项目坐标发送至 Open-Meteo，最多 30 处。</span><button className="button" onClick={() => setProjectEnabled(true)}>加载项目天气</button></div>}
    {unmatched > 0 && <div className="observation-message" role="status">{unmatched} 处记录未匹配当前点位集合，未计入地图与统计。</div>}
    {accessOpen && <section className="environment-access"><div className="section-heading"><div><h2>数据接入</h2><p>现场设备可通过只读 JSON 服务持续更新，也可导入观测文件。</p></div><button className="icon-button" aria-label="关闭数据接入" onClick={() => setAccessOpen(false)}><X size={17} /></button></div><div className="environment-access-grid"><div><label className="field">现场 JSON 服务地址<input type="url" aria-label="现场JSON服务地址" value={sensorUrl} onChange={(event) => setSensorUrl(event.target.value)} placeholder="https://你的数据服务/api/environment" /></label><button className="button primary" disabled={!sensorUrl.trim() || loading} onClick={() => { setMode("sensor"); connect(); }}>连接服务</button><small>跨域访问需由数据服务允许；私有凭据在服务端处理。</small></div><div><label className="button"><Upload size={15} />导入观测文件<input aria-label="导入现场观测JSON" type="file" accept=".json,application/json" onChange={(event) => { importSensor(event.target.files[0]); event.target.value = ""; }} /></label><a className="text-button" href="/templates/environment-sensor-example.json" download>下载格式模板 <Download size={13} /></a><p>按遗址 ID 关联记录；每条须包含时间、单位和来源。现场设备尚未配置时，数据保持为空。</p></div></div></section>}
    <section className="environment-summary" aria-label="环境指标统计">{[["覆盖点位", summary.count, "/ " + sites.length, MapPin], [METRICS[metric].title + "均值", valueText(summary.mean), METRICS[metric].unit, metric === "temperature" ? Thermometer : Droplets], ["点位最高值", valueText(summary.max), METRICS[metric].unit, ArrowUpRight], ["点位最低值", valueText(summary.min), METRICS[metric].unit, ArrowDownRight]].map(([title, value, unit, Icon]) => <div key={title}><div><span>{title}</span><Icon size={17} strokeWidth={1.5} /></div><strong>{value}<small>{unit}</small></strong></div>)}</section>
    <div className="observation-grid"><section className="observation-map-card"><div className="observation-map-heading"><div><h2>环境分布</h2><select aria-label="环境点位集合" value={scope} onChange={(event) => { setScope(event.target.value); setProjectEnabled(false); }}><option value="public">遗产观测点 · 3 处</option><option value="project">当前项目 · {Math.min(projectSites.length, 30)} 处</option></select></div><div className="environment-metric-switch" role="group" aria-label="环境地图指标">{Object.entries(METRICS).map(([key, meta]) => <button key={key} aria-pressed={metric === key} onClick={() => setMetric(key)}>{key === "temperature" ? <Thermometer size={14} /> : <Droplets size={14} />}{meta.title}</button>)}</div></div><EnvironmentMap sites={sites} records={records} selectedId={selectedSite?.id} metric={metric} onSelect={setSelectedId} asOf={asOf} /><div className="environment-map-legend">{(metric === "temperature" ? [[-10,"< 0°C"],[5,"0–10"],[15,"10–20"],[25,"20–30"],[35,"≥ 30"]] : [[10,"< 20%"],[30,"20–40"],[50,"40–60"],[70,"60–80"],[90,"≥ 80"]]).map(([value,label]) => <span key={value}><i style={{ backgroundColor: environmentColor(value, metric) }} />{label}</span>)}<span><i style={{ backgroundColor: "#9aa9a3" }} />暂无新记录</span></div></section>
    <aside className="location-observation"><div className="location-observation-heading"><span className="eyebrow">LOCATION INSIGHT</span><select aria-label="环境当前点位" value={selectedSite?.id || ""} onChange={(event) => setSelectedId(event.target.value)}>{sites.map((site) => <option key={site.id} value={site.id}>{siteName(site)}</option>)}</select><p><MapPin size={12} />{selectedSite?.location || "请选择点位"}<span>{isOld ? "历史记录" : mode === "weather" ? "天气数据" : "现场资料"}</span></p></div><div className="location-primary-reading"><div><span>{METRICS[metric].title}</span><strong>{valueText(record?.[metric], metric === "humidity" ? 0 : 1)}<small>{METRICS[metric].unit}</small></strong></div><div className="location-secondary-readings"><span>{metric === "temperature" ? <Droplets size={14} /> : <Thermometer size={14} />}{metric === "temperature" ? valueText(record?.humidity, 0) + " %" : valueText(record?.temperature) + " °C"}</span><span><Wind size={14} />{valueText(record?.windSpeed)} m/s</span><span><CloudRain size={14} />{valueText(record?.precipitation)} mm</span></div></div><div className="location-trend-heading"><h3>{METRICS[metric].title}趋势</h3><div role="group" aria-label="趋势时段">{[24, 48].map((hours) => <button key={hours} aria-pressed={range === hours} onClick={() => setRange(hours)}>{hours}h</button>)}</div></div><EnvironmentChart record={record} metric={metric} weather={mode === "weather"} range={range} /><p className="location-chart-caption">{mode === "weather" ? range === 48 ? "实线：过去时次 · 虚线：后续预报" : "过去 24 小时 · 逐时天气数据" : "最近记录前 " + range + " 小时 · 现场观测"}</p></aside></div>
    <section className="environment-site-list"><div className="section-heading"><div><span className="eyebrow">LOCATION RECORDS</span><h2>遗产地观测记录</h2></div><button className="text-button" onClick={onData}>管理点位<ArrowUpRight size={14} /></button></div><div className="table-scroll"><table><thead><tr><th>遗产点位</th><th>气温</th><th>相对湿度</th><th>数据时间</th><th>记录状态</th></tr></thead><tbody>{sites.map((site) => { const row = records.find((item) => item.siteId === site.id); return <tr key={site.id} className={site.id === selectedSite?.id ? "selected-row" : ""}><td><button className="table-link" onClick={() => setSelectedId(site.id)}>{siteName(site)}</button><small>{site.location}</small></td><td>{valueText(row?.temperature)} <small>°C</small></td><td>{valueText(row?.humidity,0)} <small>%</small></td><td>{timeText(row?.timestamp,true)}</td><td><span className={"record-dot " + (row && asOf - row.timestamp <= SENSOR_STALE_MS ? "current" : "")}/>{!row ? "等待数据" : offline || asOf - row.timestamp > SENSOR_STALE_MS ? "历史记录" : mode === "weather" ? "天气记录" : "现场资料"}</td></tr>; })}</tbody></table></div></section>
    <details className="environment-source-details"><summary><Info size={14} />数据来源与说明<ChevronDown size={14} /></summary><div><p>天气来源：<a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">Open-Meteo</a> · CC BY 4.0。气温与相对湿度为附近网格的 2 米天气模型值，当前条件基于 15 分钟时次；模型运行更新频率依提供方而异。页面请求频率与源数据时次分别显示。</p><p>现场资料依据提供者记录，天气值不填补现场缺失指标。超过 1 小时的记录不计入当前统计；地图显示离散点位，不插值连续温度场。图表不用于结构安全或文物病害判定。当前免费接口适用于非商业研究，商业接入按来源条款配置。</p><p>当前资料来源：{record?.source || "尚无资料"}。{selectedSite?.isDemo ? "点位坐标未经测绘确认，位置精度尚未提供。" : selectedSite?.recordSource}</p><p>数据时间：{timeText(record?.timestamp,true)}；降水聚合时段：{record?.interval ? record.interval + " 秒" : "未提供"}。观测文件和快照需单独备份，项目备份不包含环境资料。</p></div></details>
  </div>;
}
