# 本机照片到 3D Gaussian Splatting

2026-10-29：按用户“自己生成”的要求，工作区退出第三方成品场景与外站播放器。当前 `local-cb` 是在用户电脑的 RTX 3050 Laptop GPU 4GB 上实际训练的模型，由本站查看器读取本地 PLY；不是嵌入 SuperSplat，也不是单张照片的深度表面。

## 输入与归属

- 输入为 Pellis、Masiero、Betti、Tucci、Grussenmeyer 的 **Images&PointClouds Cultural Heritage Dataset** 中 `5_CB` 场景的 **166 张原始照片**、相机内外参数及建筑语义标注。地点按论文记录为意大利托斯卡纳，页面使用“托斯卡纳穹顶建筑”，不推断未核实的具体建筑名称。
- 原始发布：[Zenodo 14626611](https://zenodo.org/records/14626611)，许可 **CC BY 4.0**；论文：[10.1016/j.dib.2025.111661](https://doi.org/10.1016/j.dib.2025.111661)。为逐文件获取原片，使用 heig-vd-geo 的 Hugging Face 镜像，固定修订 `0a15cffbf0c0ab505b4844f88bdbbfcc494e17d9`，校验每张原片、标注的 LFS SHA-256。
- 公开相机位姿来自来源数据，不宣称在本站重新解算了全部相机。**几何初始化由本机匹配特征和三角化得到，未使用来源的成品高斯或已完成点云，也未使用单目深度推断。**
- 本机完成 SIFT 匹配、几何初始化、Gaussian 优化、留出图像比较和模型导出。原片版权、相机参数和标注来源与本机生成步骤分别记录。
- 该场景是独立输入资料，不对应大明宫、咸阳或其他中国遗址。地图的明确 `site` 链接仍只加载其原档案；不把此模型挂到无关遗址名下。

## 实际生成过程

1. 去畸变与缩小：按来源相机矩阵和畸变系数处理 RGB、标注，准备最长边 960 的训练资料，训练器进一步加载到 768。
2. 建筑损失掩膜：保留来源标注 0–9 类，10 类未知/背景不参与训练损失，边缘缩进一个处理像素。**未知标注不是物理空洞，因此用独立 loss mask，不强制未知像素透明。**
3. 每第八张照片保留作验证，共 **146 张训练、20 张验证**。保留照片不参与特征三角化或训练优化；来源的相机位姿仍保留。
4. 在训练照片中匹配 SIFT，结合公开位姿三角化。要求两相机正深度、重投影误差小于 1.5 处理像素、射线夹角大于 1°，排除远距离群匹配，空间去重后得到 **17,441 个本机初始化点**。
5. 使用开源 [Brush 0.3.0](https://github.com/ArthurBrussee/brush/releases/tag/v0.3.0) 在本机 Vulkan 后端运行，实际完成 **12,000 步**，最大 **400,000 个高斯**，SH degree 1。引擎是开源工具，生成的模型由本次本机优化得到；不是第三方训练成品。
6. 保留每千步导出与原始训练日志。按保留视角的建筑标注有效区域 PSNR 选版本，本次导出第 **10,000 步**。这是验证集选型，不能当独立测试集成绩或测量精度。
7. 原样保留选定 Gaussian PLY 为 `raw-model.ply`，包括学得的位置、各向异性尺度、四元数、透明度、DC 与一阶球谐颜色；没有转成等大小 RGB 采样点。
8. 展示版保守剔除透明度低于 0.015、或最大一倍标准差尺度超过初始化参考半径 10% 的超大浮点。每个保留高斯的原始 92 字节参数不变，没有新增表面或补造背面。保留索引及哈希用于逐条核对；页面可切换训练原版，完整训练文件仍可下载。这个筛选是视觉清理，不能当成统计置信度或测量判据。

## 核验与文件

- 完整训练模型：`public/generated/cb/raw-model.ply`，**400,000 个高斯，36,800,652 字节**。
- 完整训练模型 SHA-256：`8b592e225381155c2394b204a21e58c5b8dcde91da28187cf9003e8ff54afe1c`。
- 展示模型：`public/generated/cb/model.ply`，筛选后的数量及 SHA-256 见来源清单；索引为 `kept-indices.bin`。
- 完整来源、相机、特征匹配统计、全部照片和标注校验值：`public/generated/cb/source.json`。
- 训练进程、引擎哈希、参数、真实起止时间、每个检查点和验证历史：`public/generated/cb/training.json`。
- 原始本机训练日志：`public/generated/cb/training.txt`。
- 前端轻量索引：`src/localGaussianCatalog.json`。该索引仅由已完成运行的打包脚本生成。
- 实际原片、初始化、所有中间模型和验证图保留在忽略的 `qa/local-training/cb/`，不把约 1.9 GB 的照片或原生训练器提交到 Git。

建筑区域 PSNR 由打包脚本逐张读取模型导出的验证渲染，用 Pillow 双线性将参考 RGB 和标注掩膜缩至渲染分辨率，在掩膜 ≥254 的像素上计算 RGB MSE，再对 20 个视角的 PSNR 求平均。本次所选版本为约 **18.28 dB**。Brush 原生整图指标包含未训练背景，另行保留，不混称为同一个指标。边缘仍有浮点、模糊与遮挡缺口，此输出不代表完整测绘或结构修复成果。

导航相机使用外部宽视角光轴的共同焦点和本机初始化点的稳健半径取景。它是查看器的环绕中心，不是测量控制点。查看器保留实际空间操作、键盘导航、全屏及原项目返回上下文。

## 复现

使用 Python 3.12 与 `scripts/local-training-requirements.txt` 中的固定依赖。当前电脑的独立 Python 为 `qa/model-runtime/Scripts/python.exe`；不修改系统 Python。按顺序运行以下开发脚本：

```powershell
./scripts/install-local-trainer.ps1
./scripts/fetch-local-training-data.ps1
./scripts/fetch-local-training-labels.ps1
./qa/model-runtime/Scripts/python.exe scripts/prepare-local-training.py --output qa/local-training/cb/prepared-architecture --max-side 960
node scripts/train-local-gaussians.mjs
./qa/model-runtime/Scripts/python.exe scripts/package-local-gaussians.py
npm test
```

训练器来自作者正式发布的 Windows 包，归档 SHA-256 固定为 `b68e3e9cf052d51bf3ee30776fa5a364de7f2ba13b58443128ff797bb7bcfcd6`。安装脚本先核对哈希再解压，依赖放在 `qa/`。运行不需要 CUDA/PyTorch 编译环境，也不使用付费服务。训练脚本拒绝混入已有训练输出，重新实验前应保留并单独整理旧运行。

这些脚本面向当前这套已校验的开放数据。社区投稿和“采集清单”仍没有任意照片一键训练的 Web 接收服务；照片来源、相机解算、覆盖、存储和权限流程还需对应接入，不能把本次固定数据流程说成通用云训练已上线。
