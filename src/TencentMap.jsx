import { useEffect, useRef, useState } from "react";
import { Scan } from "lucide-react";
import { displayPosition, displayPaths } from "./mapCoordinates.js";

const key = import.meta.env.VITE_TENCENT_MAP_KEY?.trim();
export const hasTencentMap = Boolean(key);
export const defaultMapProvider = hasTencentMap && import.meta.env.VITE_MAP_PROVIDER === "tencent" ? "tencent" : "osm";
let sdkPromise;
let loadNumber = 0;
const EMPTY = [];

function loadSdk() {
  if (window.TMap?.Map) return Promise.resolve(window.TMap);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const callback = "__heritageTencentMap" + ++loadNumber;
    const finish = (issue) => {
      clearTimeout(timer);
      script.onerror = null;
      if (issue) {
        script.remove();
        // A late response must not call an absent callback.
        window[callback] = () => {};
        reject(issue);
      } else {
        delete window[callback];
        resolve(window.TMap);
      }
    };
    const timer = setTimeout(() => finish(new Error("腾讯地图连接超时")), 20000);
    window[callback] = () => finish(window.TMap?.Map ? null : new Error("腾讯地图未就绪"));
    script.onerror = () => finish(new Error("腾讯地图连接失败"));
    script.src = "https://map.qq.com/api/gljs?v=1.exp&key=" + encodeURIComponent(key) + "&callback=" + callback;
    script.async = true;
    document.head.appendChild(script);
  }).catch((issue) => { sdkPromise = null; throw issue; });
  return sdkPromise;
}

export function MapProviderSelect({ value, onChange }) {
  return <label className="map-provider-select" title="项目原始坐标为 WGS84；腾讯底图使用 GCJ-02，仅显示时近似转换，不用于测绘。"><span>底图</span><select aria-label="底图服务" value={value} onChange={(event) => onChange(event.target.value)}><option value="osm">OpenStreetMap</option><option value="tencent" disabled={!hasTencentMap}>腾讯地图</option></select></label>;
}

function position(TMap, coordinates) {
  const [lng, lat] = displayPosition(coordinates);
  return new TMap.LatLng(lat, lng);
}
function paths(TMap, coordinates) {
  const converted = displayPaths(coordinates);
  const wrap = (part) => typeof part[0] === "number" ? new TMap.LatLng(part[1], part[0]) : part.map(wrap);
  return wrap(converted);
}
function fit(map, TMap, points, maxZoom = 13) {
  if (!points.length) return;
  const coordinates = points.map((point) => position(TMap, [point.lng, point.lat]));
  const bounds = new TMap.LatLngBounds(coordinates[0], coordinates[0]);
  coordinates.forEach((coordinate) => bounds.extend(coordinate));
  map.fitBounds(bounds, { padding: 55, maxZoom, duration: 0 });
}

function pointOverlay(TMap) {
  return class extends TMap.DOMOverlay {
    onInit(options) { this.point = options.point; this.choose = options.choose; this.position = position(TMap, [this.point.lng, this.point.lat]); }
    createDOM() {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tencent-map-point" + (this.point.active ? " active" : "");
      button.style.setProperty("--point-color", this.point.color);
      button.title = this.point.label;
      button.setAttribute("aria-label", this.point.label);
      button.setAttribute("aria-pressed", String(Boolean(this.point.active)));
      const dot = document.createElement("i");
      const label = document.createElement("span"); label.textContent = this.point.label;
      button.append(dot, label);
      this.click = (event) => { event.stopPropagation(); this.choose(this.point.id); };
      button.addEventListener("click", this.click);
      this.element = button;
      return button;
    }
    updateDOM() {
      const pixel = this.getMap().projectToContainer(this.position);
      this.element.style.transform = `translate(${pixel.getX()}px, ${pixel.getY()}px)`;
      this.element.style.zIndex = this.point.active ? "2" : "1";
    }
    onDestroy() { this.element?.removeEventListener("click", this.click); }
  };
}

// All incoming coordinates are WGS84; conversion is confined to this renderer.
export function TencentMap({ points, locations = points, lines = EMPTY, polygons = EMPTY, center, zoom = 10, fitLocations = false, scrollable = true, onSelect, onUnavailable, label = "腾讯地图与项目图层" }) {
  const host = useRef(null); const instance = useRef(null); const latest = useRef(null);
  latest.current = { locations, center, onUnavailable };
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true; let map; let timer;
    setReady(false); setLoaded(false);
    loadSdk().then((TMap) => {
      if (!alive) return;
      const initial = latest.current.center || latest.current.locations[0] || { lng: 108.95, lat: 34.31 };
      map = new TMap.Map(host.current, { center: position(TMap, [initial.lng, initial.lat]), zoom, minZoom: 3, maxZoom: 18, viewMode: "2D", scrollable });
      map.removeControl(TMap.constants.DEFAULT_CONTROL_ID.ROTATION);
      map.getControl(TMap.constants.DEFAULT_CONTROL_ID.ZOOM).setPosition(TMap.constants.CONTROL_POSITION.BOTTOM_RIGHT);
      instance.current = map;
      const tilesReady = () => { clearTimeout(timer); if (alive) setLoaded(true); };
      map.on("tilesloaded", tilesReady);
      map.on("context_lost", () => { if (alive) latest.current.onUnavailable(); });
      timer = setTimeout(() => { if (alive) latest.current.onUnavailable(); }, 25000);
      if (fitLocations) fit(map, TMap, latest.current.locations, 10);
      setReady(true);
    }).catch(() => { if (alive) latest.current.onUnavailable(); });
    return () => { alive = false; clearTimeout(timer); instance.current = null; map?.destroy(); };
  }, []);

  useEffect(() => {
    if (!ready || !instance.current) return undefined;
    const TMap = window.TMap; const map = instance.current; const overlays = [];
    if (lines.length) {
      const styles = Object.fromEntries(lines.map((line, index) => ["line-" + index, new TMap.PolylineStyle({ color: line.color, width: line.width || 3, borderWidth: 0, dashArray: line.dashed ? [8, 7] : [0, 0] })]));
      overlays.push(new TMap.MultiPolyline({ map, styles, geometries: lines.map((line, index) => ({ id: "line-" + index, styleId: "line-" + index, paths: paths(TMap, line.feature.geometry.coordinates), properties: line.feature.properties })) }));
    }
    if (polygons.length) {
      const styles = Object.fromEntries(polygons.map((polygon, index) => ["area-" + index, new TMap.PolygonStyle({ color: polygon.fill, showBorder: true, borderColor: polygon.color, borderWidth: 2, borderDashArray: polygon.dashed ? [5, 6] : [0, 0] })]));
      overlays.push(new TMap.MultiPolygon({ map, styles, geometries: polygons.map((polygon, index) => ({ id: "area-" + index, styleId: "area-" + index, paths: paths(TMap, polygon.feature.geometry.coordinates), properties: polygon.feature.properties })) }));
    }
    const Point = pointOverlay(TMap);
    points.forEach((point) => overlays.push(new Point({ map, point, choose: onSelect, isStopPropagation: true })));
    return () => overlays.forEach((overlay) => overlay.destroy());
  }, [ready, points, lines, polygons, onSelect]);

  useEffect(() => {
    if (!ready || !center || !instance.current) return;
    instance.current.setCenter(position(window.TMap, [center.lng, center.lat])); instance.current.setZoom(zoom);
  }, [ready, center?.id, center?.lng, center?.lat, zoom]);
  const locationKey = locations.map((point) => [point.id, point.lng, point.lat].join(":")).join("|");
  useEffect(() => { if (ready && fitLocations && instance.current) fit(instance.current, window.TMap, locations, 10); }, [ready, fitLocations, locationKey]);

  return <div className="map-canvas-wrap tencent-map-wrap"><div className="map-canvas" ref={host} aria-label={label} />{!loaded && <div className="basemap-status" role="status">腾讯地图加载中…</div>}{!fitLocations && <button className="map-fit icon-button" title="定位全部遗址" aria-label="定位全部遗址" disabled={!ready || !locations.length} onClick={() => fit(instance.current, window.TMap, locations)}><Scan size={18} /></button>}</div>;
}
