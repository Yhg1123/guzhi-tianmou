// Keep original names and provenance in storage/exports; simplify display names only.
export function siteName(site) {
  return String(typeof site === "string" ? site : site?.name || "未选择遗址")
    .replace(/[（(](?:演示|模拟|公开参考点|影像参考点)[）)]/g, "").trim();
}
export function sourceLabel(source) {
  return String(source || "来源未填写").replace("内置界面演示记录（点位未经核验）", "初始遗址档案 · 坐标精度未提供");
}
