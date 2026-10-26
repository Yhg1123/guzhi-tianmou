# 公开摄影测量显示样本

| 文件 | 来源 | 采样点数 | 署名 |
| --- | --- | ---: | --- |
| temple-of-bel.splat | [Temple of Bel，DOI 10.26301/zjnn-wx58](https://www.openheritage3d.org/project.php?id=zjnn-wx58) | 592,454 | Scott McAvoy / CHEI，2020；Open Heritage 3D 分发 |
| star-of-india.splat | [Star of India，DOI 10.26301/rebk-tb21](https://www.openheritage3d.org/project.php?id=rebk-tb21) | 338,580 | Scott McAvoy / UC San Diego Library，2020；Open Heritage 3D 分发 |

原记录标注 CC BY，未注明版本。每个样本的 `*-source.json` 提供原始元数据地址、字节数、SHA-256、变换和局限，`*-metadata.json` 保留上游元数据值（仅清理行尾空白）。

从 Potree LOD 0–3 解码真实 XYZ/RGB，居中并将 Z-up 转成 Y-up，以统一点半径写入 SPLAT 容器复用查看器。没有学习高斯协方差，没有运行照片训练；不能将它称为训练完成的 3DGS。未标定显示尺度，不能测量或直接地理配准。国际案例独立于本地所选中国遗址。

仓库不包含来源记录中完整的 1,581 张贝尔神庙照片或 1,079 张船舶照片。完整摄影数据须通过来源站点流程取得。

`temple-of-bel-preview.jpg` 和 `star-of-india-preview.jpg` 是当前本地查看器实际渲染上述数据后的截图，只裁切模型画布区域。它们不是 AI 生成图，也不是额外的实地摄影。

复现：`node scripts/prepare-heritage-sample.mjs`，或 `node scripts/prepare-heritage-sample.mjs star-of-india`。脚本验证有界 HTTP 范围响应后读取原 XYZ/RGB。哈希、坐标边界、点数和颜色的回归验证在 `tests/heritage-sample.test.mjs`。

`environment-weather-reference.json` 为 2026-10-26 本地实际请求 Open-Meteo 后导出的三个公开参考点天气模型快照，数据来源 [Open-Meteo](https://open-meteo.com/)，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。包括请求坐标、API 网格坐标、原时次和单位；只用于网络失败时的历史资料展示，不是实时观测或现场传感器数据。
