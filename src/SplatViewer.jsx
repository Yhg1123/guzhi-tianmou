import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Viewer, SceneFormat, SceneRevealMode } from "@mkkellogg/gaussian-splats-3d";
import { RotateCcw, Play, Pause, Scan, CircleAlert, Plus, Minus } from "lucide-react";
import { createSampleSplat } from "./sampleSplat.js";
import { heritageSample as defaultSample } from "./heritageSample.js";
import { photoFraming } from "./splatFraming.js";
import { gaussianViewPose, gaussianCaptureProjection } from "./gaussianNavigation.js";

export function SplatViewer({ file, modelUrl, sourceAsset, name, isSample = false, sampleMode = "heritage", sampleData = defaultSample }) {
  const heritageSample = sampleData;
  const photoDepth = sourceAsset?.representation === "photo-depth-gaussians";
  const photogrammetry = isSample && sampleMode !== "synthetic";
  const trained = sampleData.kind === "gaussian";
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
    const layoutCapture = () => {
      if (!trained || !sampleData.captureCamera || !host.current) return;
      const { width, height } = sampleData.captureCamera.intrinsics;
      const ratio = Math.min(host.current.clientWidth / width, host.current.clientHeight / height);
      root.style.inset = "auto";
      root.style.width = `${width * ratio}px`; root.style.height = `${height * ratio}px`;
      root.style.left = `${(host.current.clientWidth - width * ratio) / 2}px`;
      root.style.top = `${(host.current.clientHeight - height * ratio) / 2}px`;
    };
    layoutCapture();
    const isHeritage = !file && !modelUrl && sampleMode !== "synthetic";
    const url = modelUrl || (isHeritage ? heritageSample.url : URL.createObjectURL(file || createSampleSplat()));
    setStatus("loading"); setCount(0); setMessage(""); setRotate(false);
    viewRef.current = trained ? "capture" : "overview"; setView(viewRef.current);
    const up = trained && sampleData.captureCamera ? sampleData.captureCamera.up : photoDepth ? [0, 1, 0] : axis === "z" ? [0, 0, 1] : axis === "-y" ? [0, -1, 0] : [0, 1, 0];
    try {
      // Own calibrated cameras so the renderer's internal resize handler cannot
      // replace the asymmetric source projection with a generic FOV matrix.
      const captureCamera = trained && sampleData.captureCamera ? new THREE.PerspectiveCamera(50, 1, 0.01, 1000) : undefined;
      if (captureCamera) { captureCamera.position.set(7, 5, 9); captureCamera.up.fromArray(up); }
      viewer = new Viewer({ rootElement: root, camera: captureCamera, cameraUp: up, initialCameraPosition: [7, 5, 9], initialCameraLookAt: [0, 1.4, 0], sharedMemoryForWorkers: false, gpuAcceleratedSort: false, enableSIMDInSort: true, sphericalHarmonicsDegree: trained ? (sampleData.shDegree || 0) : 0, sceneRevealMode: SceneRevealMode.Instant, ignoreDevicePixelRatio: true });
      viewerRef.current = viewer;
      // A single click focuses this workspace's keyboard controls. The library's
      // automatic ray-picked pivot can hit a large background Gaussian and turn
      // the camera away from the building, so retain our documented orbit pivot.
      if (trained) viewer.onMouseClick = () => {};
      const ext = (file?.name || modelUrl?.split(/[?#]/)[0])?.split(".").pop().toLowerCase() || "splat";
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
          viewer.camera.up.fromArray(up);
          if (trained && preset === "capture" && sampleData.captureCamera) {
            const capture = sampleData.captureCamera;
            viewer.camera.position.fromArray(capture.position);
            viewer.camera.up.fromArray(capture.up);
            viewer.controls.target.fromArray(capture.target);
            const projection = gaussianCaptureProjection(capture.intrinsics, viewer.camera.aspect);
            viewer.camera.fov = projection.fov;
            viewer.camera.near = 0.01; viewer.camera.far = 1000;
            viewer.camera.updateProjectionMatrix();
            viewer.camera.projectionMatrix.makePerspective(projection.left, projection.right, projection.top, projection.bottom, 0.01, 1000);
            viewer.camera.projectionMatrixInverse.copy(viewer.camera.projectionMatrix).invert();
            viewer.controls.update(); viewer.forceRenderNextFrame();
            return;
          }
          if (trained && preset !== "overview" && sampleData.camera) {
            const pose = gaussianViewPose(sampleData.camera, preset, viewer.camera.aspect);
            viewer.camera.position.fromArray(pose.position);
            viewer.controls.target.fromArray(pose.target);
            viewer.camera.fov = pose.fov;
            viewer.camera.near = 0.01; viewer.camera.far = 1000;
            viewer.camera.updateProjectionMatrix(); viewer.controls.update(); viewer.forceRenderNextFrame();
            return;
          }
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
          if (trained) viewer.camera.fov = 50;
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
        if (trained) {
          // Scope keyboard navigation to the focused scene instead of letting
          // OrbitControls pan globally while the user operates other fields.
          viewer.perspectiveControls?.stopListenToKeyEvents();
          viewer.orthographicControls?.stopListenToKeyEvents();
        }
        viewer.controls.autoRotateSpeed = 0.65;
        viewer.controls.addEventListener("start", () => {
          setRotate(false);
          if (!photoDepth) { viewRef.current = "custom"; setView("custom"); }
        });
        if (trained && sampleData.autoRotate !== false && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) setRotate(true);
        resizeObserver = new ResizeObserver(() => {
          if (!alive || !root.clientHeight) return;
          layoutCapture();
          const oldAspect = viewer.camera.aspect;
          viewer.camera.aspect = root.clientWidth / root.clientHeight;
          // Preserve the user's spatial viewpoint and zoom on resize. Only the
          // source-photo projection needs to be refitted to its image frame.
          if (photoDepth || trained && sampleData.captureCamera && viewRef.current === "capture") frame();
          else {
            if (trained && oldAspect !== viewer.camera.aspect) {
              const fitChange = Math.max(1, 1.5 / viewer.camera.aspect) / Math.max(1, 1.5 / oldAspect);
              viewer.camera.position.sub(viewer.controls.target).multiplyScalar(fitChange).add(viewer.controls.target);
            }
            viewer.camera.updateProjectionMatrix(); viewer.controls.update(); viewer.forceRenderNextFrame();
          }
        });
        resizeObserver.observe(sampleData.captureCamera ? host.current : root);
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
  useEffect(() => {
    const sync = () => { if (viewerRef.current?.controls) viewerRef.current.controls.autoRotate = rotate && !document.hidden; };
    sync(); document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [rotate, status]);
  const zoom = (scale) => {
    const viewer = viewerRef.current; if (!viewer?.controls) return;
    setRotate(false);
    if (photoDepth) { viewer.camera.zoom = THREE.MathUtils.clamp(viewer.camera.zoom / scale, 0.6, 3); viewer.camera.updateProjectionMatrix(); setView(Math.abs(viewer.camera.zoom - 1) < 0.001 ? "overview" : "custom"); }
    else { viewer.camera.position.sub(viewer.controls.target).multiplyScalar(scale).add(viewer.controls.target); viewer.controls.update(); }
    viewer.forceRenderNextFrame();
  };
  const fit = () => { const preset = trained ? "capture" : "overview"; viewRef.current = preset; setView(preset); setRotate(false); frameRef.current?.(preset); };
  const navigateKeyboard = (event) => {
    const viewer = viewerRef.current;
    if (!trained || status !== "ready" || !viewer?.controls || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "Home"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); setRotate(false);
    if (event.key === "Home") { fit(); return; }
    if (["+", "=", "-"].includes(event.key)) { zoom(event.key === "-" ? 1.15 : 1 / 1.15); return; }
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const sign = event.key === "ArrowLeft" || event.key === "ArrowUp" ? 1 : -1;
    const offset = viewer.camera.position.clone().sub(viewer.controls.target);
    const right = new THREE.Vector3().crossVectors(offset, viewer.camera.up).normalize();
    if (event.shiftKey) {
      const move = (horizontal ? right : viewer.camera.up.clone()).multiplyScalar(offset.length() * 0.035 * sign);
      viewer.camera.position.add(move); viewer.controls.target.add(move);
    } else {
      offset.applyAxisAngle(horizontal ? viewer.camera.up.clone().normalize() : right, sign * Math.PI / 18);
      viewer.camera.position.copy(viewer.controls.target).add(offset);
    }
    viewRef.current = "custom"; setView("custom"); viewer.controls.update(); viewer.forceRenderNextFrame();
  };
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
  return <section className={`splat-stage ${background} ${photoDepth ? "photo-depth-stage" : trained ? "trained-gs-stage" : ""}`} aria-label={photoDepth ? "照片空间预览查看器" : photogrammetry ? "摄影测量点云查看器" : "三维高斯泼溅查看器"}>
    <div className="splat-chrome"><div className="splat-stage-label"><span className="badge dark-badge">{photoDepth ? "PHOTO · DEPTH" : photogrammetry ? "HERITAGE · PHOTOGRAMMETRY" : "3D GAUSSIAN SPLATTING"}</span><span>{photogrammetry ? `${heritageSample.title} · 公开摄影测量采样` : name}</span></div>
      <div className="splat-toolbar"><button className="icon-button splat-fit" aria-label={photoDepth ? "显示全图" : trained ? "恢复初始视角" : "适应模型范围"} title={trained ? "恢复初始视角" : "恢复完整取景"} disabled={status !== "ready"} onClick={fit}><Scan size={18} />{photoDepth && <span>显示全图</span>}</button>
        {!photoDepth && <button className="icon-button" aria-label={rotate ? "暂停旋转" : "自动旋转"} disabled={status !== "ready"} onClick={() => setRotate(!rotate)}>{rotate ? <Pause size={18} /> : <Play size={18} />}</button>}
        <button className="icon-button" aria-label="放大模型" title="放大模型" disabled={status !== "ready"} onClick={() => zoom(0.8)}><Plus size={18} /></button><button className="icon-button" aria-label="缩小模型" title="缩小模型" disabled={status !== "ready"} onClick={() => zoom(1.25)}><Minus size={18} /></button>
        {!photoDepth && !trained && <><span className="tool-divider" /><label className="axis-label">上轴<select aria-label="模型上轴" value={axis} onChange={(e) => setAxis(e.target.value)}><option value="y">Y+</option><option value="-y">Y−</option><option value="z">Z+</option></select></label></>}
        <button className={`background-swatch ${background}`} title="切换背景颜色" aria-label="切换背景颜色" onClick={() => setBackground(background === "dark" ? "light" : "dark")} />
      </div>
    </div>
    <div ref={host} className="splat-host" tabIndex={trained ? 0 : undefined} role={trained ? "group" : undefined} aria-label={trained ? "三维场景操作区，方向键环绕，Shift加方向键平移，加减键缩放，Home复位" : undefined} onPointerDown={trained ? (e) => e.currentTarget.focus({ preventScroll: true }) : undefined} onKeyDown={navigateKeyboard} />
    {status === "loading" && <div className="splat-overlay" role="status"><span className="loader" />{photogrammetry ? "正在加载摄影测量点云…" : "正在解析高斯模型…"}</div>}
    {status === "error" && <div className="splat-overlay" role="alert"><CircleAlert size={28} /><strong>模型暂时无法显示</strong><p>{message}</p><button className="button" onClick={() => setRetry(retry + 1)}><RotateCcw size={15} />重试加载</button></div>}
    <div className="splat-footer"><div className="splat-presets" role="group" aria-label="观察视角">{(photoDepth ? [["overview", "完整取景"], ["front", "向左微转"], ["top", "向右微转"], ["detail", "细节"]] : trained ? [["capture", "初始视角"], ["left", "左侧"], ["back", "背面"], ["right", "右侧"], ["top", "俯视"], ["overview", "全场景"]] : [["overview", "全景"], ["front", "正面"], ["top", "俯视"], ["detail", "细节"]]).map(([id, title]) => <button key={id} disabled={status !== "ready"} aria-pressed={view === id} onClick={() => { setRotate(false); viewRef.current = id; setView(id); frameRef.current?.(id); }}>{title}</button>)}<span>{photoDepth ? "拖拽微转 · 滚轮缩放" : "拖拽环绕 · 右键平移 · 滚轮缩放"}</span></div>
      {trained && <div className="splat-keyboard-hint">点击场景后：方向键环绕 · Shift + 方向键平移 · Home 复位</div>}
      <div className="splat-status"><span>{status === "ready" ? `${count.toLocaleString()} ${photogrammetry ? "个采样点" : "个高斯点"}` : status === "error" ? "加载失败" : "加载中"}</span><span>{photoDepth ? "单图深度推断 · 相对尺度" : photogrammetry ? "摄影测量点云 · 非训练 3DGS · 尺度未标定" : trained ? "实景训练 3DGS · 尺度未核验" : "局部坐标 · 尺度未经标定"}</span></div>
    </div>
  </section>;
}
