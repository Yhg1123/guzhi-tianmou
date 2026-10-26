import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Viewer, SceneFormat, SceneRevealMode } from "@mkkellogg/gaussian-splats-3d";
import { RotateCcw, Play, Pause, Scan, CircleAlert, Plus, Minus } from "lucide-react";
import { createSampleSplat } from "./sampleSplat.js";
import { heritageSample as defaultSample } from "./heritageSample.js";
import { photoFraming } from "./splatFraming.js";

export function SplatViewer({ file, modelUrl, sourceAsset, name, isSample = false, sampleMode = "heritage", sampleData = defaultSample }) {
  const heritageSample = sampleData;
  const photoDepth = sourceAsset?.representation === "photo-depth-gaussians";
  const photogrammetry = isSample && sampleMode !== "synthetic";
  const host = useRef(null);
  const viewerRef = useRef(null);
  const frameRef = useRef(null);
  const viewRef = useRef("overview");
  const [view, setView] = useState("overview");
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [count, setCount] = useState(0);
  const [rotate, setRotate] = useState(false);
  const [axis, setAxis] = useState("y");
  const [background, setBackground] = useState("dark");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    let viewer;
    let resizeObserver;
    const root = document.createElement("div");
    root.className = "splat-render-root";
    host.current.appendChild(root);
    const isHeritage = !file && !modelUrl && sampleMode !== "synthetic";
    const url = modelUrl || (isHeritage ? heritageSample.url : URL.createObjectURL(file || createSampleSplat()));
    setStatus("loading"); setCount(0); setMessage(""); setRotate(false);
    viewRef.current = "overview"; setView("overview");
    const up = photoDepth ? [0, 1, 0] : axis === "z" ? [0, 0, 1] : axis === "-y" ? [0, -1, 0] : [0, 1, 0];
    try {
      viewer = new Viewer({ rootElement: root, cameraUp: up, initialCameraPosition: [7, 5, 9], initialCameraLookAt: [0, 1.4, 0], sharedMemoryForWorkers: false, gpuAcceleratedSort: false, enableSIMDInSort: true, sphericalHarmonicsDegree: 0, sceneRevealMode: SceneRevealMode.Instant, ignoreDevicePixelRatio: true });
      viewerRef.current = viewer;
      const ext = file?.name?.split(".").pop().toLowerCase() || "splat";
      const format = { splat: SceneFormat.Splat, ply: SceneFormat.Ply, ksplat: SceneFormat.KSplat }[ext];
      viewer.addSplatScene(url, { format, showLoadingUI: false, progressiveLoad: false, splatAlphaRemovalThreshold: 5 }).then(() => {
        if (!alive) return;
        const mesh = viewer.splatMesh;
        const n = mesh.getSplatCount();
        if (!n) throw new Error("模型不包含有效的高斯点。");
        const box = new THREE.Box3();
        const point = new THREE.Vector3();
        const stride = Math.max(1, Math.ceil(n / 20000));
        for (let i = 0; i < n; i += stride) { mesh.getSplatCenter(i, point); if ([point.x, point.y, point.z].every(Number.isFinite)) box.expandByPoint(point); }
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3()).length();
        if (!Number.isFinite(size) || size === 0) throw new Error("无法确定模型范围。");
        const frame = (preset = viewRef.current) => {
          viewer.camera.aspect = Math.max(1, root.clientWidth) / Math.max(1, root.clientHeight);
          viewer.camera.zoom = 1;
          if (photoDepth) {
            // Reproduce the source photograph's assumed projection. Orbit only a little:
            // no unseen back side, invented 360-degree view, or metric dimensions.
            const { processedWidth: w, processedHeight: h } = sourceAsset;
            const { fov, angle, zoom } = photoFraming(w, h, viewer.camera.aspect, preset);
            viewer.camera.fov = fov; viewer.camera.zoom = zoom;
            viewer.controls.enablePan = false;
            viewer.controls.minAzimuthAngle = -0.075; viewer.controls.maxAzimuthAngle = 0.075;
            viewer.controls.minPolarAngle = Math.PI / 2 - 0.04; viewer.controls.maxPolarAngle = Math.PI / 2 + 0.04;
            viewer.controls.minDistance = 1.4; viewer.controls.maxDistance = 1.4;
            viewer.controls.enableZoom = false;
            viewer.controls.target.set(0, 0, -1.4);
            viewer.camera.position.set(Math.sin(angle) * 1.4, 0, -1.4 + Math.cos(angle) * 1.4);
            viewer.camera.near = 0.01; viewer.camera.far = 20;
            viewer.camera.updateProjectionMatrix(); viewer.controls.update(); viewer.forceRenderNextFrame();
            return;
          }
          const vertical = THREE.MathUtils.degToRad(viewer.camera.fov) / 2;
          const horizontal = Math.atan(Math.tan(vertical) * viewer.camera.aspect);
          const directions = {
            overview: [1, 0.65, 1.2], front: [0, 0.15, 1], top: [0, 1, 0.001], detail: [0.6, 0.25, 1],
          };
          const direction = new THREE.Vector3(...directions[preset]);
          if (axis === "z") direction.set(direction.x, -direction.z, direction.y);
          else if (axis === "-y") direction.y *= -1;
          direction.normalize();
          const right = new THREE.Vector3().crossVectors(new THREE.Vector3(...up), direction).normalize();
          const screenUp = new THREE.Vector3().crossVectors(direction, right).normalize();
          const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
          let distance = 0;
          for (const x of [-half.x, half.x]) for (const y of [-half.y, half.y]) for (const z of [-half.z, half.z]) {
            const corner = new THREE.Vector3(x, y, z);
            distance = Math.max(distance, corner.dot(direction) + Math.abs(corner.dot(right)) / Math.tan(horizontal), corner.dot(direction) + Math.abs(corner.dot(screenUp)) / Math.tan(vertical));
          }
          viewer.camera.position.copy(center).add(direction.multiplyScalar(distance * (preset === "detail" ? 0.62 : 1.12)));
          viewer.camera.near = Math.max(0.001, size / 10000); viewer.camera.far = Math.max(1000, size * 100);
          viewer.camera.updateProjectionMatrix(); viewer.controls.target.copy(center); viewer.controls.update(); viewer.forceRenderNextFrame();
        };
        frameRef.current = frame; frame(); viewer.start();
        resizeObserver = new ResizeObserver(() => {
          if (!alive || !root.clientHeight) return;
          viewer.camera.aspect = root.clientWidth / root.clientHeight;
          viewer.camera.updateProjectionMatrix(); frame();
        });
        resizeObserver.observe(root);
        setCount(n); setStatus("ready");
      }).catch((error) => { if (alive) { setStatus("error"); setMessage(error.message || "模型加载失败"); } });
    } catch (error) { setStatus("error"); setMessage(`WebGL 查看器无法启动：${error.message}`); }
    return () => {
      alive = false; frameRef.current = null;
      resizeObserver?.disconnect();
      if (viewerRef.current === viewer) viewerRef.current = null;
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      if (viewer) Promise.resolve(viewer.dispose()).catch(() => {}).finally(() => root.remove()); else root.remove();
    };
  }, [file, modelUrl, sourceAsset, photoDepth, axis, retry, sampleMode, sampleData]);
  useEffect(() => { if (viewerRef.current?.controls) viewerRef.current.controls.autoRotate = rotate; }, [rotate]);
  const zoom = (scale) => {
    const viewer = viewerRef.current; if (!viewer?.controls) return;
    if (photoDepth) { viewer.camera.zoom = THREE.MathUtils.clamp(viewer.camera.zoom / scale, 0.6, 3); viewer.camera.updateProjectionMatrix(); setView(Math.abs(viewer.camera.zoom - 1) < 0.001 ? "overview" : "custom"); }
    else { viewer.camera.position.sub(viewer.controls.target).multiplyScalar(scale).add(viewer.controls.target); viewer.controls.update(); }
    viewer.forceRenderNextFrame();
  };
  const fit = () => { viewRef.current = "overview"; setView("overview"); setRotate(false); frameRef.current?.("overview"); };
  useEffect(() => {
    const element = host.current;
    if (!photoDepth) return undefined;
    const onWheel = (event) => {
      if (!frameRef.current || !event.deltaY) return;
      event.preventDefault();
      zoom(event.deltaY > 0 ? 1.08 : 1 / 1.08);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [photoDepth]);
  return <section className={`splat-stage ${background} ${photoDepth ? "photo-depth-stage" : ""}`} aria-label={photoDepth ? "照片高斯预览查看器" : photogrammetry ? "摄影测量点云查看器" : "三维高斯泼溅查看器"}>
    <div className="splat-chrome"><div className="splat-stage-label"><span className="badge dark-badge">{photoDepth ? "PHOTO · GAUSSIAN" : photogrammetry ? "HERITAGE · PHOTOGRAMMETRY" : "3D GAUSSIAN SPLATTING"}</span><span>{photogrammetry ? `${heritageSample.title} · 公开摄影测量采样` : name}</span></div>
      <div className="splat-toolbar"><button className="icon-button splat-fit" aria-label={photoDepth ? "显示全图" : "适应模型范围"} title="恢复完整取景" disabled={status !== "ready"} onClick={fit}><Scan size={18} />{photoDepth && <span>显示全图</span>}</button>
        {!photoDepth && <button className="icon-button" aria-label={rotate ? "暂停旋转" : "自动旋转"} disabled={status !== "ready"} onClick={() => setRotate(!rotate)}>{rotate ? <Pause size={18} /> : <Play size={18} />}</button>}
        <button className="icon-button" aria-label="放大模型" title="放大模型" disabled={status !== "ready"} onClick={() => zoom(0.8)}><Plus size={18} /></button><button className="icon-button" aria-label="缩小模型" title="缩小模型" disabled={status !== "ready"} onClick={() => zoom(1.25)}><Minus size={18} /></button>
        {!photoDepth && <><span className="tool-divider" /><label className="axis-label">上轴<select aria-label="模型上轴" value={axis} onChange={(e) => setAxis(e.target.value)}><option value="y">Y+</option><option value="-y">Y−</option><option value="z">Z+</option></select></label></>}
        <button className={`background-swatch ${background}`} title="切换背景颜色" aria-label="切换背景颜色" onClick={() => setBackground(background === "dark" ? "light" : "dark")} />
      </div>
    </div>
    <div ref={host} className="splat-host" />
    {status === "loading" && <div className="splat-overlay" role="status"><span className="loader" />{photogrammetry ? "正在加载摄影测量点云…" : "正在解析高斯模型…"}</div>}
    {status === "error" && <div className="splat-overlay" role="alert"><CircleAlert size={28} /><strong>模型暂时无法显示</strong><p>{message}</p><button className="button" onClick={() => setRetry(retry + 1)}><RotateCcw size={15} />重试加载</button></div>}
    <div className="splat-footer"><div className="splat-presets" role="group" aria-label="观察视角">{(photoDepth ? [["overview", "完整取景"], ["front", "向左微转"], ["top", "向右微转"], ["detail", "细节"]] : [["overview", "全景"], ["front", "正面"], ["top", "俯视"], ["detail", "细节"]]).map(([id, title]) => <button key={id} disabled={status !== "ready"} aria-pressed={view === id} onClick={() => { viewRef.current = id; setView(id); frameRef.current?.(id); }}>{title}</button>)}<span>{photoDepth ? "拖拽微转 · 滚轮缩放" : "拖拽旋转 · 滚轮缩放"}</span></div>
      <div className="splat-status"><span>{status === "ready" ? `${count.toLocaleString()} ${photogrammetry ? "个采样点" : "个高斯点"}` : status === "error" ? "加载失败" : "加载中"}</span><span>{photoDepth ? "单图深度推断 · 相对尺度" : photogrammetry ? "摄影测量点云 · 非训练 3DGS · 尺度未标定" : "局部坐标 · 尺度未经标定"}</span></div>
    </div>
  </section>;
}
