# Seem Kirke 训练高斯场景

作者 **roedsgaard**，来源 [Seem Kirke, Danmark / SuperSplat](https://superspl.at/scene/e832997f)，按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 再分发。作者以 DJI 无人机摄影、RealityScan 相机解算和 LichtFeld Studio 训练生成。本站未重新训练该场景。

`seem-church.splat` 保留全部 960,991 个训练高斯的位置、各向异性尺度、方向、DC 颜色及透明度。转换包括官方 SplatTransform 3.10.3 SOG 解码、180 度 X 轴坐标/四元数同步旋转，以及标准 SPLAT 量化。源高阶 SH 码本全零。模型仍有三维空间体积，不是单图反投影或不透明点云。

`seem-church-preview.webp` 为发布者预览；`seem-church-source.json` 包含许可、来源、源文件字节校验、模型/预览校验值和完整处理说明。导出时应保留署名、许可链接、来源和转换说明。

该场景与当前中国遗址档案独立，未进行本站测量标定或地理配准。灵岳寺模型使用其作者提供的公开嵌入，不在本目录中镜像。开发复现见 `docs/trained-gaussians.md`。
