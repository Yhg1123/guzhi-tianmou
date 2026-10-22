# 古址天眸 · 古遗址研究工作空间

本项目是可运行的浏览器 GIS 试点。地图使用 Leaflet 和 OpenStreetMap 底图，不需要地图 API Key。浏览器从 `tile.openstreetmap.org` 加载当前视野的瓦片；正式上线前应按访问规模选择稳定的瓦片服务或自建服务，并遵守 [OSM 瓦片使用政策](https://operations.osmfoundation.org/policies/tiles/)。如更换服务，可设置 `VITE_TILE_URL` 和 `VITE_TILE_ATTRIBUTION`。

## 当前可用流程

1. **遗址地图**：浏览 OpenStreetMap、遗址点位、水系、交通、保护范围和影响区，切换图层、定位全部遗址。
2. **遗址档案**：筛选名录、查看记录，并联动选址研究与三维档案。
3. **选址研究**：按聚落、防御、礼制研究问题切换因子；分时期/类型比较中位数与观测值。只有 `historical` 数据且时期名称与遗址一致，水系和交通距离才进入历史选址分析。线自身的 `period` 优先于图层时期。
4. **保护评估**：Turf 点落面核查、50–2,000 m 调查参考缓冲区、现场笔记和 GeoJSON/JSON 导出。调查参考区不是法定边界；点位未落入影响区不表示安全。
5. **三维档案**：默认展示有来源与许可的贝尔神庙真实摄影测量点云，支持全景、正面、俯视与细节视角；另可切换合成校验亭阁。GaussianSplats3D + Three.js 实际渲染用户导入的 Gaussian PLY、SPLAT、KSPLAT，支持旋转、缩放、范围适配、上轴与背景调整，模型关联遗址并本地保存。
6. **数据中心**：五类 GeoJSON 图层、年代和来源信息、文件 SHA-256、项目 JSON 备份与恢复。

图层、来源和笔记保存在当前设备的 IndexedDB，不上传服务器；模型和采集清单按遗址另存。清除浏览器数据会删除这些存档。项目 JSON 备份包含图层和笔记，不包含三维模型或照片。照片登记只保存文件清单，不保存/上传照片内容。`public/templates/` 全部是明确标注的虚构格式模板，不能用于科研。

数据中心支持逐层导出 GeoJSON。遗址导入保留 `Feature.id`（其次为 `properties.id`），数字 ID 会转成字符串；未提供 ID 时按坐标和名称生成稳定 ID。重复或保留名称的 ID 会阻止导入，请先在源数据中设置唯一 ID。建议长期使用外部档案编号，避免名称或坐标更新影响关联。

替换遗址图层前请先备份。同 ID、同坐标的现场笔记会保留，已移除或坐标改变的遗址笔记不会转移；三维档案按 ID 与坐标关联。项目恢复保留要素 ID、来源属性及演示标记。GeoJSON 单文件上限 15 MB，项目 JSON 备份恢复上限 100 MB。读取或校验本地存档失败时，系统保留原件、暂停自动保存，并显示临时演示项目；恢复有效项目备份或确认重置后重新启用保存。

## 数据格式

使用 WGS84 / EPSG:4326 GeoJSON `FeatureCollection`，坐标顺序为 `[经度, 纬度]`。遗址使用 `Point`；水系、古道使用 `LineString` / `MultiLineString`；保护范围、影响区使用闭合 `Polygon` / `MultiPolygon`，支持内洞。

遗址属性支持 `name`/`名称`、`period`/`年代`、`site_type`/`遗址类型`、`location`/`地点`、`source`/`数据来源`。地形属性支持数值型 `elevation_m`（米）、`slope_deg`（0–90 度）、`aspect_deg`（0–360 度）、`tpi`（米）及 `terrain_source`、`precision_m`。无效值保持缺失，0 值不会被当成缺失。

GeoJSON 上限 15 MB、5,000 个要素、100,000 个线/面顶点；点数乘线段/面顶点数上限 500,000。大范围数据先在 QGIS、GeoStar 或 PostGIS 中裁剪。高斯模型上限 120 MB，普通点云/网格 PLY 不作为高斯模型接受。

内置五处具名点位坐标未经核验。贝尔神庙开放案例不关联这些点位；合成亭阁仅用于渲染校验。导入线图层不完整时，“最近距离”可能偏大。统计只描述当前样本，不证明古人选址偏好或因果关系。

## 真实遗产数据案例

贝尔神庙预览取自 [Open Heritage 3D / DOI 10.26301/zjnn-wx58](https://www.openheritage3d.org/project.php?id=zjnn-wx58)，署名 **Scott McAvoy / CHEI，2020，Open Heritage 3D 分发**。来源标注 **CC BY**，未注明许可版本。来源数据集包含 1,581 张影像；完整数据约 6.5 GB，经来源网站的下载流程获取。仓库不包含这些原始照片。

`public/samples/temple-of-bel.splat` 是 592,454 个真实 XYZ/RGB 点的 LOD 0–3 采样，约 18.1 MiB。为了复用查看器，它以固定半径的点精灵写入 SPLAT 容器；**它是摄影测量点云的显示衍生物，不是本项目训练的 3DGS 模型**。来源模型未标定尺度且存在局部变形，因此只用于浏览。详细署名、原始元数据、处理说明和 SHA-256 随文件提供；`node scripts/prepare-heritage-sample.mjs` 可从有界字节范围复现，无需下载完整八叉树。

**尚未实现**：直接处理 DEM 栅格、可视域计算、对照样本与推断统计、历史地貌重建、法定建设项目相交审批、照片自动训练、实测尺度与地理配准、服务器多人协作。地形值目前读取外部 GIS 预计算结果。三维训练须另行准备经授权的多视角照片、COLMAP 位姿与兼容的 CUDA/PyTorch 算力环境。

选型依据与后续接入步骤见 [开源技术路线](docs/open-source-roadmap.md)。

## 本地运行

```sh
pnpm install
pnpm dev
```

完整验证：`npm ci` 后运行 `npm test`（也可使用 `pnpm test`），依次执行空间计算与项目回归测试、生产构建、Sites 交付文件检查。单独运行 `test:sites` 前需先运行 `build`。GitHub Actions 对推送和拉取请求运行相同检查。交付到 Sites 的构建保留 `dist/client`、`dist/server` 和 hosting 配置。三维库按页面延迟加载。
