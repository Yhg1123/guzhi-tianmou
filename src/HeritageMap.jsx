import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { geoJsonLines } from "./geodata.js";
import { Scan } from "lucide-react";
import { TencentMap, MapProviderSelect, defaultMapProvider } from "./TencentMap.jsx";
import { heritageMarker, createMapMarker, placeMarkerLabel, MARKER_SIZE, MARKER_ANCHOR } from "./mapMarkers.js";

const TILE_URL = import.meta.env.VITE_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = import.meta.env.VITE_TILE_ATTRIBUTION
  || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const EMPTY = [];

function label(text) { const element = document.createElement("span"); element.textContent = text; return element; }

export function HeritageMap(props) {
  const [provider, setProvider] = useState(defaultMapProvider);
  const [unavailable, setUnavailable] = useState(false);
  const { sites, selectedSite, waterways = EMPTY, routes = EMPTY, boundaries = EMPTY, hazards = EMPTY, referenceArea, mode, layers, onSelectSite } = props;
  const points = useMemo(() => layers.points ? sites.map((site) => heritageMarker(site, selectedSite?.id)) : [], [sites, selectedSite?.id, layers.points]);
  const lines = useMemo(() => [...(layers.waterways ? waterways.map((feature) => ({ feature, color: "#2d8fa8", width: mode === "water" ? 5 : 3 })) : []), ...(layers.routes ? routes.map((feature) => ({ feature, color: "#bb8140", dashed: true })) : [])], [waterways, routes, layers.waterways, layers.routes, mode]);
  const polygons = useMemo(() => [...(layers.boundaries ? boundaries.map((feature) => ({ feature, color: "#168372", fill: "rgba(22,131,114,0.12)" })) : []), ...(layers.hazards ? hazards.map((feature) => ({ feature, color: "#ce6c42", fill: "rgba(206,108,66,0.12)", dashed: true })) : []), ...(referenceArea ? [{ feature: referenceArea, color: "#357fbd", fill: "rgba(53,127,189,0.08)", dashed: true }] : [])], [boundaries, hazards, referenceArea, layers.boundaries, layers.hazards]);
  return <div className="map-canvas-wrap">{provider !== "osm" ? <TencentMap points={points} locations={sites} lines={lines} polygons={polygons} imagery={provider === "tencent-satellite"} center={selectedSite} zoom={14} onSelect={onSelectSite} onUnavailable={() => { setProvider("osm"); setUnavailable(true); }} /> : <OpenHeritageMap {...props} />}<MapProviderSelect value={provider} onChange={(value) => { setProvider(value); setUnavailable(false); }} />{unavailable && <div className="basemap-status" role="status">腾讯地图暂不可用，已切换 OpenStreetMap</div>}</div>;
}

function OpenHeritageMap({ sites, selectedSite, waterways = [], routes = [], boundaries = [], hazards = [], referenceArea, mode, layers, onSelectSite }) {
  const elementRef = useRef(null);
  const mapRef = useRef(null);
  const contentRef = useRef(null);
  const [tileStatus, setTileStatus] = useState("loading");

  useEffect(() => {
    if (!elementRef.current) return undefined;
    const map = L.map(elementRef.current, { zoomControl: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([34.31, 108.95], 9);
    const tileLayer = L.tileLayer(TILE_URL, {
      maxZoom: 18,
      attribution: TILE_ATTRIBUTION,
    });
    tileLayer.on("tileload", () => setTileStatus("ready"));
    tileLayer.on("tileerror", () => setTileStatus((current) => current === "ready" ? current : "error"));
    tileLayer.addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    const content = L.layerGroup().addTo(map);
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
    mapRef.current = map;
    contentRef.current = content;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(elementRef.current);
    return () => {
      observer.disconnect();
      map.stop(); map.remove();
      mapRef.current = null;
      contentRef.current = null;
    };
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    content.clearLayers();
    if (layers.waterways && waterways.length) {
      L.geoJSON(geoJsonLines(waterways), {
        style: { color: "#2d8fa8", weight: mode === "water" ? 5 : 3, opacity: 0.86 },
        onEachFeature(feature, layer) { layer.bindTooltip(label(feature.properties.name)); },
      }).addTo(content);
    }
    if (layers.routes && routes.length) {
      L.geoJSON(geoJsonLines(routes), {
        style: { color: "#bb8140", weight: 3, dashArray: "8 7", opacity: 0.85 },
        onEachFeature(feature, layer) { layer.bindTooltip(label(feature.properties.name)); },
      }).addTo(content);
    }
    for (const [key, data, color] of [["boundaries", boundaries, "#168372"], ["hazards", hazards, "#ce6c42"]]) {
      if (layers[key] && data.length) L.geoJSON(geoJsonLines(data), { style: { color, weight: 2, fillOpacity: 0.12, dashArray: key === "hazards" ? "5 5" : undefined }, onEachFeature(feature, layer) { layer.bindTooltip(label(feature.properties.name)); } }).addTo(content);
    }
    if (referenceArea) L.geoJSON(referenceArea, { style: { color: "#357fbd", weight: 2, dashArray: "5 6", fillOpacity: 0.08 } }).bindTooltip(label("调查参考区，非法定保护范围")).addTo(content);
    if (layers.points) {
      sites.forEach((site) => {
        const active = site.id === selectedSite?.id;
        const button = createMapMarker(heritageMarker(site, selectedSite?.id), onSelectSite);
        const marker = L.marker([site.lat, site.lng], { icon: L.divIcon({ html: button, className: "heritage-leaflet-icon", iconSize: MARKER_SIZE, iconAnchor: MARKER_ANCHOR }), keyboard: false, zIndexOffset: active ? 1000 : 0, riseOnHover: true }).addTo(content);
        const instance = mapRef.current;
        const place = () => { if (!elementRef.current) return; const point = instance.latLngToContainerPoint(marker.getLatLng()); placeMarkerLabel(button, point.x, point.y, elementRef.current.clientWidth); };
        instance.on("move zoom resize", place); place();
        marker.on("remove", () => { instance.off("move zoom resize", place); button.onclick = null; });
      });
    }
  }, [sites, selectedSite, waterways, routes, boundaries, hazards, referenceArea, mode, layers, onSelectSite]);

  useEffect(() => {
    if (mapRef.current && selectedSite) {
      mapRef.current.flyTo([selectedSite.lat, selectedSite.lng], referenceArea ? 14 : 10, { duration: 0.5 });
    }
  }, [selectedSite?.id, selectedSite?.lat, selectedSite?.lng, Boolean(referenceArea)]);

  return <div className="map-canvas-wrap">
    <div className="map-canvas" ref={elementRef} aria-label="OpenStreetMap 底图与导入的遗址、水系、古道图层" />
    <button className="map-fit icon-button" title="定位全部遗址" aria-label="定位全部遗址" disabled={!sites.length} onClick={() => mapRef.current?.fitBounds(sites.map((s) => [s.lat, s.lng]), { padding: [48, 48], maxZoom: 13 })}><Scan size={18} /></button>
    {tileStatus !== "ready" && <div className="basemap-status" role="status">{tileStatus === "error" ? "底图暂不可用，导入图层仍可查看" : "底图加载中…"}</div>}
  </div>;
}
