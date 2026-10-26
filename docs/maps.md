# 地图接入

2026-10-26，按用户要求在腾讯位置服务账号中创建了“古址天眸”旅游类应用及“古址天眸-Web”Key。用户已单独确认创建 Key 所需的服务与隐私协议。未开通 WebService API、额外 SDK 或微信小程序产品，未购买商业授权或付费服务，未修改账号原有应用和 Key。

## 配置与使用

本地 `.env.local` 已配置 `VITE_MAP_PROVIDER=tencent` 和 `VITE_TENCENT_MAP_KEY`，实际 Key 不进入仓库。其他环境复制 `.env.example` 后自行配置；未配置 Key 时使用 OpenStreetMap。前端 `VITE_` 变量会进入构建产物，网页地图 Key 在浏览器可见，不是服务器密钥。账号登录凭据和 WebService 签名密钥不应放入前端环境变量。

配置腾讯 Key 时，三个地图页面默认采用腾讯卫星图，叠加路网文字以便辨认位置；可通过“底图”切换腾讯卫星图、腾讯标准图和 OpenStreetMap。在两种腾讯底图之间切换会保留当前视野与项目图层，遗址与保护地图初始聚焦所选点位附近。影像上的线面边界采用更明亮的颜色与较粗描边。卫星影像的采集和更新时次由图源决定，API 未提供本视野拍摄日期，不称为实时影像。

腾讯 SDK 连接超时、瓦片加载超时或 WebGL 上下文丢失后回退至 OpenStreetMap，并显示连接状态；切换腾讯底图时也重新检查加载超时。两种服务仍各自依赖网络；回退不代表底图保证可用。环境数据来源与刷新周期不随底图切换而改变。

腾讯控制台当前 Key 编辑页没有展示 JavaScript API GL 来源白名单字段，因此“本地开发”是本次用途描述，不代表 Key 已限制到 localhost。正式公开上线前应核对届时的来源限制、账号额度、适用授权和服务条款；本次没有配置生产域名、地理编码、导航或公共上传后台。新 Key 的服务 API 配额提示不等同于网页底图不可用，网页地图已在本地实际加载核验。

## 坐标与数据

项目导入、存档、Turf 距离/落面/缓冲计算和 GeoJSON 导出始终采用 WGS84 / EPSG:4326，`[经度, 纬度]`。腾讯底图使用 GCJ-02，渲染器通过 MIT 开源包 `coordtransform@2.1.2` 创建显示副本，再传给纬度在前的 `TMap.LatLng`。原始对象不被修改；线、面内洞、MultiPolygon 层次保持一致。

此转换为开源近似算法，仅用于底图对齐，不用于测绘或精度认证。原始位置不准仍然不准。地图控件悬停可见简短坐标说明；档案中的坐标精度和来源继续保留。使用腾讯地图会加载第三方 SDK，并向腾讯请求当前视野地图；项目文件仍在本设备存档。

## 点位标记

腾讯与 OSM 共用矢量定位针：遗址使用建筑符号，普通点位为浅色，选中点为深绿色；选中或悬停/键盘聚焦时显示名称牌。定位针尖端对齐显示坐标，名称牌根据可用空间调整方向，避开地图边缘与图层面板。标记颜色只区分交互状态，不表示风险或坐标精度。

环境点位使用温度计/水滴符号，并保持温湿度图例的数值颜色；名称牌同时显示点位名称与读数或过期状态。点位和读数的数据来源、时间及缺失规则不变。

## 官方及开源依据

- [腾讯基础入门与坐标说明](https://lbs.qq.com/webApi/javascriptGL/glGuide/glBasic)：JavaScript API GL 创建 Key 后可直接使用，无须勾选其他产品。
- [地图与事件](https://lbs.qq.com/webApi/javascriptGL/glDoc/docIndexMap)、[线面覆盖物](https://lbs.qq.com/webApi/javascriptGL/glDoc/glDocVector)、[DOM 点位覆盖物](https://lbs.qq.com/webApi/javascriptGL/glDoc/glDocDomOverlay)、[控件](https://lbs.qq.com/webApi/javascriptGL/glDoc/glDocControl)。
- [coordtransform 原作者仓库与转换参考值](https://github.com/wandergis/coordtransform)。自动回归验证北京参考坐标、境外/零值、面内洞与多面结构，以及转换后计算和备份仍保留 WGS84。
