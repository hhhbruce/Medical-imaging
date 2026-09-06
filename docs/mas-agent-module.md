# 多智能体（MAS）会诊模块 — 深度解析

> 本文档解析 `Medical-imaging/monai-label/` 内自研的多智能体会诊系统：编排引擎、16 种策略、可靠性与容错设计、实时可视化协议。504 超时的专项排查见 [`504-timeout-investigation.md`](./504-timeout-investigation.md)。MedMASLab 参考框架的方法学说明见 [`agents-architecture.md`](./agents-architecture.md)。

---

## 1. 模块地图

```
monailabel/tasks/infer/
├── mas_inference.py          # 入口：策略注册表、LLM 调用加固、运行注册表、检查点续传
└── orchestration/            # 纯标准库的编排内核（可脱离 torch/openai 单测）
    ├── spec.py               # 声明式图 DSL：NodeKind/EdgeSpec/OrchestrationSpec
    ├── patterns.py           # 11 种编排模式 + build_expert_panel 默认管线
    ├── agent.py              # Agent（生产）/MockAgent（测试）+ 投票聚合
    ├── engine.py             # RuntimeEngine：分层并行调度器（本次 504 修复核心）
    ├── blackboard.py         # 线程安全共享黑板（RLock + 历史）
    ├── messages.py           # Trace/TraceEvent 事件流（on_event 实时回调）
    ├── tracer.py             # trace JSONL 序列化/回放
    └── report.py             # 自包含 HTML 可视化导出（离线复盘用）
```

设计原则：**引擎与 LLM 完全解耦**。`RuntimeEngine` 只认 `Agent` 接口（`respond/route/aggregate/evaluate`），生产实现包装 OpenAI 兼容客户端，测试用 `MockAgent` 离线跑通全部策略（`tests/unit/tasks/test_mas_inference.py`）。

## 2. 声明式图 DSL（spec.py）

每个策略是一张有向图：

- **节点类型** `NodeKind`：`io`（输入/输出边界）、`agent`（一次带角色提示的 LLM 调用）、`router`（单选分支）、`aggregator`（聚合：VOTE 多数票 / WEIGHTED 置信度加权 / SUMMARIZE LLM 综合 / CONCAT 拼接）、`evaluator`（收敛判定，驱动循环）、`blackboard`（共享记忆，不执行）。
- **边** `EdgeSpec`：`loop=True` 显式标记回边（权威，优于 DFS 检测——Debate 的 gate↔agent 互环 DFS 会误判）；普通边即数据流。
- `entry`/`exit` 标记边界；`max_rounds` 封顶循环。
- `to_dict()` 序列化为 viewer 侧 `MasTracePayload.spec`（节点/边列表），前端据此布局医生图。

## 3. 16 种策略（`_STRATEGY_SPECS`）

| 策略 | 拓扑 | 来源 |
|------|------|------|
| `single` / `cot` | 单专家（思维链） | 基线 |
| `sc` | 5 路独立采样 + 多数票 | Self-Consistency |
| `discussion` | 4 专科独立首答 → 收敛门 → 主诊汇总，最多 5 轮互审 | MedMASLab Discussion |
| `clinical-panel` | 4 专科 + 首席评审 | 自研临床面板 |
| `triage-panel` | 急诊 3 视角 + 分诊组长 | 自研 |
| `expert-panel` | 难度路由 →（单专家 \| 招募者→3 专科→收敛门→表决） | patterns.build_expert_panel |
| `debate` | 3 辩手互审 2 轮 + 评委裁决 | Du et al. |
| `mdagents` | 难度路由 → solo / 招募 3 专家 + 表决 | MDAgents |
| `mdteamgpt` | 全科分诊 → 4 专科逐轮 → 组长逐轮纪要，最多 3 轮 | MDTeamGPT |
| `reconcile` | 3 独立视角 + 置信度 → 加权调和 + 全票核查 | ReConcile |
| `metaprompting` | 元模型拆解 → 领域专家 → 元终审循环 | MetaPrompting |
| `autogen` | 助手 ↔ 用户代理对话循环 | AutoGen |
| `dylan` | 4 独立智能体分层激活 + 高频裁决 | DyLAN |
| `medagents` | 招募 → 3 专家 → 报告汇总 → 综合验证门 | MedAgents |
| `colacare` | 内/外/放射 3 专科结构化推荐 + 主诊裁判 | ColaCare |

角色提示词全部要求**简体中文作答**、禁用 emoji（中转网关最易把 4 字节字符损坏成 U+FFFD）。

## 4. RuntimeEngine — 分层并行调度器（engine.py）

执行模型（2026-09 修复后）：

1. **建图**：邻接表 + 回边识别（显式 `loop=True` 优先，否则 DFS）+ Kahn 拓扑序。
2. **分层**：按最长前向路径深度把节点划入依赖层（tier）。同层节点互不依赖 → **同层并行执行**（`ThreadPoolExecutor`，`max_workers=4`）。这是 504 修复的核心：把墙钟时间从「所有 LLM 调用之和」降到「每层最慢一次」。
3. **轮次**：第 0 轮跑全图；之后仅重跑**循环体**（回边目标可达集）。收敛门 `evaluator` 判 `converged` 则停止回灌；`max_rounds` 封顶。
4. **路由**：`router` 节点产出 `meta.target`，未选中分支收到 `node_skip` 事件（原因 `route_filtered`），viewer 不会把未发生通信的边动画化。
5. **黑板**：`rbb/wbb` 或与 blackboard 节点相邻的节点自动纳入读写集；读快照（6000 字截断）拼进上下文，写回带历史。RLock 保护，并行安全。
6. **事件流**：每步 `trace.add()`（run_start / node_start / node_end / node_replay / node_skip / node_error / edge / route / loop / final），`on_event` 回调实时推给运行注册表。

容错语义（详见第 6 节）：任一节点重试耗尽 → 整场降级（`RunResult.degraded`），最终答案清空，中间意见保留在 trace。

## 5. LLM 调用加固（mas_inference.py `_call_agent`）

上游（LLM 网关/中转）最常见的三类故障与对策：

| 故障 | 对策 |
|------|------|
| 超时 / 5xx / 502/504 / 连接重置（瞬时） | 最多 5 次原地重试，指数退避 + 抖动（1–8s）；不消耗预算阶梯 |
| 推理模型把输出预算烧在隐藏思考上（`content` 为空） | 输出预算阶梯 `(1536, 4096, 4096)`：先小预算防中转超时，空回复则升档重试 |
| 回复被截断（`finish_reason=length`） | 记录截断文本，升档取全文；末档兜底截断版，再兜底 `reasoning_content` |

文本净化：`_strip_thinking` 剥离 ` 起点中文网…`（未闭合即预算被砍）；`_sanitize_model_text` 清除 U+FFFD 损坏字节，防止后续 agent 围绕乱码讨论。`_clean_upstream_error` 把网关 HTML 错误页压成「HTTP 504: 网关返回了 HTML 错误页」式的短原因。

OpenAI 客户端：per-call 超时由 `MONAI_LABEL_LLM_TIMEOUT_SECONDS` 控制（默认 1800s，见 `basic_infer._llm_timeout`，适配多图慢上游）、SDK `max_retries=0`（重试策略全部由 `_call_agent` 掌控，避免默认重试把等待时间翻倍）。

## 6. 运行生命周期与容错

### 6.1 运行注册表（内存，单进程）
`mas_run_register` → `mas_run_append_event`（每个事件，锁保护）→ `mas_run_update`（终态）。TTL 2 小时、上限 32 条（LRU 淘汰）。`GET /mas/runs/{run_id}` 返回 `{status, error, payload}`：运行中吐事件流（live 视图，含实时的 rounds/token 估算）；`done`/`error` 终态直接吐**精确的最终 trace**（含 node_error/partial 标记）。

### 6.2 降级语义（失败即整场失败）
节点重试耗尽 → trace 记 `node_error` → `final_answer` 清空 → 注册表 `status="error"` + 完整中间 trace + 检查点保留 → 同步 POST 抛 `MASWorkflowError`（前端收到带失败原因的 4xx，而不是空答案的 200 伪成功）。已完成 agent 的输出保留为「中间意见」供诊断，绝不冒充结论。

### 6.3 断点续传（checkpoint/resume）
每个节点完成即回调 `on_node_complete` → 落盘 `{run_id}.json`（临时文件 + 原子 rename，锁串行化并发写）。重发**相同 `mas_run_id`** 时引擎对 `round:node` 键做**检查点回放**（`node_replay` 事件、零 LLM 调用、token 计入统计），只重跑失败节点。成功后检查点删除，降级后保留。

### 6.4 协作式取消
新会话开始 → 前端 `POST /mas/runs/{旧 id}/cancel` → 注册表打 `cancelled` 标记 → 引擎在**每个节点派发前**检查并抛 `WorkflowCancelled` → 注册表记 `status="cancelled"`（区别于 error，前端不弹错误）。进行中的单次 LLM 调用会自然完成（不强杀线程）。

### 6.5 前端配合（Viewers/extensions/default/src/commandsModule.ts）
- POST 会诊的同时每 700ms 轮询 `/mas/runs/{id}`，事件实时渲染进 AgentFlowViz 弹窗；
- 终态以**快照为准**：POST 被代理掐断（504）也由轮询终态收敛 UI；POST 出错路径再做一次一次性终态拉取（`settleFromRunSnapshot`），确保弹窗与报告面板拿到失败原因而非空白；
- `runSeq` 序号防止被取代的旧会话写脏新会话状态。

## 7. 可视化协议（AgentFlowViz.tsx）

前端消费 `MasTracePayload = {answer, status?, error?, strategy, agent_count, rounds, token_stats, spec, trace}`：

- **图布局**：spec 的节点按层 DAG 自上而下排布，回边画侧环；
- **回放**：事件流逐条推进（播放/上一步/下一步），`node_start` 在节点上渲染等待 loader，`edge/route/loop` 点亮对应连线，`node_end` 进入转录面板（完整发言全文 + token 数）；
- **并行等待可视化（2026-09-03）**：同一依赖层（tier）的兄弟 agent 由引擎并发执行，前端不再只看「最后一条事件」，而是统计所有「已 `node_start` 未 `node_end`/`node_error`」的 in-flight 节点——每个正在等待 LLM 响应的节点旁边都转着立方体 loader 并泛绿光脉冲，多个专科医生可同时处于「思考中」状态（如 discussion 首轮 4 位专科、SC 的 5 路采样）；
- **终态**：`status='error'` 显示后端失败原因横幅，`node_skip` 标记被路由跳过的节点。

`orchestration/report.py` 另提供零依赖 HTML 导出（同一 trace 的离线复盘版），`tracer.py` 支持 JSONL 持久化。

## 8. 与 MedMASLab 的关系

`orchestration/` 包从 `MedMASLab-main/methods/orchestration` 迁移而来，做了三类适配：

1. **轻量化**：仅依赖标准库（MedMASLab 版捆绑 torch/gradio/openai），引擎可独立单测；
2. **接入 MONAI**：`mas_inference.py` 提供策略注册表、LLM 加固、运行注册表、检查点、取消语义，经 `basic_infer._mas_run` 进入 `/infer` 端点；
3. **补齐实现**：原版的 `ThreadPoolExecutor` 导入是死代码（从未并行），迁移版实现了真正的分层并行；并补充了回边显式标记、node_skip 可视化、降级/断点续传等生产语义。

## 9. 单元测试

`monai-label/tests/unit/tasks/test_mas_inference.py`（pytest，8 用例）：

- 16 个注册策略（MockAgent）全部产出非空答案与事件流；
- single 多模态请求组装（image_url 部分）；
- clinical-panel 调用数/token 统计/提示词内容；
- 文本净化（U+FFFD、think 块）、中文输出规范注入；
- 预算阶梯重试与 reasoning 兜底路径。
