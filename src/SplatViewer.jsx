import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Viewer, SceneFormat, SceneRevealMode } from "@mkkellogg/gaussian-splats-3d";
import { RotateCcw, Play, Pause, Scan, CircleAlert, Plus, Minus } from "lucide-react";
import { createSampleSplat } from "./sampleSplat.js";

export function SplatViewer({ file, name, isSample = false }) {
  const host = useRef(null);
  const viewerRef = useRef(null);
  const frameRef = useRef(null);
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
    const blob = file || createSampleSplat();
    const url = URL.createObjectURL(blob);
    setStatus("loading"); setCount(0); setMessage(""); setRotate(false);
    const up = axis === "z" ? [0, 0, 1] : axis === "-y" ? [0, -1, 0] : [0, 1, 0];
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
        const frame = () => {
          const vertical = THREE.MathUtils.degToRad(viewer.camera.fov) / 2;
          const horizontal = Math.atan(Math.tan(vertical) * viewer.camera.aspect);
          const distance = size / (2 * Math.sin(Math.min(vertical, horizontal))) * 1.1;
          const direction = axis === "z" ? new THREE.Vector3(1, -1, 0.7) : new THREE.Vector3(1, axis === "-y" ? -0.65 : 0.65, 1.2);
          viewer.camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
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
      URL.revokeObjectURL(url);
      if (viewer) Promise.resolve(viewer.dispose()).catch(() => {}).finally(() => root.remove()); else root.remove();
    };
  }, [file, axis, retry]);
  useEffect(() => { if (viewerRef.current?.controls) viewerRef.current.controls.autoRotate = rotate; }, [rotate]);
  const zoom = (scale) => { const viewer = viewerRef.current; if (!viewer?.controls) return; viewer.camera.position.sub(viewer.controls.target).multiplyScalar(scale).add(viewer.controls.target); viewer.controls.update(); viewer.forceRenderNextFrame(); };
  return <section className={`splat-stage ${background}`} aria-label="三维高斯泼溅查看器"><div ref={host} className="splat-host" /><div className="splat-stage-label"><span className="badge dark-badge">3D GAUSSIAN SPLATTING</span><span>{isSample ? "合成亭阁 · 渲染校验样例" : name}</span></div><div className="splat-toolbar"><button className="icon-button" aria-label="适应模型范围" title="适应模型范围" disabled={status !== "ready"} onClick={() => frameRef.current?.()}><Scan size={18} /></button><button className="icon-button" aria-label={rotate ? "暂停旋转" : "自动旋转"} title={rotate ? "暂停旋转" : "自动旋转"} disabled={status !== "ready"} onClick={() => setRotate(!rotate)}>{rotate ? <Pause size={18} /> : <Play size={18} />}</button><button className="icon-button" aria-label="放大模型" title="放大模型" disabled={status !== "ready"} onClick={() => zoom(0.8)}><Plus size={18} /></button><button className="icon-button" aria-label="缩小模型" title="缩小模型" disabled={status !== "ready"} onClick={() => zoom(1.25)}><Minus size={18} /></button><span className="tool-divider" /><label className="axis-label">上轴<select aria-label="模型上轴" value={axis} onChange={(e) => setAxis(e.target.value)}><option value="y">Y+</option><option value="-y">Y−</option><option value="z">Z+</option></select></label><button className={`background-swatch ${background}`} title="切换背景颜色" aria-label="切换背景颜色" onClick={() => setBackground(background === "dark" ? "light" : "dark")} /></div>
    {status === "loading" && <div className="splat-overlay" role="status"><span className="loader" />正在解析高斯模型…</div>}{status === "error" && <div className="splat-overlay" role="alert"><CircleAlert size={28} /><strong>模型暂时无法显示</strong><p>{message}</p><button className="button" onClick={() => setRetry(retry + 1)}><RotateCcw size={15} />重试加载</button></div>}
    <div className="splat-status"><span>{status === "ready" ? `${count.toLocaleString()} 个高斯点` : status === "error" ? "加载失败" : "加载中"}</span><span>{isSample ? "合成数据 · 非古建筑实测重建" : "局部坐标 · 尺度未经标定"}</span></div>
  </section>;
}
