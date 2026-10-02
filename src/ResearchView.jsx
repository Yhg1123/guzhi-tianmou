import { useMemo, useState } from "react";
import { ArrowUpRight, ChevronRight, Download, Mountain, Waves, Route, ScanEye, FlaskConical, Info } from "lucide-react";
import { FACTORS, fmt, download } from "./project.js";
import { summarize, barPosition } from "./statistics.js";

const THEMES = [{ id: "settlement", name: "聚落与生计" }, { id: "defense", name: "防御与通达" }, { id: "ritual", name: "礼制与景观" }];
const icons = { historicWaterKm: Waves, historicRouteKm: Route, viewshed: ScanEye };

export function ResearchView({ sites, sources, onData, onSelectSite }) {
  const [theme, setTheme] = useState("settlement");
  const [metric, setMetric] = useState("historicWaterKm");
  const [groupBy, setGroupBy] = useState("period");
  const factors = FACTORS.filter((factor) => factor.themes.includes(theme));
  const selected = factors.find((f) => f.id === metric) || factors[0];
  const stats = summarize(sites.map((s) => s[selected.id]));
  const groups = useMemo(() => [...new Set(sites.map((s) => s[groupBy]))].map((name) => ({ name, total: sites.filter((s) => s[groupBy] === name).length, stats: summarize(sites.filter((s) => s[groupBy] === name).map((s) => s[selected.id])) })), [sites, groupBy, selected.id]);
  const ready = factors.filter((factor) => sites.some((s) => Number.isFinite(s[factor.id]))).length;
  return <div className="page-scroll">
    <div className="page-title"><div><span className="eyebrow">LOCATION RESEARCH</span><h1>选址研究</h1></div><button className="button" onClick={() => download("选址研究-观察记录.json", { generatedAt: new Date().toISOString(), theme, sources, selectedMetric: selected, statistics: stats, groups, sites, limitations: ["描述性统计，不证明因果关系", "无对照样本，不代表选址偏好", "历史图层须与遗址分期匹配", "演示坐标不可用于科研结论"] })}><Download size={16} />导出观察记录</button></div>
    <div className="research-context"><FlaskConical size={22} /><div><strong>研究问题</strong><span>不同类型、不同分期的遗址，呈现怎样的空间分布？</span></div><span className="badge amber">描述性分析</span></div>
    <div className="section-heading"><div className="tabs" role="tablist" aria-label="研究主题">{THEMES.map((t) => <button role="tab" aria-selected={theme === t.id} key={t.id} onClick={() => setTheme(t.id)}>{t.name}</button>)}</div><span className="muted">{ready} / {factors.length} 项已有数据</span></div>
    <div className="research-layout"><aside className="factor-picker" aria-label="环境因子">{factors.map((factor) => { const Icon = icons[factor.id] || Mountain; const count = sites.filter((s) => Number.isFinite(s[factor.id])).length; return <button className={`factor-item ${selected.id === factor.id ? "active" : ""}`} key={factor.id} onClick={() => setMetric(factor.id)}><Icon size={19} /><span><strong>{factor.title}</strong><small>{factor.group}</small></span><span className={`badge ${count ? "green" : "gray"}`}>{count ? `${count} 处` : "缺数据"}</span><ChevronRight size={15} /></button>; })}</aside>
      <section className="analysis-detail"><div className="section-heading"><div><span className="eyebrow">{selected.group}</span><h2>{selected.title}</h2></div><span className="badge gray">{selected.unit || "未计算"}</span></div>
        <div className="metric-row"><div><span>有效样本</span><strong>{stats?.count || 0}<small> / {sites.length}</small></strong></div><div><span>中位数</span><strong>{stats ? fmt(stats.median) : "—"}<small>{selected.unit}</small></strong></div><div><span>观测范围</span><strong className="range-metric">{stats ? `${fmt(stats.min)} ~ ${fmt(stats.max)}` : "—"}</strong></div></div>
        <div className="chart-heading"><h3>分组对比</h3><select aria-label="样本分组" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}><option value="period">按时期</option><option value="type">按遗址类型</option></select></div>
        {stats ? <div className="comparison-chart">{groups.map((g) => { const bar = barPosition(g.stats?.median, stats); return <div className="comparison-row" key={g.name}><span>{g.name}</span><div className="bar-track"><i style={{ left: `${bar.zero}%` }} /><div style={{ left: `${bar.left}%`, width: `${bar.width}%` }} /></div><strong>{g.stats ? fmt(g.stats.median, selected.unit) : "缺失"}</strong><small>n={g.stats?.count || 0}</small></div>; })}</div> : <div className="analysis-empty"><Mountain size={36} strokeWidth={1.2} /><h3>尚无可比较的观测值</h3><p>{selected.requirement}</p><button className="text-button" onClick={onData}>前往数据中心 <ArrowUpRight size={15} /></button></div>}
        <div className="method-note"><Info size={17} /><div><strong>{selected.method}</strong><p>{selected.caution}</p></div></div>
      </section></div>
    <section className="section"><div className="section-heading"><h2>样本观测表</h2><span className="muted">缺失值不按 0 计入</span></div><div className="table-scroll"><table><thead><tr><th>遗址</th><th>时期</th><th>类型</th><th>{selected.title}{selected.unit && ` (${selected.unit})`}</th><th>数据状态</th></tr></thead><tbody>{sites.map((site) => <tr key={site.id}><td><button className="table-link" onClick={() => onSelectSite(site.id)}>{site.name}</button></td><td>{site.period}</td><td>{site.type}</td><td className="numeric">{fmt(site[selected.id])}</td><td><span className={`badge ${site.isDemo ? "amber" : "gray"}`}>{site.isDemo ? "演示点位" : Number.isFinite(site[selected.id]) ? "已有观测值" : "数据不足"}</span></td></tr>)}</tbody></table>{!sites.length && <p className="empty-inline">当前筛选下没有遗址</p>}</div></section>
    <div className="research-limit"><Info size={18} /><p>古遗址样本受保存、发现与调查范围影响。分布规律需要同期环境、对照样本和考古文献共同检验，不能直接转为现代建筑选址评分。</p></div>
  </div>;
}
