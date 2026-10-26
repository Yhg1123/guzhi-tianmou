import { siteName } from "./presentation.js";

export const MARKER_SIZE = [44, 52];
export const MARKER_ANCHOR = [22, 50];

export function heritageMarker(site, selectedId, openModel = false) {
  return { ...site, active: site.id === selectedId, kind: "heritage", label: siteName(site), title: siteName(site), actionLabel: openModel ? "打开三维档案" : "", caption: openModel ? "查看三维档案 ↗" : site.id === selectedId ? "当前遗址" : site.type || "遗址档案" };
}

const SVG_NS = "http://www.w3.org/2000/svg";
const SYMBOLS = {
  heritage: ["M10 14l8-4 8 4H10Z", "M11 17h14M13 19v6m5-6v6m5-6v6M10 28h16"],
  temperature: ["M16 21V11a2 2 0 0 1 4 0v10a4.5 4.5 0 1 1-4 0Z", "M18 14v11"],
  humidity: ["M18 9s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11Z", "M15 21a3 3 0 0 0 3 3"],
};

function svgPath(data, className) {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", data);
  if (className) path.setAttribute("class", className);
  return path;
}

// Shared DOM for both map engines. User-supplied names are always text nodes.
export function createMapMarker(point, onSelect) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "map-marker" + (point.active ? " active" : "") + (point.kind && point.kind !== "heritage" ? " observation-marker" : "");
  button.title = point.label;
  button.setAttribute("aria-label", point.label);
  button.setAttribute("aria-pressed", String(Boolean(point.active)));
  if (point.actionLabel) { button.title += " · " + point.actionLabel; button.setAttribute("aria-description", point.actionLabel); }
  if (point.color) button.style.setProperty("--observation-color", point.color);

  const foot = document.createElement("i"); foot.className = "map-marker-foot";
  const pin = document.createElementNS(SVG_NS, "svg");
  pin.setAttribute("viewBox", "0 0 36 46"); pin.setAttribute("aria-hidden", "true"); pin.setAttribute("class", "map-marker-pin");
  pin.append(svgPath("M18 44C15 39 3 29 3 18a15 15 0 0 1 30 0c0 11-12 21-15 26Z", "map-marker-shell"));
  const symbol = document.createElementNS(SVG_NS, "g"); symbol.setAttribute("class", "map-marker-symbol");
  for (const data of SYMBOLS[point.kind] || SYMBOLS.heritage) symbol.append(svgPath(data));
  pin.append(symbol);

  const label = document.createElement("span"); label.className = "map-marker-label";
  const caption = document.createElement("small"); caption.textContent = point.caption || (point.active ? "当前遗址" : "遗址档案");
  const title = document.createElement("strong"); title.textContent = point.title || point.label;
  label.append(caption, title);
  button.append(foot, pin, label);
  button.onclick = (event) => { event.preventDefault(); event.stopPropagation(); onSelect(point.id); };
  return button;
}

export function placeMarkerLabel(element, x, y, width, host = element) {
  const left = x - 28, right = width - x - 28;
  const atlas = element.classList.contains("active") ? host.closest(".atlas-map") : null;
  const panel = atlas?.querySelector(".map-layer-panel");
  const mapBounds = atlas?.getBoundingClientRect();
  const panelBounds = panel?.getBoundingClientRect();
  const blocked = panelBounds && y + 5 > panelBounds.top - mapBounds.top && y - 45 < panelBounds.bottom - mapBounds.top && x + 220 > panelBounds.left - mapBounds.left;
  const useLeft = left > 80 && (blocked || right < 185 && left > right);
  element.classList.toggle("label-left", Boolean(useLeft));
  element.classList.toggle("label-below", y < 56);
  element.style.setProperty("--marker-label-max", Math.max(80, Math.min(210, (useLeft ? left : right) - 10)) + "px");
}
