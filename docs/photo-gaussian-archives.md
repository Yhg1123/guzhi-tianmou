# 遗址照片高斯预览与复现

2026-10-27：将已有 8 处遗址档案补充为可直接浏览的照片高斯预览。选用可再分发的 Wikimedia Commons 照片，逐项核验题材与授权；未将搜索命中但地点不符的“Fenghao House”等资料混入丰镐档案。咸阳与大明宫的题材明确为复原陈列模型；丰镐为出土甲骨；半坡为博物馆入口，另保留遗迹展厅照片。故宫与长城沿用已收录原图，避免重复下载。

## 数据与本机生成

- 输入清单：`scripts/site-archive-sources.json`。
- `scripts/fetch-site-photos.ps1 -PrimaryOnly` 用官方 Commons API 读取元数据并下载首选照片；已有补充照片会保留。省略该选项可逐一获取配置中的额外照片。请求遇到 HTTP 429 时按 Retry-After 等待，不使用代理、证书绕过或批量抓取受限网页。校验原文件长度、来源 SHA-1（若为十六进制）和本地 SHA-256。
- `public/site-archives/sources.json`：当前实际收录的照片元数据；`catalog.json`：模型、照片、深度及处理过程的完整清单。
- 生成器同时写出内容一致的 `src/siteArchiveCatalog.json` 供前端静态导入，避免从 Vite 的 public 目录导入 JS/JSON 模块；自动检查保证两份清单一致。
- 生成器：`scripts/build-photo-gaussians.py`。逐张校验输入照片后运行 Depth Anything V2 Small，再反投影并编码为各向异性高斯点。没有拼凑不一致的相机视角、补造背面或进行多视角训练。
- 依赖：Python 3.12，固定版本见 `scripts/photo-gaussians-requirements.txt`。本次使用独立的 `qa/model-runtime`，未修改系统 Python；PyTorch 2.5.1+cpu，推断限制为 4 线程。

## 复现步骤（开发环境）

1. 在独立 Python 环境安装 requirements；CPU 环境可从 PyTorch 官方 CPU wheel 索引安装 torch 2.5.1、torchvision 0.20.1。
2. 克隆 [Depth Anything V2 官方仓库](https://github.com/DepthAnything/Depth-Anything-V2)，检出 `a561b849ebae10a6f5ef49e26c83cbbcd36c71bf`。默认目录为 `qa/depth-anything-v2`，也可通过 `--depth-repo` 指定。
3. 下载 [官方 Small 权重](https://huggingface.co/depth-anything/Depth-Anything-V2-Small/resolve/main/depth_anything_v2_vits.pth) 到该目录的 `checkpoints/depth_anything_v2_vits.pth`。SHA-256 必须为 `715fade13be8f229f8a70cc02066f656f2423a59effd0579197bbf57860e1378`；生成器拒绝不匹配权重。仅 Small 模型使用 Apache 2.0，勿替换为不同许可的其他大小权重。
4. 已保留原始照片时直接执行 `python scripts/build-photo-gaussians.py`。需要重新获取照片元数据时，先运行上述 PowerShell 脚本。生成器默认最长边 512 像素，推断输入 518；CPU 上一次只加载一个模型、依次处理照片。
5. 执行 `npm test`，确认文件校验、SPLAT 结构、正尺度、单位四元数、非平面深度、来源许可、遗址身份匹配和网站构建均通过。在浏览器中对照原始视角、微转、原图及深度图，检查视觉效果。

随机数与模型实现/平台差异可能带来微小浮点差异；`generatedAt` 每次更新，不能承诺跨平台字节完全一致。权重和运行环境留在被忽略的 `qa/` 中；网站只分发静态资产，不在用户浏览器中运行深度推断，不向外发送项目照片。

## 显示与模型优先级

`findSiteArchive()` 同时匹配规范遗址 ID、原坐标快照与展示名称。坐标变化、同 ID 的其他遗址或未知导入记录不会继承内置模型。匹配的用户本地模型优先，仍按既有 IndexedDB 逻辑保存；内置预览从本地静态文件读取，不写入或覆盖 IndexedDB。

源照片重投影使用假定焦距 `0.95 × max(width,height)`；归一化逆深度 d 转为任意相对深度 `1.4/(0.7+0.6d)`。初始视角保持来源投影比例，允许有限微转、缩放；没有 360 度自动旋转或上轴翻转。来源原图、深度图、作者、日期、许可、模型下载与处理清单均可从档案页访问。

完整的照片实景重建仍需同一目标的连续、多高度、多方位原片、相机位姿解算、训练、覆盖检验和必要尺度校核。本次交付让已有档案可浏览，不将单图空间推断描述成完整现场重建。

## 本轮验证

`npm test` 共通过 61 项检查（57 项领域/数据检查与 4 项 Sites 检查），生产构建保留 Sites 所需三份输出。浏览器逐一打开 8 处档案，均加载对应高斯文件；验证了微转、照片/深度切换和来源清单下载。独立本地测试端口验证用户导入模型优先、刷新保留、其他遗址隔离，390 px 布局无横向溢出。主预览刷新后无控制台错误。只有既有 GIS/三维库的大包体积构建提示。
