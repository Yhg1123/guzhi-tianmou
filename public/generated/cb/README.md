# 本机训练的建筑高斯模型

本目录由古址天眸在本机使用原始多视角照片实际训练生成，不是第三方成品模型或外站播放器的镜像。

原始摄影、相机参数与语义标注：Eugenio Pellis、Andrea Masiero、Michele Betti、Grazia Tucci、Pierre Grussenmeyer，Images&PointClouds Cultural Heritage Dataset，2025，[DOI: 10.5281/zenodo.14626611](https://doi.org/10.5281/zenodo.14626611)。许可：[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。生成模型及展示筛选属于基于该数据的派生处理；使用时请保留原始数据作者、来源、许可和本机处理说明。

- `raw-model.ply`：本机训练检查点的完整原字节，400,000 个高斯；保留全部学习参数和一阶球谐颜色。
- `model.ply`：仅剔除透明度低于 0.015 或超大尺度浮点的展示版；保留记录参数逐字节不变。
- `kept-indices.bin`：展示版对应原模型的 uint32 小端索引，便于核验没有新增几何。
- `source.json`：全部来源、输入哈希、预处理、相机、三角化、筛选与输出哈希。
- `training.json`、`training.txt`：真实本机运行记录与日志。图像验证指标不是测量精度。
- `photos/`、`validation/`：原片缩略图和保留视角对照。模型几何不通过这些静态图片展示，而由本地 PLY 实时渲染。

源场景为意大利托斯卡纳的 `5_CB` 建筑，不对应当前中国项目中的大明宫或咸阳。遮挡、边缘浮点和未知区域不代表真实破损或专业测绘结论。查看器会进一步过滤透明度不高于 5/255 的点，因此已加载数量可能低于文件记录数。

训练引擎：[Brush 0.3.0](https://github.com/ArthurBrussee/brush/releases/tag/v0.3.0)，Apache-2.0；在本机 RTX 3050 Laptop GPU 上运行。完整开发流程见仓库 `docs/local-gaussian-generation.md`。
