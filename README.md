# 古址天眸 · 古遗址研究工作空间

本项目是可运行的浏览器 GIS 试点。遗址地图、保护评估和环境总览支持腾讯 JavaScript API GL 与 Leaflet / OpenStreetMap 两种底图，可在地图内切换。无 Key 时默认 OpenStreetMap；本地配置腾讯 Key 后可默认使用腾讯地图，连接失败会回退。Key 通过被 Git 忽略的 `.env.local` 配置，仓库只提供空白 [.env.example](.env.example)。接入范围、坐标转换与上线注意事项见 [地图配置](docs/maps.md)。OpenStreetMap 从 `tile.openstreetmap.org` 加载当前视野瓦片，使用须遵守 [OSM 瓦片使用政策](https://operations.osmfoundation.org/policies/tiles/)；自定义瓦片可设置 `VITE_TILE_URL` 和 `VITE_TILE_ATTRIBUTION`。

## 当前可用流程

1. **遗址地图**：浏览腾讯地图或 OpenStreetMap、遗址点位、水系、交通、保护范围和影响区，切换图层、定位全部遗址。
2. **遗址档案**：筛选名录、查看记录，并联动选址研究与三维档案。
3. **选址研究**：按聚落、防御、礼制研究问题切换因子；分时期/类型比较中位数与观测值。只有 `historical` 数据且时期名称与遗址一致，水系和交通距离才进入历史选址分析。线自身的 `period` 优先于图层时期。
4. **保护评估**：Turf 点落面核查、50–2,000 m 调查参考缓冲区、现场笔记和 GeoJSON/JSON 导出。调查参考区不是法定边界；点位未落入影响区不表示安全。
5. **三维档案**：四个公开案例涵盖贝尔神庙、印度之星号真实摄影测量点云，以及慕田峪长城、北京故宫开放摄影；支持全景、正面、俯视与细节视角。GaussianSplats3D + Three.js 实际渲染用户导入的 Gaussian PLY、SPLAT、KSPLAT，支持旋转、缩放、范围适配、上轴与背景调整，模型关联遗址并本地保存。
6. **数据中心**：五类 GeoJSON 图层、年代和来源信息、文件 SHA-256、项目 JSON 备份与恢复；可追加故宫、慕田峪和莫高窟三处公开参考点，不替换已有记录。
7. **公众共建（本地试点）**：文旅探访清单、现状/老照片/变化记录任务、照片原图与预览、重复检查、用途意向、贡献清单导出与原图下载。素材只保存在此设备，尚未接入公众上传、管理方审核或训练后台。照片记录独立于项目 JSON 备份；清除浏览器数据会丢失本地副本，请保留原图。
8. **环境总览**：公开参考点的 Open-Meteo 气温、相对湿度、风速与降水参考，默认每分钟检查更新，可选 1/5/10 分钟；支持自动开关、倒计时、地图指标、逐点统计、24/48 小时趋势与快照导出。现场只读服务可每 30 秒读取。另有现场观测 JSON 导入与只读数据服务接入口，未内置现场设备。详见 [环境数据说明](docs/environment.md)。

图层、来源和笔记保存在当前设备的 IndexedDB，不上传服务器；模型、公众照片和环境观测另存。清除浏览器数据会删除这些存档。项目 JSON 备份包含图层和笔记，不包含三维模型、照片或环境观测。三维页面的重建准备仅保存照片文件清单；公众共建页面实际保存本地照片原图和预览，但不上传。环境页面默认只请求公开参考坐标，项目坐标需点击“加载项目天气”后才发送至天气服务。`public/templates/` 是明确标注的格式模板，不能作为实测资料。

数据中心支持逐层导出 GeoJSON。遗址导入保留 `Feature.id`（其次为 `properties.id`），数字 ID 会转成字符串；未提供 ID 时按坐标和名称生成稳定 ID。重复或保留名称的 ID 会阻止导入，请先在源数据中设置唯一 ID。建议长期使用外部档案编号，避免名称或坐标更新影响关联。

替换遗址图层前请先备份。同 ID、同坐标的现场笔记会保留，已移除或坐标改变的遗址笔记不会转移；三维档案按 ID 与坐标关联。项目恢复保留要素 ID、来源属性及演示标记。GeoJSON 单文件上限 15 MB，项目 JSON 备份恢复上限 100 MB。读取或校验本地存档失败时，系统保留原件、暂停自动保存，并显示临时演示项目；恢复有效项目备份或确认重置后重新启用保存。

## 数据格式

使用 WGS84 / EPSG:4326 GeoJSON `FeatureCollection`，坐标顺序为 `[经度, 纬度]`。遗址使用 `Point`；水系、古道使用 `LineString` / `MultiLineString`；保护范围、影响区使用闭合 `Polygon` / `MultiPolygon`，支持内洞。

遗址属性支持 `name`/`名称`、`period`/`年代`、`site_type`/`遗址类型`、`location`/`地点`、`source`/`数据来源`。地形属性支持数值型 `elevation_m`（米）、`slope_deg`（0–90 度）、`aspect_deg`（0–360 度）、`tpi`（米）及 `terrain_source`、`precision_m`。无效值保持缺失，0 值不会被当成缺失。

GeoJSON 上限 15 MB、5,000 个要素、100,000 个线/面顶点；点数乘线段/面顶点数上限 500,000。大范围数据先在 QGIS、GeoStar 或 PostGIS 中裁剪。高斯模型上限 120 MB，普通点云/网格 PLY 不作为高斯模型接受。

内置五处具名点位坐标未经核验。贝尔神庙开放案例不关联这些点位；亭阁校验素材仅保留在内部，不在常规案例选择中展示。导入线图层不完整时，“最近距离”可能偏大。统计只描述当前样本，不证明古人选址偏好或因果关系。

## 真实遗产数据案例

贝尔神庙预览取自 [Open Heritage 3D / DOI 10.26301/zjnn-wx58](https://www.openheritage3d.org/project.php?id=zjnn-wx58)，署名 **Scott McAvoy / CHEI，2020，Open Heritage 3D 分发**。来源标注 **CC BY**，未注明许可版本。来源数据集包含 1,581 张影像；完整数据约 6.5 GB，经来源网站的下载流程获取。仓库不包含这些原始照片。

`public/samples/temple-of-bel.splat` 是 592,454 个真实 XYZ/RGB 点的 LOD 0–3 采样，约 18.1 MiB。为了复用查看器，它以固定半径的点精灵写入 SPLAT 容器；**它是摄影测量点云的显示衍生物，不是本项目训练的 3DGS 模型**。来源模型未标定尺度且存在局部变形，因此只用于浏览。详细署名、原始元数据、处理说明和 SHA-256 随文件提供；`node scripts/prepare-heritage-sample.mjs` 可从有界字节范围复现，无需下载完整八叉树。

新增 [印度之星号（Star of India）](https://www.openheritage3d.org/project.php?id=rebk-tb21) 338,580 点，来源 Scott McAvoy / UC San Diego Library，2020，CC BY（原记录未注明版本）；来源包含 1,079 张照片，仓库只包含 XYZ/RGB 点云的显示衍生物。用 `node scripts/prepare-heritage-sample.mjs star-of-india` 复现。两组模型截图均来自本地查看器实际渲染，详见 [样本来源说明](public/samples/README.md)。

长城与故宫照片来自 Wikimedia Commons 的 CC0 原图，作者、日期、原始链接及文件哈希见 [影像清单](public/heritage/sources.json)。公开点位的坐标来源见 `src/referenceSites.js`；慕田峪使用摄影位置，莫高窟使用敦煌研究院 2002 年定期报告的公开中心。均不是测绘成果或法定保护范围，未知高程与坡度不会补造。

**尚未实现**：直接处理 DEM 栅格、可视域计算、对照样本与推断统计、历史地貌重建、法定建设项目相交审批、照片自动训练、实测尺度与地理配准、服务器多人协作。地形值目前读取外部 GIS 预计算结果。三维训练须另行准备经授权的多视角照片、COLMAP 位姿与兼容的 CUDA/PyTorch 算力环境。

选型依据与后续接入步骤见 [开源技术路线](docs/open-source-roadmap.md)。

文旅与公众参与的功能建议、已实现范围和正式上线步骤见 [公众数字守护方案](docs/public-participation.md)。

## 本地运行

```sh
pnpm install
pnpm dev
```

完整验证：`npm ci` 后运行 `npm test`（也可使用 `pnpm test`），依次执行空间计算与项目回归测试、生产构建、Sites 交付文件检查。单独运行 `test:sites` 前需先运行 `build`。GitHub Actions 对推送和拉取请求运行相同检查。交付到 Sites 的构建保留 `dist/client`、`dist/server` 和 hosting 配置。三维库按页面延迟加载。
