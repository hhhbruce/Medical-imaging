# NEXUS 医学影像平台（Medical-imaging）

> Local self-hosted AI medical imaging platform — DICOM management, interactive AI segmentation, multimodal VLM reporting, and multi-agent consultation, all in the browser.

面向放射科的**本地化医学影像 AI 平台**，打通「DICOM 影像管理 → 交互式智能分割 → 多模态大模型报告 → 多智能体会诊」的完整临床工作流。全部组件自托管（self-hosted），不依赖云端 SaaS，适合医院内网部署与数据合规场景。前端基于 [OHIF Viewer](https://ohif.org/)，后端基于 [MONAI Label](https://monailabel.readthedocs.io/)。

```
浏览器（OHIF Viewer / NEXUS 主页）
   │  /pacs/*  ──────────────►  Orthanc PACS（DICOM 存储 + DICOMWeb）
   │  /monai/* ──────────────►  MONAI Label 服务器（AI 推理，GPU）
   │                              │
   │                              ├─► vLLM / 云端 VLM API（报告生成）
   │                              └─► nnInteractive / SAM2.1 / MedSAM2 / SAM3 / VoxTell（本地 GPU 分割）
```

---

## ✨ 核心功能

- **交互式 3D 医学影像分割** — 视觉提示（正/负点、正/负框、涂抹、套索）与文本提示；默认模型 **nnInteractive**（支持多用户并发会话池 + GPU 锁），备选 **SAM2.1 / MedSAM2 / SAM3**（点击式）与 **VoxTell**（自由文本提示）。一次提示自动向全 3D 体数据传播，支持 Live Mode 实时推理、Undo、多分段叠加、画笔/橡皮手工修正。
- **多模态 VLM 影像报告** — 一份界面聚合 8 种以上后端：本地 **MedGemma**（GPU 推理）、云端 **Gemini / GPT / Claude**、Hugging Face 路由（**Kimi / Qwen / Gemma**）、自托管 **vLLM**（InternVL / Qwen / Kimi 等，见 `vllm/`），以及任意 OpenAI/Anthropic 兼容端点。支持起止切片范围、双语提示词、思考级别（Gemini thinking / OpenAI reasoning / vLLM thinking）。
- **多智能体会诊（MAS）** — 16 种会诊策略（Debate、MDAgents、MDTeamGPT、Discussion、ReConcile、MetaPrompting、AutoGen、DyLAN、MedAgents、ColaCare 等），浏览器中实时回放医生图（AgentFlowViz），支持断点续传与协作式取消。详见 [`docs/mas-agent-module.md`](docs/mas-agent-module.md)。
- **全链路可观测** — 每步推理的耗时分解（网络往返、DICOM 下载、图像转换、模型核心、结果回传）随响应返回并在前端展示。
- **平台主页与 3D 图谱** — `landing/` 提供离线自足的中文主页（Three.js 本地化三维场景），聚合系统全部入口，另有基于 BodyParts3D 的交互式 3D 人体图谱。

---

## 🏗️ 整体架构

### 生产拓扑（Docker Compose）

| 服务 | 构建来源 | 端口 | 职责 |
|------|----------|------|------|
| `ohif_viewer` | `Viewers/`（Nginx） | **1025**（SSL）/ **1026**（Web） | OHIF Viewer 前端 + 反向代理（`/pacs/`→Orthanc、`/monai/`→MONAI） |
| `orthanc` | `jodogne/orthanc-plugins` | **4242**（DICOM）/ **8042**（HTTP） | PACS：DICOM 存储 + DICOMWeb/REST |
| `monai_server` | 仓库根（NVIDIA runtime，GPU 0,1） | **8002** | MONAI Label：分割推理、VLM 报告、MAS 会诊 |

- Nginx（`Viewers/platform/app/.recipes/Nginx-Orthanc/config/nginx.conf`）配置 `client_max_body_size 500M`、`/monai/` 代理读超时 2400s、`proxy_request_buffering off`。
- `monai_server` 通过 `host.docker.internal` 访问宿主机上的 vLLM（`VLLM_BASE_URL` 默认 `http://host.docker.internal:8000/v1`），`shm_size: 10gb`。
- 目录挂载：模型权重 `monai-label/checkpoints/`、预测输出 `monai-label/predictions/`、numpy 影像缓存 `img_cache/`、DICOM 下载缓存 `volumes/root-cache/`。

### 本地开发拓扑（Windows，`scripts/start-dev.ps1`）

| 服务 | 端口 | 说明 |
|------|------|------|
| 主页 | **8791** | `landing/` 静态页（`python -m http.server`），所有入口出发点 |
| 人体图谱 | **5173** | `landing/landing/` Vite 应用，交互式 3D 解剖图谱 |
| 研究空间 | **3000** | `Viewers/` rsbuild dev（OHIF + `/pacs`、`/monai` 代理） |
| 后台（生产前端） | **1026** | docker `ohif_viewer` |
| Orthanc | **8042** | docker（同生产） |
| MONAI Label | **8002** | conda 环境原生运行（`PYTHONPATH` 指向 `monai-label/`） |

一键启动见 [`docs/backstart.md`](docs/backstart.md)。

---

## 📂 目录结构

```
Medical-imaging/
├── docker-compose.yml          # 三服务生产拓扑
├── start.sh                    # Linux 一键启动（模型懒加载选择 + 增量构建）
├── .env-sample                 # 环境变量模板（复制为 .env 后填写）
├── Viewers/                    # OHIF Viewer 前端（React 18 / TS / Cornerstone3D）
│   └── platform/app/.recipes/Nginx-Orthanc/   # Nginx + Orthanc 部署配方
├── monai-label/                # MONAI Label 服务器（Python）
│   ├── monailabel/tasks/infer/basic_infer.py   # 推理任务入口（nninter 路由 + VLM 管线）
│   ├── monailabel/tasks/infer/mas_inference.py # MAS 工作流 + 运行注册表 + 检查点
│   ├── monailabel/tasks/infer/orchestration/   # MAS 编排引擎（自研，标准库实现）
│   ├── monailabel/tasks/infer/nninter_session_pool.py  # nnInteractive 多用户会话池
│   ├── sample-apps/radiology/  # radiology 应用（模型注册）
│   ├── checkpoints/            # 模型权重目录
│   └── Dockerfile
├── landing/                    # 平台中文主页（静态，离线自足）+ 3D 人体图谱
├── vllm/                       # 自托管 vLLM 启动脚本（qwen/internvl/kimi/gemma）
├── sam2/                       # SAM2 源码（参考/工具）
├── sample-data/                # 示例 DICOM 数据
├── scripts/                    # start-dev.ps1（Windows 一键启动）、download_weights.sh
├── docs/                       # 项目文档（总览、启动、MAS 模块等）
└── LICENSE                     # Apache-2.0
```

---

## 🚀 快速开始

### 方式一：Docker Compose（Linux + NVIDIA GPU）

**前置条件**：Docker + Compose 插件、NVIDIA Container Toolkit、NVIDIA GPU 驱动、CUDA 12.6 兼容环境。

```bash
git clone https://github.com/hhhbruce/Medical-imaging.git
cd Medical-imaging

# 1. 配置密钥（HF_TOKEN 等，可选）
cp .env-sample .env
# 编辑 .env 填入使用的 provider 密钥

# 2. 一键启动（自动下载 SAM2.1/MedSAM2 权重；按需选择可选模型启动时加载）
bash start.sh          # 交互式询问每个可选模型
# 或 bash start.sh -n  # 全部懒加载（更快启动，首次使用时才加载）
# 或 bash start.sh -y  # 全部启动时加载
```

`start.sh` 支持模型懒加载（`LOAD_SAM2/LOAD_MEDSAM2/LOAD_VOXTELL = eager|lazy`），并通过内容哈希做增量构建——只重建发生变更的服务。

**访问入口**：
- 查看器：<http://localhost:1026>（生产后台，1025 为 SSL）
- PACS：<http://localhost:8042>（Orthanc Explorer）
- 示例数据：上传 `sample-data/` 下的全部 DICOM 文件后即可开始分割

### 方式二：本地开发（Windows）

```powershell
cd "D:\Smart City\Medical-imaging"
powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1
# -WithMonai 额外启动 MONAI Label；-WithWorkbench 额外启动 docker 后台；-Stop 停止开发服务
```

详细步骤（Orthanc → MONAI Label → OHIF 开发前端的启动顺序、环境变量）见 [`docs/backstart.md`](docs/backstart.md)。

---

## 🔑 环境变量（`.env`）

复制 `.env-sample` 为 `.env`（已被 gitignore，切勿提交真实密钥），Docker Compose 会自动读取并注入 `monai_server`：

| 变量 | 用途 |
|------|------|
| `HF_TOKEN` | Hugging Face 鉴权：MedGemma 等权重下载 + Kimi/Qwen/Gemma 路由 |
| `GEMINI_API_KEY` | Gemini VLM（Google AI Studio） |
| `OPENAI_API_KEY` | GPT 等 OpenAI 模型 |
| `ANTHROPIC_API_KEY` | Claude |
| `VLLM_BASE_URL` | 自托管 vLLM 地址（默认 `http://host.docker.internal:8000/v1`） |
| `NNINTER_MAX_SESSIONS` | nnInteractive 并发会话数（默认 10，LRU 淘汰） |
| `NNINTER_SESSION_IDLE_TIMEOUT` | 空闲会话回收秒数（默认 600） |

---

## ⚙️ 模型权重

| 模型 | 获取方式 |
|------|----------|
| nnInteractive | 自动下载（Hugging Face） |
| SAM2.1（hiera-tiny）/ MedSAM2 | `scripts/download_weights.sh` 自动下载至 `monai-label/checkpoints/`（`start.sh` 会自动触发） |
| SAM3 | 需在 HF 申请访问权限，手动放置 `sam3.pt` 到 `monai-label/checkpoints/` |
| VoxTell | 自动下载；文本编码器可用 `scripts/download_qwen_embedding.py` 预下载到本地 |
| MedGemma（本地报告） | 经 `HF_TOKEN` 鉴权自动下载（1.5–4B / 27B，27B 需较多显存） |

> 未找到 SAM3 权重时仅提示告警，其余分割模型与报告功能不受影响。

---

## 📄 文档

- [`docs/project-overview.md`](docs/project-overview.md) — 项目总览与技术栈
- [`docs/backstart.md`](docs/backstart.md) — 本地开发启动指南（Windows）
- [`docs/basic-viewer-user-guide.md`](docs/basic-viewer-user-guide.md) — 查看器使用说明
- [`docs/mas-agent-module.md`](docs/mas-agent-module.md) — 多智能体会诊模块深度解析
- [`docs/agents-architecture.md`](docs/agents-architecture.md) — MedMASLab 参考框架说明

---

## 📚 致谢与引用

本项目的分割与报告能力建立在以下开源工作之上：**OHIF Viewer**、**nnInteractive**（MIC-DKFZ）、**SAM2 / SAM3**（Meta）、**MedSAM2**（Bowang Lab）、**VoxTell**（MIC-DKFZ）、**MedGemma**（Google Health）、**MONAI Label**、**vLLM**、**Orthanc**。MAS 策略移植自 **MedMASLab** 论文实现（`MedMASLab-main/`，同级参考仓库）。

若用于研究，请参阅对应论文：

- OHIF-SAM2: Accelerating Radiology Workflows with Meta Segment Anything Model 2（IEEE ISBI 2025）
- nnInteractive: Redefining 3D Promptable Segmentation（[arXiv:2503.08373](https://arxiv.org/abs/2503.08373)）
- SAM 2: Segment Anything in Images and Videos（[arXiv:2408.00714](https://arxiv.org/abs/2408.00714)）
- MedSAM2: Segment Anything in 3D Medical Images and Videos（[arXiv:2504.03600](https://arxiv.org/abs/2504.03600)）
- SAM 3: Segment Anything with Concepts（[arXiv:2511.16719](https://arxiv.org/abs/2511.16719)）
- VoxTell: Free-Text Promptable Universal 3D Medical Image Segmentation（[arXiv:2511.11450](https://arxiv.org/abs/2511.11450)）

---

## 📃 License

[Apache-2.0](LICENSE)
