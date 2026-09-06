# MAS 会诊 504 超时 — 排查与修复报告

> 排查日期：2026-09-02。范围：`Medical-imaging/monai-label/` 多智能体（MAS）模块 + Nginx 代理链路。
> 结论先行：**504 的直接原因在外部（上游 LLM 网关慢/不稳 + Nginx 300s 读超时），但内部存在一个显著放大器 —— 编排引擎严格串行执行，把多智能体墙钟时间放大为「所有 LLM 调用之和」，即使上游完全健康也必然撞上代理超时。该放大器已修复（分层并行执行），并完成回归验证。**
>
> **更新（2026-09-03）**：针对「上传图片多 → 上游处理慢」的场景，超时预算已全面放宽并可配置（见文末第 8 节）。正文第 1–7 节记录的是修复前基线（Nginx 300s / MAS 客户端 600s）下的分析过程。

---

## 1. 超时链路与各段边界

```
浏览器 ──POST /monai/infer/segmentation──► Nginx(proxy_read_timeout 300s) ──► FastAPI(sync, 线程池)
                                                                            │
                                                     RuntimeEngine ── 最多 16+ 次串行 LLM 调用 ──► 上游网关/中转
                                                                                          （单次 ALB 超时也可能 504）
```

| 段 | 超时边界 | 超时后果 |
|----|----------|----------|
| 浏览器 → Nginx | `proxy_read_timeout 300s`（`nginx.conf` `/monai/` location） | **Nginx 向浏览器返回 504**，但后端继续跑完（这是用户看到的 504） |
| Nginx → FastAPI | 无请求级超时（uvicorn 默认不限） | — |
| MONAI → 上游 LLM | OpenAI 客户端 `timeout=600s`、SDK `max_retries=0` | 客户端抛超时异常，`_call_agent` 按瞬时错误重试 |
| 上游网关内部 | 中转/ALB 自身（常见 60–300s） | 上游返回 504/HTML 错误页给 MONAI，`_clean_upstream_error` 压缩后入 trace |

已排除的内部嫌疑（逐项验证）：

- **事件循环阻塞**：`/infer/{model}` 端点刻意为同步 `def`（`endpoints/infer.py` 418 行），Starlette 放入线程池执行，轮询端点 `GET /mas/runs/{id}` 为 async —— 长推理期间轮询畅通，无饥饿。
- **锁死锁**：`_MAS_RUNS_LOCK`（注册表）、blackboard RLock、会话池锁（锁序固定 entry.lock → gpu_lock）均为短临界区，无嵌套持锁做 I/O。
- **无限重试**：SDK `max_retries=0`；`_call_agent` 瞬时重试封顶 3 次（退避 1–8s），预算阶梯固定 3 档 —— 最坏单节点 ≈ 3×600s + 重试退避，有界。

## 2. 根因一（外部）：上游网关慢 / 不稳

- 单次调用超过中转 ALB 限额 → 上游直接回 504（HTML 错误页）。此类已被 `_is_retryable_upstream_error` + 退避重试吸收，重试耗尽则降级整场（`status="error"` + 失败原因），不会挂死。
- 代码注释与设计（预算阶梯首档仅 1536 token「stay below common relay/ALB time limits」）表明这是已知、已缓释的外部因素。

## 3. 根因二（外部）：代理 300s vs 会诊总时长

会诊总时长 = **LLM 调用数 × 单次时长**。以 `discussion`（2 轮）为例：4 专科 + 收敛门 + 主诊 × 2 轮 ≈ **12 次串行调用**；`mdteamgpt` 最多 3 轮 ≈ 21 次。单次 30–60s（推理模型长输出）时总时长 6–20 分钟 ≫ 300s → **Nginx 必然 504**。

前端已有配套设计：POST 被代理掐断时，700ms 轮询 + 一次性终态拉取（`settleFromRunSnapshot`）保证 UI 从运行注册表收敛到终态，检查点保证重发只跑失败节点 —— 即 504 之后用户体验与数据完整性都有兜底。

## 4. 根因三（内部放大器）：引擎串行执行 ✅ 已修复

**发现**：`orchestration/engine.py` 的模块 docstring 与 `max_workers=4`、`ThreadPoolExecutor` 导入都声称/暗示「同层兄弟节点并行执行」，但 `run()` 实际是纯串行 for 循环 —— 导入是死代码。该缺陷同样存在于 MedMASLab 原版（`MedMASLab-main/methods/orchestration/engine.py`，其注释「we parallelize the LLM-heavy tier below via a helper」之后并无实现）。串行使并行型策略（discussion 4 专科、sc 5 采样、mdteamgpt 4+1…）墙钟 = 调用之和，是 504 概率的内部放大器。

**修复**（`engine.py`）：

1. 建图阶段计算**依赖层**（按最长前向路径深度分 tier）；
2. `run()` 以层为批次经 `ThreadPoolExecutor` 派发：同层兄弟并发（4 并发），层间依序；单节点链（single/cot/autogen…）行为不变；
3. 节点主体抽为 `_process_node` worker（跳过/回放/执行/trace/finalize 原语义保留）；
4. 失败语义：同批兄弟自然跑完（其输出按降级设计保留为中间意见），后续层不再派发；协作式取消在层间与 worker 内检查，`WorkflowCancelled` 收拢到主线程统一抛出。

**配套线程安全加固**：

| 共享资源 | 风险 | 修复 |
|----------|------|------|
| `Agent.token_stats` 读改写 | 并发丢更新 | `_stats_lock`（`agent.py`），新增 `credit_tokens()` 供回放记账 |
| `_make_orchestrated_llm_call` 的共享 `WorkflowStats` 差值 | 并发下 per-call delta 错乱 | 每次 llm_call 用独立 `WorkflowStats` 实例（`mas_inference.py`） |
| 检查点回调（`completed` dict + json 落盘） | 并发 `json.dump` 同一 tmp 路径会交错损坏 | `run_orchestrated_workflow` 内 `_checkpoint_lock` 串行化 append+save |

**顺带修复的 live 视图 bug**（`mas_run_snapshot`）：`num_llm_calls` 原写法 `sum(1 for e in events if live_pt or live_ct or ...)` 中 `live_pt/live_ct` 是**运行总数** —— 一旦任何节点报 token，所有事件（含 node_start/edge）都会被计数。改为按**单事件** token 判定。

## 5. 验证

- `pytest tests/unit/tasks/test_mas_inference.py`：**8/8 通过**（16 策略 MockAgent 全图执行）；
- 并发冒烟（SleepingAgent，每调用 sleep 0.5s，4 并发层）：
  - 并行墙钟 **1.00s**（串行基线 ≈ 2.5s）✅
  - 降级：失败节点记 `node_error`、`final_answer` 为空、无 `final` 事件 ✅
  - 断点续传：回放节点零 LLM 调用、其余照常执行 ✅
  - 取消：`WorkflowCancelled` 在任何 LLM 调用前抛出 ✅
  - 16 策略并行引擎 + MockAgent 全部产出答案且无降级 ✅
- 事件交错（并行批次中 node_start/node_end 穿插）与 `AgentFlowViz` 的事件驱动回放兼容（逐事件步进，无顺序假设）。

## 6. 修复后的时长量级

以 `discussion`（2 轮、单次 60s）为例：串行 12×60s = **12 分钟**（必 504）→ 分层并行 ≈ 4 层 ≈ **4 分钟**（2 轮 × [专科层 ‖ 收敛门+主诊层]）。单次 30s 时 ≈ 2 分钟 < 300s（修复前基线），全程不再触碰代理超时。更慢的上游仍可能 504，但由既有的轮询终态收敛 + 断点续传兜底（2026-09-03 起代理窗口已放宽到 2400s，见下节）。

## 7. 残余风险与建议（非阻塞）

1. 单节点最坏 3×客户端超时 预算阶梯 + 重试 —— 极慢上游下单节点仍可超代理窗口；如需彻底消除 POST 504，可考虑异步任务化（POST 返回 run_id，前端全靠轮询），当前架构已为此预留了全部协议。
2. 4 并发对弱限流网关可能触发 429 —— 已由瞬时重试吸收；必要时调低 `RuntimeEngine(max_workers=…)`。
3. `num_llm_calls` 等 live 统计只在轮询刷新间近似，终态以精确 trace 为准（本就如此设计）。

## 8. 超时预算调整（2026-09-03，针对多图慢上游）

排查发现上传图片较多时，上游 VLM 的 prefill/生成会显著变慢，旧预算（Nginx 300s、MAS 客户端 600s）会把「健康但慢」的上游误判成超时。现已放宽并统一为**可配置**：

| 层 | 旧值 | 新值 | 配置方式 |
|----|------|------|----------|
| 浏览器 → Nginx（docker :1026 生产模式） | `proxy_read_timeout 300s` | **2400s**（`nginx.conf` http 顶层与 `/monai/` location 同步） | 编辑 `Viewers/platform/app/.recipes/Nginx-Orthanc/config/nginx.conf` |
| MONAI → 上游 LLM（MAS / custom-anthropic 等 OpenAI 兼容与 Anthropic 客户端） | 600s / 1200s 硬编码 | **1800s** 默认 | 环境变量 `MONAI_LABEL_LLM_TIMEOUT_SECONDS`（下限 60s，非法值回退默认） |
| 开发模式代理（:3000 rsbuild / webpack dev） | 无超时 | 无超时（不变） | — |
| 前端 axios POST | 无超时 | 无超时（不变） | — |

设计要点：

- **代理窗口必须大于客户端超时**：Nginx 2400s > 后端默认 1800s，留有余量；否则代理先断，浏览器收到 504 而后端仍在跑（正文根因二的情形）。
- **调大方法**：单张 CT/MR 序列几十层 → 建议先试默认 1800s；超大影像组（数百 MB、多序列）→ 设 `MONAI_LABEL_LLM_TIMEOUT_SECONDS=3600` 并把 nginx 两处 `proxy_read_timeout` 同步加大（如 4200s）。docker-compose 的 `monai_server` 服务 `environment:` 段加一行即可传入：
  ```yaml
  environment:
    - MONAI_LABEL_LLM_TIMEOUT_SECONDS=${MONAI_LABEL_LLM_TIMEOUT_SECONDS:-1800}
  ```
- 代价有界：瞬时故障在同一预算档内最多重试 5 次（`_MAX_TRANSIENT_RETRIES=5`），单节点理论最坏 ≈ 6 次尝试 × 客户端超时（默认 6×1800s = 3 小时）后降级（`status="error"` + 断点保留），不会无限挂起。实际中网关型上游（如固定 60s 掐断的中转）每次尝试只耗时 ~60s，最坏约 6×60s = 6 分钟即降级。
