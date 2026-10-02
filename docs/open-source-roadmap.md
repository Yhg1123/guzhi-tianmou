# 开源技术路线与研究边界

核实日期：2026-10-02。以下区分“已接入”和“后续路线”，不代表所有工具已安装或运行。

## 已接入

| 项目 | 作用 | 本系统使用范围 |
| --- | --- | --- |
| [Leaflet](https://github.com/Leaflet/Leaflet) | 交互地图，BSD-2-Clause | OSM 底图、点线面、图层开关、范围定位 |
| [Turf](https://github.com/Turfjs/turf) | 浏览器端空间处理，MIT | 点线球面距离、点落面、调查参考缓冲区 |
| [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) | Three.js 高斯模型查看器，MIT | 0.4.7，本地 PLY/SPLAT/KSPLAT 文件渲染 |
| [Three.js](https://github.com/mrdoob/three.js) | WebGL 三维，MIT | 0.170.0，与查看器一起延迟加载 |
| [idb-keyval](https://github.com/jakearchibald/idb-keyval) | IndexedDB 存储，Apache-2.0 | 项目、笔记、模型、采集清单保存在本设备 |

模型查看器关闭 shared-memory workers，避免要求跨源隔离响应头；未关闭浏览器安全措施。页面切换会释放 renderer、worker 与 Blob URL。模型在局部坐标系中查看，不伪装成已与 GIS 完成地理配准。

## 参考与后续候选

- [Arches](https://github.com/archesproject/arches)：面向文化遗产的地理信息与档案管理。参考其“对象档案、证据来源、空间信息”的组织思路，没有复制其 AGPL 代码，也没有部署 Arches 后端。
- [GRASS GIS](https://github.com/OSGeo/grass)：地形、水文、栅格分析。后续服务端可使用 [r.slope.aspect](https://grass.osgeo.org/grass-stable/manuals/r.slope.aspect.html) 和 [r.viewshed](https://grass.osgeo.org/grass-stable/manuals/r.viewshed.html)。目前仅接收外部计算出的点属性，不把底图颜色解释成高程或坡度。
- [COLMAP](https://github.com/colmap/colmap)：摄影测量中的相机解算和稀疏重建。它是训练前的数据处理环节，不等于高斯训练本身。
- [gsplat](https://github.com/nerfstudio-project/gsplat)：Apache-2.0 的 CUDA 高斯光栅化与训练相关实现。需要选定版本、PyTorch/CUDA 兼容环境并跑通训练样例后，再封装成后台任务。
- [SuperSplat](https://github.com/playcanvas/supersplat)：高斯模型裁剪、清理与导出工具。可用于消除杂点和减小网页查看的模型体积。
- [原始 Gaussian Splatting](https://github.com/graphdeco-inria/gaussian-splatting)：很可能是用户提到的项目，官方参考实现。[许可证](https://github.com/graphdeco-inria/gaussian-splatting/blob/main/LICENSE.md)限制在研究/评估等非商业用途，不把“GitHub 上有源码”理解为不受限商业开源。
- [Vercel agent-skills](https://github.com/vercel-labs/agent-skills) 与 [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines)：参考语义导航、键盘可访问、表单标签、状态反馈、长文本处理等检查项。没有自动安装陌生技能，也没有执行仓库脚本。

## 为什么重做环境因子

1. 选址研究和今天的保护任务需要不同时间尺度。现状水系、现状道路只用于现状空间观察；历史因子使用标注为历史重建且分期匹配的图层。
2. 不设跨地区、跨时期的通用“最优选址总分”。展示有效样本数、中位数、范围和逐点观测值，保留缺失值。
3. 高程、坡度、TPI 需要 DEM 采样来源、水平/垂直基准、栅格分辨率、算法与邻域尺度。可视域额外需要观察高度、地形与植被遮挡假设。
4. 古遗址是有保存与调查偏差的样本。若要推断偏好，需建立同期对照点、限定可调查区域、控制空间自相关，并使用考古文献验证。
5. 对现代建筑的启发只能是待验证假设，比如“台地相对地形位置与水文联系值得研究”；不能直接替代现代地质、洪水、规划与文保论证。

当前分期匹配采用中文时期字段的精确一致，不自动推断年代区间重叠；“秦汉时期”与“汉代”不会被当作相同分期。数据不足时显示缺失而不是猜测。

## 3DGS 与遗产保护的结合

建议流程：经授权的现存遗址/古建筑多视角照片 → COLMAP 相机位姿 → gsplat 训练 → SuperSplat 裁剪 → 本系统关联遗址并查看、归档。

当前已落地：本地模型导入、旋转缩放、视角适配、上下轴调整、关联遗址保存、照片清单登记、采集核查和任务清单导出。没有连接或伪造 GPU 训练进度。

下一阶段接口建议：服务端任务记录保存 `site_id`、影像版本、采集日期、控制点基准、COLMAP 配置、训练提交版本、状态、日志、模型 URL、质量检查记录。作业阶段明确区分 queued/running/failed/completed，并让失败日志可追溯。

3DGS 记录“拍到的现状”，不是缺失古建筑复原引擎。几何测量、裂缝量测、形变监测需要可追溯的尺度控制和验证，必要时另用摄影测量网格或激光点云；历史复原应明确区分实测部分和推测部分。

## 开发验证

- `node --test tests/geodata.test.mjs tests/sites-worker.test.mjs`
- `node scripts/qa-fixtures.mjs` 生成明确的合成 QA 文件，不读取用户照片或研究数据。
- 浏览器验收覆盖：六个入口、筛选、空结果、GeoJSON 成功/失败导入、分期匹配、负 TPI、点落面、笔记持久化、SPLAT 导入、3D 非空画面与旋转、桌面和手机布局。
- `qa/` 中的截图/测试文件只用于功能验收，不是古遗址研究成果。
