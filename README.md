# 古址天眸 · 古遗址研究工作空间

本项目是可运行的浏览器 GIS 试点。地图使用 Leaflet 和 OpenStreetMap 底图，不需要地图 API Key。浏览器从 `tile.openstreetmap.org` 加载当前视野的瓦片；正式上线前应按访问规模选择稳定的瓦片服务或自建服务，并遵守 [OSM 瓦片使用政策](https://operations.osmfoundation.org/policies/tiles/)。如更换服务，可设置 `VITE_TILE_URL` 和 `VITE_TILE_ATTRIBUTION`。

## 当前可用流程

1. **遗址地图**：浏览 OpenStreetMap、遗址点位、水系、交通、保护范围和影响区，切换图层、定位全部遗址。
2. **遗址档案**：筛选名录、查看记录，并联动选址研究与三维档案。
3. **选址研究**：按聚落、防御、礼制研究问题切换因子；分时期/类型比较中位数与观测值。只有 `historical` 数据且时期名称与遗址一致，水系和交通距离才进入历史选址分析。线自身的 `period` 优先于图层时期。
4. **保护评估**：Turf 点落面核查、50–2,000 m 调查参考缓冲区、现场笔记和 GeoJSON/JSON 导出。调查参考区不是法定边界；点位未落入影响区不表示安全。
5. **三维档案**：GaussianSplats3D + Three.js 实际渲染 Gaussian PLY、SPLAT、KSPLAT；支持旋转、缩放、范围适配、上轴与背景调整，模型关联遗址并本地保存。
6. **数据中心**：五类 GeoJSON 图层、年代和来源信息、文件 SHA-256、项目 JSON 备份与恢复。

图层、来源和笔记保存在当前设备的 IndexedDB，不上传服务器；模型和采集清单按遗址另存。清除浏览器数据会删除这些存档。项目 JSON 备份包含图层和笔记，不包含三维模型或照片。照片登记只保存文件清单，不保存/上传照片内容。`public/templates/` 全部是明确标注的虚构格式模板，不能用于科研。

## 数据格式

使用 WGS84 / EPSG:4326 GeoJSON `FeatureCollection`，坐标顺序为 `[经度, 纬度]`。遗址使用 `Point`；水系、古道使用 `LineString` / `MultiLineString`；保护范围、影响区使用闭合 `Polygon` / `MultiPolygon`，支持内洞。

遗址属性支持 `name`/`名称`、`period`/`年代`、`site_type`/`遗址类型`、`location`/`地点`、`source`/`数据来源`。地形属性支持数值型 `elevation_m`（米）、`slope_deg`（0–90 度）、`aspect_deg`（0–360 度）、`tpi`（米）及 `terrain_source`、`precision_m`。无效值保持缺失，0 值不会被当成缺失。

GeoJSON 上限 15 MB、5,000 个要素、100,000 个线/面顶点；点数乘线段/面顶点数上限 500,000。大范围数据先在 QGIS、GeoStar 或 PostGIS 中裁剪。高斯模型上限 120 MB，普通点云/网格 PLY 不作为高斯模型接受。

内置五处具名点位坐标未经核验。三维默认亭阁是程序生成的标准高斯样例，不是真实遗址重建。导入线图层不完整时，“最近距离”可能偏大。统计只描述当前样本，不证明古人选址偏好或因果关系。

**尚未实现**：直接处理 DEM 栅格、可视域计算、对照样本与推断统计、历史地貌重建、法定建设项目相交审批、照片自动训练、实测尺度与地理配准、服务器多人协作。地形值目前读取外部 GIS 预计算结果。三维训练须另行准备经授权的多视角照片、COLMAP 位姿与兼容的 CUDA/PyTorch 算力环境。

选型依据与后续接入步骤见 [开源技术路线](docs/open-source-roadmap.md)。

## 本地运行

```sh
pnpm install
pnpm dev
```

验证：`pnpm test:geo`、`pnpm test:sites`、`pnpm build`。交付到 Sites 的构建保留 `dist/client`、`dist/server` 和 hosting 配置。三维库按页面延迟加载。
