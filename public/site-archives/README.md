# 遗址照片高斯档案

本目录收录 8 处遗址相关的照片高斯预览、9 张开放原始照片（其中故宫、长城原图复用 `../heritage/`）、生成的相对深度图及缩略图。`catalog.json` 是完整来源与处理清单，`sources.json` 保留照片元数据。

## 资料与许可

| 档案 | 实际影像内容 | 作者 | 原照片及衍生资产许可 |
| --- | --- | --- | --- |
| banpo | 半坡博物馆入口 | CEphoto, Uwe Aranas | CC BY-SA 3.0 |
| banpo 补充影像 | 半坡聚落遗迹展厅 | eecc | Public domain |
| xianyang | 咸阳宫一号宫殿建筑复原陈列模型 | 猫猫的日记本 | CC BY-SA 3.0 |
| fenghao | 丰镐出土西周刻辞甲骨 | Gary Todd | CC0 |
| yangling | 汉阳陵封土实景 | Brücke-Osteuropa | Public domain |
| daming | 大明宫宫殿群陈列模型 | xiquinhosilva | CC BY 2.0 |
| forbidden-city | 北京故宫宫殿院落 | Kaap bij Sneeuw | CC0 |
| mutianyu | 慕田峪长城实景 | Velatrix | CC0 |
| mogao | 莫高窟崖壁与窟室外观 | Flickr user: eviltomthai | CC BY 2.0 |

每张照片的 Commons 文件页、原始下载地址、作者、许可链接、拍摄日期、尺寸及 SHA-256 均见清单。原始 JPEG 字节保持不变。各 `.splat`、`-preview.jpg`、`-depth.png` 是对应首张照片的衍生资产，沿用该照片许可（包括 CC BY-SA 3.0 的相同方式共享要求）。缩略图经 EXIF 方向纠正、RGB 转换与缩小；深度图和高斯文件经过下述推断与转换。

## 生成方法与边界

使用官方 Depth Anything V2 Small / ViT-S（Apache 2.0）在本机 CPU 推断单图相对深度，按第 2/98 百分位归一化，再反投影生成标准 32 字节 SPLAT：XYZ、各向异性尺度、RGBA、wxyz 四元数。每个像素生成一个有方向和厚度的高斯点，保留照片颜色。深度图越亮表示相对越近。代码与模型版本、参数及校验值均在 `catalog.json`。

**这不是多视角 3DGS 训练、完整遗址模型或考古修复成果。** 单张照片只能支持可见面的空间推断，背面与遮挡部分未知。焦距是假定值，长度是任意相对单位，无米制尺度、地理配准或测量精度。陈列模型与出土器物不能代表整个遗址。档案关联项目点位只用于导航，不表示高斯坐标已配准到地图。拍摄日期不表示当前现场状态。

前端默认打开原始视角，限制转动与平移，不提供虚构的背面。用户导入的匹配模型优先于内置照片预览。外部国际点云案例仍须主动选择，不能替代本遗址档案。

生成器与复现说明见仓库 `scripts/build-photo-gaussians.py` 和 `docs/photo-gaussian-archives.md`。推断模型的 Apache 2.0 许可原文附于 `Depth-Anything-V2-LICENSE.txt`；模型权重与 Python 运行环境不随网站分发。
