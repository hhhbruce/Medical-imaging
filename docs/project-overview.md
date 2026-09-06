# NEXUS 医学影像平台 — 项目总览

> 本文档是整个 `Medical-imaging/` 项目的顶层说明：项目定位、核心亮点、功能清单、整体架构与技术栈。
> 相关文档：[`backstart.md`](./backstart.md)（本地启动指南）、[`basic-viewer-user-guide.md`](./basic-viewer-user-guide.md)（查看器使用）、[`mas-agent-module.md`](./mas-agent-module.md)（多智能体模块深度解析）、[`504-timeout-investigation.md`](./504-timeout-investigation.md)（504 超时排查报告）、[`agents-architecture.md`](./agents-architecture.md)（MedMASLab 参考框架说明）、[`frontend-design.md`](./frontend-design.md)（前端设计语言）。

---

## 1. 项目定位

一套面向放射科的**本地化医学影像 AI 平台**，打通「DICOM 影像管理 → 交互式智能分割 → 多模态大模型报告 → 多智能体会诊」的完整临床工作流。全部组件自托管（self-hosted），不依赖云端 SaaS，适合医院内网部署与数据合规场景。

```
浏览器 (OHIF Viewer)
   │  /pacs/*  ──────────────►  Orthanc PACS（DICOM 存储 + DICOMWeb）
   │  /monai/* ──────────────►  MONAI Label 服务器（AI 推理，GPU）
   │                              │
   │                              ├─► 上游 LLM / vLLM（自托管 :8000 或云端 API）
   │                              └─► nnInteractive / SAM2 / MedSAM2 / SAM3 / VoxTell（本地 GPU）
```

## 2. 核心亮点

1. **交互式 3D 医学影像分割**：nnInteractive 会话池支持多用户并发（共享一份 GPU 权重、按会话隔离交互状态），配合正/负点击、框选、涂抹、套索、文本提示等全部交互类型；SAM2 / MedSAM2 / SAM3 / VoxTell 提供点击式与文本提示式分割备选。
2. **多模态 VLM 报告生成**：一份界面聚合 8 种以上 VLM 后端 —— MedGemma（本地 GPU）、Gemini、GPT（OpenAI）、Claude、Kimi、Qwen、Gemma、自托管 vLLM（InternVL/Qwen/Kimi/Gemma recipe）、任意用户自配 OpenAI/Anthropic 兼容端点。
3. **多智能体会诊（MAS）**：16 种会诊策略（Debate、MDAgents、MDTeamGPT、Discussion、ReConcile、MetaPrompting、AutoGen、DyLAN、MedAgents、ColaCare 等论文方法 + 自研临床面板），由声明式编排引擎执行，医生图（doctor graph）数据流在浏览器中逐事件回放。
4. **工程可靠性设计**：上游 504/超时的阶梯重试与输出预算爬升、中文输出规范、思考块剥离、空回复恢复；会诊失败保留中间意见 + 磁盘检查点**断点续传**（重发同一请求只重跑失败节点）；新会话开始时协作式取消旧会话停止烧 token。
5. **全链路可观测**：每步推理的耗时分解（网络往返、DICOM 下载、图像转换、提示准备、模型核心、结果回传）随响应返回并在前端展示；MAS 运行通过 `/mas/runs/{run_id}` 实时轮询，事件流逐条推送到弹窗。
6. **一键启动的开发体验**：`scripts/start-dev.ps1` 拉起 Orthanc → 主页（:8791）→ 研究空间（:3000），`-WithMonai`/`-WithWorkbench` 可选启动 MONAI Label 与 docker 后台。

## 3. 功能清单

### 3.1 影像查看与管理
- OHIF Viewer 研究列表、MPR/3D 视口（Cornerstone3D）、窗宽窗位、测量工具。
- Orthanc PACS：DICOM 存储（4242）+ DICOMWeb/REST（8042），数据持久化于 `volumes/orthanc-db/`。
- 研究空间左上角 NEXUS logo 返回主页；`landing/` 静态主页聚合所有入口。

### 3.2 交互式分割（MONAI Label :8002）
- `nninter` 参数路由：`nnInteractive`（默认）、`sam2`、`medsam2`、`sam3`、`voxtell`（文本提示）。
- nnInteractive 会话池：`NNINTER_MAX_SESSIONS`（默认 10）并发会话，LRU 淘汰 + 空闲回收（默认 600s），全局 GPU 锁保证单卡串行前向；权重只加载一份，N 个会话共享引用。
- 交互提示：正/负点、正/负框、涂抹、套索、文本提示；提示可显隐（铅笔开关）、undo/reset/show-prompt 热键。
- 分割结果以 DICOM SEG / NIfTI 返回并写回 PACS；逐请求返回耗时分解。

### 3.3 VLM 影像问答与报告
- `basic_infer.py` 的 `_NNI_VLM_OPS`：`medGemma`、`gemini`、`openai`、`claude`、`kimi`、`qwen`、`gemma`、`vllm`、`custom`、`mas` —— 全部走同一「取层 → 归一化 → 组装多模态消息 → 调用 → 中文报告」管线，支持起止切片范围选取。
- 切片准备：`_vlm_prepare_medical_slices` 按请求的 `startSlice`/`endSlice` 选层并转成 JPEG data URL；图像缓存避免重复 sitk 转换。
- 结果面板支持 Markdown 渲染、双语提示词、思考级别（Gemini thinking level、OpenAI reasoning effort、vLLM thinking 开关）。

### 3.4 多智能体会诊（详见 `mas-agent-module.md`）
- 16 种策略：single / cot / sc / discussion / clinical-panel / triage-panel / expert-panel / debate / mdagents / mdteamgpt / reconcile / metaprompting / autogen / dylan / medagents / colacare。
- 实时数据流弹窗（AgentFlowViz）：医生节点图 + 逐事件动画 + 完整发言转录 + token 统计。
- 断点续传、降级语义（失败即整场失败、保留中间意见）、新会话取消旧会话。

### 3.5 运维与开发
- `scripts/download_weights.sh`：一键下载 SAM2.1/MedSAM2 公开权重到 `monai-label/checkpoints/`。
- 模型懒加载：`LOAD_SAM2/LOAD_SAM3/LOAD_MEDSAM2/LOAD_VOXTELL = lazy|eager`，首用才占显存。
- `img_cache/`（numpy 影像缓存）与 `volumes/root-cache/`（DICOM 下载缓存）跨容器重建保留。

## 4. 整体架构

### 4.1 Docker 生产拓扑（`docker-compose.yml`）

| 服务 | 镜像/构建 | 端口 | 职责 |
|------|-----------|------|------|
| `ohif_viewer` | 由 `Viewers/` 构建（Nginx） | 1025 SSL / 1026 Web | 静态前端 + 反向代理（`/pacs/`→Orthanc、`/monai/`→MONAI） |
| `orthanc` | `jodogne/orthanc-plugins` | 4242 / 8042 | PACS：DICOM 存储 + DICOMWeb |
| `monai_server` | 由仓库根构建（NVIDIA runtime） | 8002 | MONAI Label：AI 推理（GPU 0,1）、MAS、VLM 调用 |

- Nginx 关键配置（`Viewers/platform/app/.recipes/Nginx-Orthanc/config/nginx.conf`）：`client_max_body_size 500M`、`/monai/` 代理 `proxy_connect_timeout 300s` / `proxy_read_timeout 2400s`（推理长请求；须大于后端 `MONAI_LABEL_LLM_TIMEOUT_SECONDS`，默认 1800s）、`proxy_request_buffering off`（上传直通）、gzip 白名单。
- `monai_server` 通过 `extra_hosts: host.docker.internal` 访问宿主机上的 vLLM（`VLLM_BASE_URL` 默认 `http://host.docker.internal:8000/v1`）；GPU 直通 `CUDA_VISIBLE_DEVICES=0,1`，`shm_size: 10gb`。

### 4.2 本地开发拓扑（`scripts/start-dev.ps1`）

| 服务 | 端口 | 说明 |
|------|------|------|
| 主页 | 8791 | `landing/` 静态页（`python -m http.server`），所有入口出发点 |
| 研究空间 | 3000 | `Viewers/` rsbuild dev（Node 20.9.0 + corepack yarn 1.22.22），`/pacs`、`/monai` 代理到本地服务 |
| Orthanc | 8042 | docker（同生产） |
| MONAI Label | 8002 | conda `smartcity` 环境原生运行，`PYTHONPATH` 指向 `monai-label/` |

### 4.3 请求链路（一次 MAS 会诊）

```
OHIF commandsModule.testVlm
  ├─ POST /monai/infer/segmentation (multipart: nninter=mas, mas_strategy, mas_run_id, texts, image…)
  │     └─ nginx(/monai/) → FastAPI(sync def, Starlette 线程池) → BasicInferTask
  │          → _mas_run → run_orchestrated_workflow → RuntimeEngine(并行分批) → OpenAI 兼容上游
  └─ GET /monai/mas/runs/{run_id}   每 700ms 轮询
        └─ 内存运行注册表（锁保护、TTL 2h、上限 32 条）→ 事件流/终态快照 → AgentFlowViz 实时渲染
新会话开始 → POST /monai/mas/runs/{旧 id}/cancel → 引擎在 LLM 调用之间协作式中止
```

## 5. 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 / TypeScript / Cornerstone3D / OHIF Viewer 3.x 框架、rsbuild（dev）、模块级订阅式全局状态（`stores/toolboxState.ts`）、`AgentFlowViz`（SVG DAG 回放，NVIDIA 设计语言） |
| 网关 | Nginx（反向代理、500M 上传、2400s 推理读超时、gzip、SPA fallback） |
| PACS | Orthanc（docker，SQLite 存储 + DICOMWeb 插件） |
| 后端 | Python 3.13 / FastAPI / Uvicorn、MONAI Label 框架（radiology sample app）、SimpleITK（DICOM↔numpy）、PyTorch（GPU 推理） |
| 交互分割 | nnInteractive（会话池 + torch.compile）、SAM2.1、MedSAM2、SAM3、VoxTell（文本提示分割） |
| VLM | MedGemma（本地 HF）、google-genai（Gemini）、OpenAI / Anthropic / Moonshot(Kimi) / Qwen / Gemma SDK、vLLM（OpenAI 兼容自托管，recipes 见 `vllm/`） |
| MAS | 自研 `orchestration/` 包（纯标准库：spec/agent/engine/blackboard/trace/report），16 种策略移植自 MedMASLab 论文实现 |
| 基础设施 | Docker Compose（NVIDIA Container Toolkit、host-gateway）、conda `smartcity` 环境、HuggingFace Hub 权重下载 |

## 6. 目录速览

```
Medical-imaging/
├── docker-compose.yml          # 三服务生产拓扑
├── Viewers/                    # OHIF 前端（platform + extensions/default 自定义扩展）
│   └── extensions/default/src/
│       ├── commandsModule.ts   # 全部命令（分割、VLM、MAS 轮询/取消/终态收敛）
│       ├── utils/Toolbox.tsx   # 左侧工具箱 UI
│       ├── utils/AgentFlowViz.tsx  # MAS 数据流可视化弹窗
│       └── stores/toolboxState.ts # 全局状态（模型选择、VLM 配置、MAS trace）
├── monai-label/
│   ├── monailabel/tasks/infer/basic_infer.py      # 推理任务入口（nninter 路由 + VLM 管线）
│   ├── monailabel/tasks/infer/mas_inference.py    # MAS 工作流 + 运行注册表 + 检查点
│   ├── monailabel/tasks/infer/orchestration/      # MAS 编排引擎（详见 mas-agent-module.md）
│   ├── monailabel/tasks/infer/nninter_session_pool.py # nnInteractive 多用户会话池
│   ├── monailabel/endpoints/    # /infer、/mas（轮询/取消）等 FastAPI 路由
│   ├── sample-apps/radiology/   # radiology 应用（模型注册）
│   ├── checkpoints/             # 模型权重（scripts/download_weights.sh 下载）
│   └── tests/unit/tasks/test_mas_inference.py     # MAS 单元测试（8 个用例）
├── vllm/                       # vLLM 启动脚本（qwen/internvl/kimi/gemma）
├── sam2/                       # SAM2 源码（训练/工具，供引用）
├── scripts/                    # start-dev.ps1（一键启动）、download_weights.sh
├── element/loading/            # 加载动画
├── landing/                    # 平台主页（静态）
└── docs/                       # 本文档所在
```

> 注：`MedMASLab-main/`（同级参考仓库）是 MAS 策略的论文基准实现来源，本项目将其编排思想迁移进 MONAI Label（详见 `mas-agent-module.md` 的「与 MedMASLab 的关系」一节）。`checkpoints/` 为中央权重目录（`MONAI_LABEL_CHECKPOINTS_DIR`）。
