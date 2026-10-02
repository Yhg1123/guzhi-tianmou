import { useState } from "react";
import { distanceDistribution } from "./geodata.js";

export function distanceLabel(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} km` : "待导入图层";
}

export function FactorMatrix({ site, sources }) {
  const rows = [
    { icon: "ri-water-percent-line", name: "距最近水系", value: site ? distanceLabel(site.waterDistanceKm) : "—", source: sources.waterways.name, ready: Number.isFinite(site?.waterDistanceKm) },
    { icon: "ri-route-line", name: "距最近古道", value: site ? distanceLabel(site.routeDistanceKm) : "—", source: sources.routes.name, ready: Number.isFinite(site?.routeDistanceKm) },
    { icon: "ri-landscape-line", name: "高程与坡度", value: "待计算", source: "需要 DEM 栅格", ready: false },
    { icon: "ri-eye-line", name: "可视域", value: "待计算", source: "需要 DEM 与观察点", ready: false },
    { icon: "ri-shield-check-line", name: "保护范围", value: "待叠加", source: "需要正式保护边界", ready: false },
  ];
  return (
    <section className="analysis-card factor-matrix">
      <div className="section-title"><div><h3>空间因子计算</h3><p>依据当前导入图层，逐项显示可计算结果</p></div></div>
      <div className="matrix-table">
        <div className="matrix-head"><span>因子</span><span>当前遗址</span><span>数据来源</span></div>
        {rows.map((row) => (
          <div className="matrix-row" key={row.name}>
            <span><i className={row.icon} />{row.name}</span>
            <strong className={row.ready ? "measured" : "pending"}>{row.value}</strong>
            <small title={row.source}>{row.source}</small>
          </div>
        ))}
      </div>
      <p className="matrix-note">距离按点到导入线段的最短地表距离计算；图层缺失时不估算。</p>
    </section>
  );
}

export function DistributionPanel({ sites, onSelectSite }) {
  const [metric, setMetric] = useState("waterDistanceKm");
  const distribution = distanceDistribution(sites, metric);
  const title = metric === "waterDistanceKm" ? "距水系" : "距古道";
  const max = Math.max(1, ...((distribution?.bins || []).map((bin) => bin.count)));
  return (
    <section className="analysis-card curve-card">
      <div className="section-title"><div><h3>样本距离分布</h3><p>当前筛选遗址的已计算结果</p></div>{distribution && <span className="confidence-pill">n={distribution.count}</span>}</div>
      <div className="curve-tabs distance-tabs">
        <button className={metric === "waterDistanceKm" ? "active" : ""} type="button" onClick={() => setMetric("waterDistanceKm")}>距水系</button>
        <button className={metric === "routeDistanceKm" ? "active" : ""} type="button" onClick={() => setMetric("routeDistanceKm")}>距古道</button>
      </div>
      {distribution ? (
        <div className="distance-chart" aria-label={`${title}距离分布图`}>
          <div className="chart-summary">中位数 <strong>{distribution.median.toFixed(2)} km</strong><span>最小 {distribution.minimum.toFixed(2)} km · 最大 {distribution.maximum.toFixed(2)} km</span></div>
          <div className="histogram">
            {distribution.bins.map((bin) => <div className="histogram-bin" key={bin.label}><span>{bin.count}</span><div className="histogram-bar" style={{ height: `${Math.max(4, bin.count / max * 100)}%` }} /><small>{bin.label} km</small></div>)}
          </div>
        </div>
      ) : <div className="analysis-empty">导入{metric === "waterDistanceKm" ? "水系" : "古道"}图层后，会按现有遗址点位计算并显示分布。</div>}
      <div className="table-heading"><h4>样本记录</h4><span>{sites.length} 处</span></div>
      <div className="comparison-list">
        {sites.slice(0, 5).map((site) => (
          <button className="comparison-grid" type="button" key={site.id} onClick={() => onSelectSite(site.id)}>
            <strong>{site.name}</strong><span>{site.period}</span><span>{distanceLabel(site[metric])}</span>
          </button>
        ))}
        {!sites.length && <p className="empty-inline">没有符合当前筛选条件的遗址。</p>}
      </div>
    </section>
  );
}
