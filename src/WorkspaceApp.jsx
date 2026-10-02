import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { get, set } from "idb-keyval";
import { Map, Landmark, Database, ChartNoAxesCombined, ShieldCheck, Box, Search, Upload, ChevronRight, ArrowUpRight, MapPin, Layers, Menu, X, Check, CircleAlert, Download, ExternalLink } from "lucide-react";
import { HeritageMap } from "./HeritageMap.jsx";
import { analyzeSites, assertWorkload, historicalDistance } from "./geodata.js";
import { emptyProject, fmt, download, asGeoJson } from "./project.js";
import { DataCenter } from "./DataCenter.jsx";
import { ResearchView } from "./ResearchView.jsx";
import { ProtectionView } from "./ProtectionView.jsx";

const ReconstructionView = lazy(() => import("./ReconstructionView.jsx"));
const NAV = [
  { id: "map", name: "遗址地图", icon: Map, group: "空间研究" },
  { id: "sites", name: "遗址档案", icon: Landmark },
  { id: "research", name: "选址研究", icon: ChartNoAxesCombined },
  { id: "protection", name: "保护评估", icon: ShieldCheck, group: "保护与记录" },
  { id: "reconstruction", name: "三维档案", icon: Box },
  { id: "data", name: "数据中心", icon: Database, group: "项目" },
];
const STORAGE_KEY = "heritage-project-v2";
function hashPage() { const hash = window.location.hash.slice(1); return NAV.some((n) => n.id === hash) ? hash : "map"; }

function SiteDetail({ site, onResearch, onReconstruct }) {
  if (!site) return <div className="empty-inline">没有匹配的遗址</div>;
  return <div className="site-detail"><div className="detail-photo"><img src="/assets/archaeology-aerial.png" alt="考古场景示意，非当前遗址实拍" /><span>示意影像 · 非遗址实拍</span></div><div className="detail-content"><span className={`badge ${site.isDemo ? "amber" : "green"}`}>{site.isDemo ? "演示点位 · 未核验" : "已导入点位"}</span><h2>{site.name.replace("（演示）", "")}</h2><p className="muted">{site.period} <span className="dot-separator">·</span> {site.type}</p><div className="location-line"><MapPin size={14} />{site.location}</div><div className="coordinate">{site.lng.toFixed(5)}° E / {site.lat.toFixed(5)}° N</div><dl className="detail-metrics"><div><dt>已导入水系距离</dt><dd>{fmt(site.waterDistanceKm, " km")}</dd></div><div><dt>地表高程</dt><dd>{fmt(site.elevation_m, " m")}</dd></div><div><dt>地形坡度</dt><dd>{fmt(site.slope_deg, "°")}</dd></div><div><dt>坐标精度</dt><dd>{fmt(site.precision_m, " m")}</dd></div></dl><div className="detail-actions"><button className="button primary" onClick={onResearch}>选址研究 <ArrowUpRight size={15} /></button><button className="button" onClick={onReconstruct}><Box size={16} />三维档案</button></div></div></div>;
}

function MapView({ sites, selectedSite, datasets, layers, setLayers, onSelectSite, navigate }) {
  const [showLayers, setShowLayers] = useState(true);
  return <div className="map-workspace"><div className="map-view-heading"><div><span className="eyebrow">SPATIAL ATLAS</span><h1>遗址地图</h1></div><div className="map-overview-counts"><span><strong>{sites.length}</strong> 处遗址</span><span><strong>{datasets.waterways.length + datasets.routes.length + datasets.boundaries.length + datasets.hazards.length}</strong> 个环境要素</span></div></div><div className="atlas-grid"><section className="atlas-map" aria-label="研究区地图"><HeritageMap sites={sites} selectedSite={selectedSite} waterways={datasets.waterways} routes={datasets.routes} boundaries={datasets.boundaries} hazards={datasets.hazards} layers={layers} onSelectSite={onSelectSite} /><div className="map-layer-panel"><button className="layer-title" aria-expanded={showLayers} onClick={() => setShowLayers(!showLayers)}><Layers size={16} />图层<ChevronRight className={showLayers ? "rotate" : ""} size={15} /></button>{showLayers && <div className="layer-list">{[["points", "遗址点位", sites.length], ["waterways", "河流水系", datasets.waterways.length], ["routes", "交通线路", datasets.routes.length], ["boundaries", "保护范围", datasets.boundaries.length], ["hazards", "影响区域", datasets.hazards.length]].map(([id, title, count]) => <label key={id}><input type="checkbox" checked={layers[id]} onChange={(e) => setLayers({ ...layers, [id]: e.target.checked })} /><span>{title}</span><small>{count}</small></label>)}<button className="text-button" onClick={() => navigate("data")}>管理图层 <ArrowUpRight size={13} /></button></div>}</div><div className="map-caption"><span className="status-dot" />WGS84 <span className="caption-divider" />{sites.some((s) => s.isDemo) ? "含未经核验的演示点位" : "已导入遗址点位"}</div></section><aside className="atlas-inspector"><div className="inspector-heading"><h2>遗址记录</h2><button className="text-button" onClick={() => navigate("sites")}>全部 <ArrowUpRight size={14} /></button></div><select className="site-select" aria-label="地图当前遗址" value={selectedSite?.id || ""} onChange={(e) => onSelectSite(e.target.value)}>{sites.map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}</select><SiteDetail site={selectedSite} onResearch={() => navigate("research")} onReconstruct={() => navigate("reconstruction")} /></aside></div></div>;
}

function SitesView({ sites, selectedSite, onSelectSite, navigate }) {
  return <div className="page-scroll"><div className="page-title"><div><span className="eyebrow">HERITAGE INVENTORY</span><h1>遗址档案</h1></div><button className="button" onClick={() => download("遗址点位.geojson", { ...asGeoJson("sites", sites), description: sites.some((s) => s.isDemo) ? "包含未经核验的演示点位，不能作为科研数据" : "用户导入点位" })}><Download size={16} />导出点位</button></div><div className="inventory-layout"><section><div className="section-heading"><h2>遗址名录 <span className="count-tag">{sites.length}</span></h2></div><div className="table-scroll"><table><thead><tr><th>遗址名称</th><th>时期 / 类型</th><th>地点</th><th>状态</th></tr></thead><tbody>{sites.map((s) => <tr key={s.id} className={selectedSite?.id === s.id ? "selected-row" : ""}><td><button className="table-link" onClick={() => onSelectSite(s.id)}>{s.name.replace("（演示）", "")}</button></td><td>{s.period}<small>{s.type}</small></td><td>{s.location}</td><td><span className={`badge ${s.isDemo ? "amber" : "green"}`}>{s.isDemo ? "演示" : "已导入"}</span></td></tr>)}</tbody></table>{!sites.length && <p className="empty-inline">没有匹配的遗址记录</p>}</div></section><aside className="inventory-detail"><SiteDetail site={selectedSite} onResearch={() => navigate("research")} onReconstruct={() => navigate("reconstruction")} /><button className="text-button inventory-map-link" onClick={() => navigate("map")}><Map size={15} />在地图中查看</button></aside></div></div>;
}

export function App() {
  const [project, setProject] = useState(emptyProject);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState("读取本地项目…");
  const [page, setPage] = useState(hashPage);
  const [selectedId, setSelectedId] = useState("");
  const [period, setPeriod] = useState("all");
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [radius, setRadius] = useState(500);
  const [layers, setLayers] = useState({ points: true, waterways: true, routes: true, boundaries: true, hazards: true });
  useEffect(() => { let alive = true; get(STORAGE_KEY).then((saved) => { if (alive && saved?.schema === 2) setProject(saved); }).catch(() => { if (alive) setSaveStatus("本地存储不可用，请备份项目"); }).finally(() => { if (alive) setReady(true); }); return () => { alive = false; }; }, []);
  useEffect(() => {
    if (!ready) return undefined;
    let current = true;
    setSaveStatus("保存中…");
    set(STORAGE_KEY, project).then(() => { if (current) setSaveStatus("已保存到此设备"); }).catch(() => { if (current) setSaveStatus("保存失败，请备份项目"); });
    return () => { current = false; };
  }, [project, ready]);
  useEffect(() => { const change = () => setPage(hashPage()); window.addEventListener("hashchange", change); return () => window.removeEventListener("hashchange", change); }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [page]);
  const navigate = useCallback((id) => { window.location.hash = id; setPage(id); setMobileNav(false); }, []);
  const onSelectSite = useCallback((id) => setSelectedId(id), []);
  const allSites = useMemo(() => analyzeSites(project.datasets.sites, project.datasets.waterways, project.datasets.routes).map((site) => ({ ...site, historicWaterKm: historicalDistance(site, project.datasets.waterways, project.sources.waterways), historicRouteKm: historicalDistance(site, project.datasets.routes, project.sources.routes) })), [project.datasets, project.sources]);
  const sites = useMemo(() => allSites.filter((site) => (period === "all" || site.period === period) && (type === "all" || site.type === type) && `${site.name} ${site.location}`.toLowerCase().includes(search.toLowerCase().trim())), [allSites, period, type, search]);
  const selectedSite = sites.find((s) => s.id === selectedId) || sites[0] || null;
  const periods = [...new Set(allSites.map((s) => s.period))];
  const types = [...new Set(allSites.map((s) => s.type))];
  const resetFilters = () => { setPeriod("all"); setType("all"); setSearch(""); };
  const onImport = (kind, features, source) => {
    const datasets = { ...project.datasets, [kind]: features };
    assertWorkload(datasets.sites, datasets.waterways, datasets.routes, [...datasets.boundaries, ...datasets.hazards]);
    setProject((current) => ({ ...current, datasets, notes: kind === "sites" ? {} : current.notes, sources: { ...current.sources, [kind]: source } }));
    if (kind === "sites") { setSelectedId(features[0]?.id || ""); resetFilters(); }
  };
  const metadata = (kind, values) => setProject((current) => ({ ...current, sources: { ...current.sources, [kind]: { ...current.sources[kind], ...values } } }));
  const restore = (next) => { setProject(next); setSelectedId(""); resetFilters(); };
  const currentNav = NAV.find((n) => n.id === page);
  const isFilteredPage = !["data", "reconstruction"].includes(page);
  return <div className="app-shell"><a className="skip-link" href="#main-content" onClick={(e) => { e.preventDefault(); document.getElementById("main-content")?.focus(); }}>跳转到主要内容</a>{mobileNav && <button className="nav-scrim" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}><a className="brand" href="#map" onClick={() => setMobileNav(false)}><div className="brand-symbol"><Landmark size={24} /></div><span><strong>古址天眸</strong><small>HERITAGE ATLAS</small></span></a><div className="project-label"><span className="status-dot" /><span>古遗址空间研究</span></div><nav aria-label="主导航">{NAV.map(({ id, name, icon: Icon, group }) => <div key={id}>{group && <span className="nav-group">{group}</span>}<a href={`#${id}`} title={name} className={`nav-item ${page === id ? "active" : ""}`} aria-current={page === id ? "page" : undefined} onClick={() => setMobileNav(false)}><Icon size={19} /><span>{name}</span>{id === "sites" && <small>{allSites.length}</small>}</a></div>)}</nav><div className="sidebar-bottom"><span className="local-avatar">研</span><div><strong>本地研究项目</strong><small>工作空间 / 01</small></div></div></aside>
    <div className="main-shell"><header className="app-header"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="展开导航" onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X size={20} /> : <Menu size={20} />}</button><span>工作空间</span><ChevronRight size={14} /><strong>{currentNav.name}</strong></div><div className="header-actions"><span className="save-status"><Check size={13} />{saveStatus}</span><button className="button primary" onClick={() => navigate("data")}><Upload size={15} /><span>导入数据</span></button></div></header>
      {isFilteredPage && <div className="filter-toolbar"><label className="search-field"><Search size={16} /><input aria-label="搜索遗址" placeholder="搜索遗址名称或地点" value={search} onChange={(e) => setSearch(e.target.value)} /></label><label><span>时期</span><select aria-label="时间时期" value={period} onChange={(e) => setPeriod(e.target.value)}><option value="all">全部时期</option>{periods.map((p) => <option key={p}>{p}</option>)}</select></label><label><span>类型</span><select aria-label="遗址类型" value={type} onChange={(e) => setType(e.target.value)}><option value="all">全部类型</option>{types.map((t) => <option key={t}>{t}</option>)}</select></label>{(search || period !== "all" || type !== "all") && <button className="text-button" onClick={resetFilters}>清除筛选 <X size={13} /></button>}<span className="filter-summary">{sites.length} 处遗址</span></div>}
      <main id="main-content" className={`main-content page-${page}`} tabIndex={-1}>{!ready ? <div className="empty-inline">正在读取本地项目…</div> : <>
        {page === "map" && <MapView sites={sites} selectedSite={selectedSite} datasets={project.datasets} layers={layers} setLayers={setLayers} onSelectSite={onSelectSite} navigate={navigate} />}
        {page === "sites" && <SitesView sites={sites} selectedSite={selectedSite} onSelectSite={onSelectSite} navigate={navigate} />}
        {page === "research" && <ResearchView sites={sites} sources={project.sources} onData={() => navigate("data")} onSelectSite={(id) => { setSelectedId(id); navigate("sites"); }} />}
        {page === "protection" && <ProtectionView sites={sites} selectedSite={selectedSite} project={project} onSelectSite={onSelectSite} radius={radius} setRadius={setRadius} onData={() => navigate("data")} onNote={(id, note) => setProject((p) => ({ ...p, notes: { ...p.notes, [id]: note } }))} />}
        {page === "reconstruction" && <Suspense fallback={<div className="empty-inline">加载三维工作区…</div>}><ReconstructionView sites={allSites} selectedId={selectedId || selectedSite?.id} onSelectSite={onSelectSite} /></Suspense>}
        {page === "data" && <DataCenter project={project} saveStatus={saveStatus} onImport={onImport} onMetadata={metadata} onRestore={restore} onReset={() => restore(emptyProject())} />}
      </>}</main><footer className="app-footer"><span><CircleAlert size={12} />研究辅助 · 不替代考古与规划论证</span><a href="https://github.com/archesproject/arches" target="_blank" rel="noreferrer">开源遗产 GIS 参考 <ExternalLink size={11} /></a></footer>
    </div></div>;
}
