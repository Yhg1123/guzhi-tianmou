import seem from "./trainedGaussianCatalog.json" with { type: "json" };

export const trainedGaussianCases = [
  {
    id: "lingyue", kind: "gaussian", representation: "trained-3dgs", delivery: "online",
    title: "北京灵岳寺", subtitle: "中国 · 北京门头沟 · 古寺实景",
    credit: "roblinka / SuperSplat", sourceUrl: "https://superspl.at/scene/073bac93",
    embedUrl: "https://superspl.at/s?id=073bac93", pointCountLabel: "约 660 万",
    bytes: 75673627, license: "来源平台公开浏览；文件未开放下载",
    heritageSourceUrl: "https://wwj.beijing.gov.cn/bjww/362771/362779/dqpqgzdwwbhdw/523508/index.html",
    description: "灵岳寺古建筑与院落的三维高斯实景，由作者使用 XGRIDS L2 Pro 采集并发布。通过来源平台提供的嵌入查看器浏览，模型文件未复制到本站。",
    captureDate: null, trainedInThisApp: false, metricScaleVerified: false, georeferenced: false,
  },
  { ...seem, camera: { ...seem.camera, fov: 75 }, delivery: "local", pointCountLabel: seem.pointCount.toLocaleString("en-US") },
];

export function gaussianCaseId(hash) {
  const [page, query = ""] = String(hash).replace(/^#/, "").split("?");
  return page === "reconstruction" ? new URLSearchParams(query).get("case") || "" : "";
}

export function gaussianCaseRoute(id, siteId) {
  const query = new URLSearchParams({ case: String(id) });
  if (siteId != null) query.set("site", String(siteId));
  return "reconstruction?" + query;
}
