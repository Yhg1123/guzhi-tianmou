import { useMemo, useState } from "react";
import { analyzeSites, distanceDistribution } from "./geodata.js";
import { demoSites, demoSource } from "./demoData.js";
import { HeritageMap } from "./HeritageMap.jsx";
import { DataImporter } from "./DataImporter.jsx";
import { distanceLabel, DistributionPanel, FactorMatrix } from "./AnalysisPanels.jsx";

function exportReport(site, sources, distribution) {
  const lines = [
    `古址天眸 · 遗址空间观察记录：${site.name}`,
    `生成时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    `位置：${site.location}`,
    `年代：${site.period}`,
    `类型：${site.type}`,
    `坐标（WGS84）：${site.lat.toFixed(5)}°N, ${site.lng.toFixed(5)}°E`,
    `遗址数据：${sources.sites.name}`,
    site.isDemo ? "点位状态：演示坐标，未经核验" : `记录来源：${site.recordSource}`,
    "",
    "已计算空间指标：",
    `距已导入水系最近距离：${distanceLabel(site.waterDistanceKm)}`,
    `水系图层：${sources.waterways.name}`,
    sources.waterways.sha256 ? `水系文件 SHA-256：${sources.waterways.sha256}` : "",
    `距已导入古道最近距离：${distanceLabel(site.routeDistanceKm)}`,
    `古道图层：${sources.routes.name}`,
    sources.routes.sha256 ? `古道文件 SHA-256：${sources.routes.sha256}` : "",
    sources.sites.sha256 ? `遗址文件 SHA-256：${sources.sites.sha256}` : "",
    distribution ? `当前筛选样本的近水距离中位数：${distribution.median.toFixed(2)} km（n=${distribution.count}）` : "当前没有可比较的近水距离样本。",
    "",
    "尚未计算：高程、坡度、可视域、洪涝与地质灾害风险、建设适宜性。",
    "本记录只描述导入数据中的几何关系；线要素不完整时，最近距离可能偏大。",
    "保护与建设决策须叠加经核验的遗址边界、保护范围和现场调查结果。",
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${site.name.replace(/[\\/:*?"<>|]/g, "_")}-空间观察记录.txt`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Inspector({ site, sources, count, index, distribution }) {
  const [tab, setTab] = useState("features");
  return (
    <aside className="inspector">
      <div className="inspector-card site-card">
        <div className="inspector-title"><h3>遗址记录</h3><span>{count ? `${index + 1} / ${count}` : "0 / 0"}</span></div>
        {site ? <>
          <div className="site-image" aria-label="考古场景示意影像"><span>考古场景示意图 · 非该遗址实拍</span></div>
          <h2>{site.name}</h2>
          <div className="tag-row"><span>{site.period}</span><span>{site.type}</span>{site.isDemo && <span>演示坐标</span>}</div>
          <ul className="site-meta">
            <li><i className="ri-map-pin-line" />{site.location}</li>
            <li><i className="ri-focus-3-line" />{site.lat.toFixed(5)}°N，{site.lng.toFixed(5)}°E</li>
            <li><i className="ri-database-2-line" />{site.isDemo ? demoSource : site.recordSource}</li>
          </ul>
          <div className="feature-tabs">
            {[["features", "关键特征"], ["sources", "数据来源"], ["method", "计算说明"]].map(([key, label]) => <button className={tab === key ? "active" : ""} type="button" key={key} onClick={() => setTab(key)}>{label}</button>)}
          </div>
          {tab === "features" && <div className="feature-grid">
            <span>距最近水系<strong>{distanceLabel(site.waterDistanceKm)}</strong></span>
            <span>距最近古道<strong>{distanceLabel(site.routeDistanceKm)}</strong></span>
            <span>高程<strong>待提供 DEM</strong></span>
            <span>地形坡度<strong>待提供 DEM</strong></span>
            <span>可视域<strong>待计算</strong></span>
            <span>风险区<strong>待叠加</strong></span>
          </div>}
          {tab === "sources" && <div className="feature-detail"><p>遗址：{sources.sites.name}</p><p>水系：{sources.waterways.name}</p><p>古道：{sources.routes.name}</p></div>}
          {tab === "method" && <div className="feature-detail"><p>使用 WGS84 经纬度，以地表最短距离计算点到导入线段的距离。</p><p>高程、坡度、可视域与风险尚未计算。</p></div>}
        </> : <div className="analysis-empty">没有符合当前筛选条件的遗址。</div>}
      </div>
      <div className="inspector-card explanation-card">
        <div className="score-line"><h3>观察与建议</h3><span>{site?.isDemo ? "演示数据" : "导入数据"}</span></div>
        <p>{site?.waterDistanceKm != null ? `${site.name}与当前水系图层的最近距离为 ${distanceLabel(site.waterDistanceKm)}。这反映已导入线要素的空间关系，不能单独判断历史水文或洪涝风险。` : "导入水系 GeoJSON 后，可计算遗址与已收录河流的最近距离，并比较当前样本的分布。"}</p>
        <div className="recommend-block"><div className="recommend-heading"><i className="ri-shield-check-line" /><strong>遗址保护</strong><span>需核验边界</span></div><ul><li>叠加正式遗址本体与保护范围，识别建设活动是否相交。</li><li>核对点位精度、记录年代与水系数据覆盖范围。</li></ul></div>
        <div className="recommend-block"><div className="recommend-heading"><i className="ri-compass-4-line" /><strong>现代建设研究</strong><span>待多因子分析</span></div><ul><li>补齐 DEM、坡度、现状土地利用和风险图层后，再评价候选地。</li><li>历史遗址的选址经验可作为研究线索，不能直接替代现行规划论证。</li></ul></div>
        <button className="primary-action" type="button" disabled={!site} onClick={() => exportReport(site, sources, distribution)}><i className="ri-file-download-line" />导出空间观察记录</button>
      </div>
    </aside>
  );
}

export function App() {
  const [siteRecords, setSiteRecords] = useState(demoSites);
  const [waterways, setWaterways] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [sources, setSources] = useState({
    sites: { name: demoSource, count: demoSites.length },
    waterways: { name: "未导入", count: 0 },
    routes: { name: "未导入", count: 0 },
  });
  const [selectedId, setSelectedId] = useState(demoSites[0].id);
  const [period, setPeriod] = useState("全部时期");
  const [type, setType] = useState("全部类型");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState("terrain");
  const [layers, setLayers] = useState({ points: true, waterways: true, routes: true });
  const [importOpen, setImportOpen] = useState(false);

  const sites = useMemo(() => analyzeSites(siteRecords, waterways, routes), [siteRecords, waterways, routes]);
  const periods = useMemo(() => ["全部时期", ...new Set(sites.map((site) => site.period))], [sites]);
  const types = useMemo(() => ["全部类型", ...new Set(sites.map((site) => site.type))], [sites]);
  const filteredSites = useMemo(() => sites.filter((site) =>
    (period === "全部时期" || site.period === period)
    && (type === "全部类型" || site.type === type)
    && (!search || `${site.name} ${site.location} ${site.period}`.toLowerCase().includes(search.toLowerCase()))
  ), [sites, period, type, search]);
  const selectedSite = filteredSites.find((site) => site.id === selectedId) || filteredSites[0] || null;
  const distribution = distanceDistribution(filteredSites);

  function handleImport(kind, parsed, fileName, metadata) {
    const nextSites = kind === "sites" ? parsed.features.length : siteRecords.length;
    const nextLines = (kind === "waterways" ? parsed.features.length : waterways.length)
      + (kind === "routes" ? parsed.features.length : routes.length);
    if (nextSites * nextLines > 250000) {
      throw new Error("当前浏览器试点版最多处理 25 万组点线比较。请按研究区裁剪图层后再导入。");
    }
    if (kind === "sites") {
      setSiteRecords(parsed.features);
      setSelectedId(parsed.features[0].id);
      setPeriod("全部时期");
      setType("全部类型");
      setSearch("");
    } else if (kind === "waterways") {
      setWaterways(parsed.features);
      setLayers((current) => ({ ...current, waterways: true }));
    } else {
      setRoutes(parsed.features);
      setLayers((current) => ({ ...current, routes: true }));
    }
    setSources((current) => ({ ...current, [kind]: { name: fileName, count: parsed.features.length, ...metadata } }));
  }

  function resetData() {
    setSiteRecords(demoSites);
    setWaterways([]);
    setRoutes([]);
    setSources({ sites: { name: demoSource, count: demoSites.length }, waterways: { name: "未导入", count: 0 }, routes: { name: "未导入", count: 0 } });
    setSelectedId(demoSites[0].id);
    setPeriod("全部时期");
    setType("全部类型");
    setSearch("");
    setMode("terrain");
  }

  return (
    <main className="prototype-shell">
      <aside className="nav-rail">
        <div className="brand"><div className="brand-mark"><i className="ri-ancient-gate-line" /></div><div><h1>古址天眸</h1><p>遗址空间研究</p></div></div>
        <nav aria-label="主导航">
          <button className="active" type="button"><i className="ri-dashboard-3-line" /><span>空间分析</span></button>
          <button type="button" onClick={() => setImportOpen(true)}><i className="ri-database-2-line" /><span>数据管理</span></button>
          <button type="button" disabled title="需要正式保护范围数据"><i className="ri-shield-check-line" /><span>保护评估</span></button>
          <button type="button" disabled title="需要多因子模型数据"><i className="ri-compass-discover-line" /><span>规划引导</span></button>
        </nav>
        <div className="rail-footer"><span>从可追溯数据出发</span><strong>观察遗址与环境的关系</strong></div>
      </aside>
      <section className="main-workspace">
        <header className="topbar">
          <div className="topbar-region"><span>研究区域</span><strong>{siteRecords[0]?.isDemo ? "关中平原试点" : "自定义研究区"}</strong></div>
          <label><span>时间时期</span><select value={period} onChange={(event) => setPeriod(event.target.value)}>{periods.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>遗址类型</span><select value={type} onChange={(event) => setType(event.target.value)}>{types.map((item) => <option key={item}>{item}</option>)}</select></label>
          <div className="sample-count"><span>当前样本</span><strong>{filteredSites.length} <small>处遗址</small></strong></div>
          <div className="search-box"><input aria-label="搜索遗址" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索遗址名称或地点" /><i className="ri-search-line" /></div>
          <button className="data-action" type="button" onClick={() => setImportOpen(true)}><i className="ri-upload-2-line" />导入数据</button>
        </header>
        <div className="content-grid">
          <section className="map-panel">
            <div className="map-panel-header">
              <div><h2>遗址与环境因子分析</h2><p>{siteRecords[0]?.isDemo ? "当前为演示点位，坐标未经核验" : `点位来源：${sources.sites.name}`} · 水系 {waterways.length} 条 · 古道 {routes.length} 条</p></div>
              <div className="mode-switch"><button className={mode === "terrain" ? "active" : ""} type="button" onClick={() => setMode("terrain")}>基础底图</button><button className={mode === "water" ? "active" : ""} type="button" disabled={!waterways.length} title={!waterways.length ? "先导入水系图层" : undefined} onClick={() => setMode("water")}>水系观察</button></div>
            </div>
            <div className="map-shell">
              <HeritageMap sites={filteredSites} selectedSite={selectedSite} waterways={waterways} routes={routes} mode={mode} layers={layers} onSelectSite={setSelectedId} />
              <div className="map-legend period-legend"><strong>图层标识</strong><span><b style={{ background: "#d39537" }} />演示点位</span><span><b style={{ background: "#c75a43" }} />导入点位</span><span><b style={{ background: "#2d8fa8" }} />导入水系</span></div>
              <div className="layer-control">
                {[["points", "遗址点位", "ri-map-pin-line"], ["waterways", "河流水系", "ri-water-flash-line"], ["routes", "古道线路", "ri-route-line"]].map(([key, label, icon]) => (
                  <label key={key}><span><i className={icon} />{label}</span><input type="checkbox" checked={layers[key]} onChange={(event) => setLayers((current) => ({ ...current, [key]: event.target.checked }))} /></label>
                ))}
              </div>
              {!waterways.length && <button className="map-data-prompt" type="button" onClick={() => setImportOpen(true)}>导入水系图层以计算最近河流距离 <i className="ri-arrow-right-line" /></button>}
            </div>
          </section>
          <Inspector site={selectedSite} sources={sources} count={filteredSites.length} index={filteredSites.findIndex((item) => item.id === selectedSite?.id)} distribution={distribution} />
          <div className="lower-grid"><FactorMatrix site={selectedSite} sources={sources} /><DistributionPanel sites={filteredSites} onSelectSite={setSelectedId} /></div>
        </div>
      </section>
      {importOpen && <DataImporter sources={sources} onImport={handleImport} onReset={resetData} onClose={() => setImportOpen(false)} />}
    </main>
  );
}
