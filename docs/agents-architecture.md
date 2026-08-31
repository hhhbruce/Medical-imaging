# 多智能体系统（MAS）架构说明

> 本文档梳理本仓库中所有可运行的智能体（Agent）系统：**一共做了几套、各自的运行逻辑、以及它们之间如何编排与通信**。
>
> 代码位于 `MedMASLab-main/`（多智能体基准评测框架 MedMASLab）。`main.py` 是统一入口，`methods/` 目录下是各套方法。本文所有引用均指向 `MedMASLab-main/` 下的源码。

---

## 1. 总览：一共几套 Agent

框架里一共 **13 个可运行的入口**（通过 `--model` 参数选择），分为两类：

| 类别 | 数量 | 方法 |
|------|------|------|
| 单模型基线（无多智能体协作） | 3 | Single、CoT（Chain-of-Thought）、SelfConsistency |
| 多智能体架构（MAS） | 10 | Debate、MDAgents、MDTeamGPT、Discussion、Reconcile、MetaPrompting、AutoGen、DyLAN、MedAgents、ColaCare |

- 论文/README 的性能对比表列的是「Single + 10 套 MAS」共 **11 种**方法；代码里额外实现了 CoT 和 SelfConsistency 两个单模型基线，所以 `main.py` 里实际可调度的是 **13 个入口**。
- 调度由 `main.py` 的 `process_sample` 统一分派：

```141:166:MedMASLab-main/main.py
    if args.model == "MetaPrompting":
        final_decision, token_stats, current_config = metaprompting_infer(question, args.root_path, args.base_model, img_path,args.api_key,args.base_vllm_url)
    elif args.model == "ColaCare":
        final_decision, token_stats, current_config = colacare_infer(question, args.root_path, args.base_model, img_path,args.api_key,args.base_vllm_url)
    elif args.model == "MedAgents":
        final_decision, token_stats, current_config = medagents_infer(question, args.root_path, args.base_model, img_path,batch_manager=batch_manager)
    elif args.model == "MDAgents":
        final_decision, token_stats, current_config = MDAgents_test(question, args.root_path, args.base_model, img_path,
                                                                    batch_manager)
    elif args.model == "autogen":
        final_decision, token_stats, current_config = autogen_infer_medqa(question, args.root_path, args.base_model, img_paths=img_path,batch_manager=batch_manager)
    elif args.model == "dylan":
        final_decision, token_stats, current_config = dylan_infer_medqa(question, args.root_path, args.base_model, img_paths=img_path, batch_manager=batch_manager)
    elif args.model == "Discussion":
        final_decision, token_stats, current_config = discussion_infer(question, args.root_path, args.base_model,
                                                                           img_path, batch_manager)
    elif args.model == "Cot":
        final_decision, token_stats = Cot_test(args.root_path, args.base_model, question, img_path)
    elif args.model == "SelfConsistency":
        final_decision, token_stats = SelfConsistency_test(args.root_path, args.base_model, question, img_path)
    elif args.model == "MDTeamGPT":
        final_decision, token_stats, current_config = MDTeamGPT_test(question, img_path, args.root_path, batch_manager)
    elif args.model == "Debate":
        final_decision, token_stats, current_config = Debate_test(question, args.root_path, args.base_model, img_path,
                                                                  batch_manager)
    elif args.model == "Reconcile":
        final_decision, token_stats, current_config = Reconcile_test(question, args.root_path, args.base_model,
                                                                     img_path,batch_manager)
```

所有方法统一返回三元组 `(final_decision, token_stats, current_config)`：最终答案、token 用量统计、当前智能体数量与轮次。这个统一签名就是 README 所说的标准化协议 `R = (y, Γ, Θ)`（`y` 最终答案，`Γ` 推理/中间内容，`Θ` 成本统计）。

---

## 2. 编排与通信的统一基础设施

### 2.1 基类 `MAS`

```61:95:MedMASLab-main/methods/mas_base.py
class MAS():

    def __init__(self, model_name=None, batch_manager=None):
        self.batch_manager = batch_manager
        self.model_name=model_name
        ...
        self.memory_bank = {}
        self.tools = {}
        ...
    def call_llm(self, prompt=None, system_prompt=None, messages=None, model_name=None, temperature=None,
                 img_paths=None):
```

基类提供 `inference(sample)`、`call_llm(...)`、`get_token_stats()`，以及预留的 `memory_bank` / `tools` 字段。`call_llm` 是所有智能体调用大模型的唯一出口：把消息（可含图片，自动注入多模态格式）交给 `batch_manager`，并累加 token 统计。

> **架构注意点**：真正继承 `MAS` 基类的只有 **AutoGen** 和 **DyLAN** 两套；其余方法（Debate、MDAgents、Reconcile、MedAgents 等）用的是各自独立的 `*_test` / `*_infer` 顶层函数，内部自行维护 `token_stats`。`MAS.inference` 的统一接口在多数方法里并未被实际沿用。

### 2.2 大模型调用与并发（通信的“物理层”）

所有智能体的“说话”最终都收敛到两个底层组件：

- `methods/vllm_thread.py` 的 `VLLMBatchInferenceManager`（第 189 行）：生产者-消费者模式，后台线程用 `queue.Queue` 攒批、按 `batch_size`/`timeout` 动态组 batch，再并发调用 vLLM 的 OpenAI 兼容接口；返回 `(文本, prompt_tokens, completion_tokens)`。

```189:199:MedMASLab-main/methods/vllm_thread.py
class VLLMBatchInferenceManager:
    """使用 vLLM API 的批量推理管理器"""
    
    def __init__(self, model=None, root_path=None, batch_size=10, timeout=0.5, vllm_url="http://localhost:8000/v1",api_key="EMPTY"):
```

- `methods/thread.py` 末尾的 `qwen_generate_content(messages, batch_manager)` 只是一层薄封装，直接 `batch_manager.submit_request(messages)`。

所以：**智能体之间没有独立的“消息队列/共享内存黑板”**，通信方式本质是“把其他智能体的文本回复拼接进当前智能体的 prompt（上下文传递）”。唯一的例外是 MDTeamGPT，它用 LangGraph 的 `StateGraph` 显式建模状态流转。

### 2.3 通信协议（语义层）

论文声明的标准协议是 `R = (y, Γ, Θ)`：

| 符号 | 含义 | 代码落地 |
|------|------|----------|
| `y` | 最终决策 | `final_decision` 返回值 |
| `Γ` | 推理/讨论内容 | 各智能体的 `messages` / `context` 文本，逐轮拼接传递 |
| `Θ` | 成本统计 | `token_stats = {model: {num_llm_calls, prompt_tokens, completion_tokens}}` |

多模态支持：图片/视频在 `mas_base.py` 的 `_inject_images_into_messages`、`_encode_media_to_content_parts` 中处理；视频会抽帧转多张 `image_url`。

---

## 3. 三套单模型基线

### 3.1 Single（Baseline）

```10:17:MedMASLab-main/methods/general_model.py
class BaseLine_Test:
    def __init__(self, batch_manager):
        self.batch_manager=batch_manager

    def chat(self, description,image_path):
        # if need_judge:
        msg=f"You are a medical expert.{is_options()}"
```

**逻辑**：1 个「medical expert」智能体，1 次 LLM 调用，直接把问题（含图片）丢给模型要答案。`current_config = {"current_num_agents": 1, "round": 1}`。

### 3.2 CoT（Chain-of-Thought）

```4:8:MedMASLab-main/methods/Cot.py
class CoT_model:
    def __init__(self, model_info, root_path):
        self.model_info = model_info
```

**逻辑**：仍 1 个智能体，但在问题后追加 `"let's think step by step."`，引导模型逐步推理。1 次调用。

### 3.3 SelfConsistency

```4:8:MedMASLab-main/methods/SC.py
class SelfConsistency_model:
    def __init__(self, model_info, root_path):
        self.model_info = model_info
```

**逻辑**：同一问题采样 **5 个回答**（`temperature=0.8` 增加多样性），再第 6 次调用一个「聚合器」，让它综合 5 个回答给出最终答案（类似投票）。共 **6 次** LLM 调用。

---

## 4. 十套多智能体架构

### 4.1 Debate（辩论）

```73:90:MedMASLab-main/methods/debate.py
def Debate_test(question, root_path, model_info,img_path,batch_manager):
    agents = 3
    rounds = 2
    final_decision = ''
    agent_contexts = [[qwen_vl_chat_content(img_path,question)] for agent in range(agents)]
```

- **智能体**：3 个同构智能体，各自维护独立的 `agent_context`（对话历史）。
- **编排**：2 轮。第 1 轮各自独立作答；第 2 轮通过 `construct_message` 把「其他智能体的上一条回答」拼进自己上下文，要求「审视自己和他人的答案、逐步检查、更新答案」。
- **通信**：上下文拼接（`debate.py:15` 的 `construct_message` 把他人答案包成 `One agent solution: ```...``` `）。
- **收敛**：固定 2 轮，最后一轮最后一个智能体的回答作为最终决策（追加 `is_options()` 要求给出选项字母）。

### 4.2 MDAgents（难度自适应的层级多智能体）

```328:336:MedMASLab-main/methods/MDAgents/medagents.py
def MDAgents_test(question,root_path,model_info,img_path,batch_manager):
    config_path = str(Path(root_path) / 'methods' / 'MDAgents' / 'configs' / 'config_main.yaml')
    config = load_config(config_path)
    difficulty = config.get('difficulty', 'adaptive')
```

这是最复杂的一套，分三层（由 `determine_difficulty` 难度评估器决定走哪条路径）：

- **basic**：单个 `Agent`（`medagents.py:85`）直接作答。
- **intermediate**：① `recruiter` 招募 N 个领域专家；② `parse_agents_from_recruitment` + `parse_hierarchy` 解析出专家层级/通信结构（如 `Pulmonologist == Cardiologist > ...`）；③ 「参与式辩论」——每轮每个专家先回答 yes/no 是否想和其他专家交流，若 yes 则选择目标专家编号并发起提问，形成 `interaction_log`（可画出 `i->j` / `i<->j` 的交互矩阵）；④ `moderator` 汇总多数投票给最终答案。
- **advanced**：① `recruiter` 组织多支 MDT 团队（`parse_recruitment_json` 解析 JSON）；② 每支团队是 `Group`（`medagents.py:215`），组内有 **lead** + 若干 **assist** 成员，`interact(comm_type='internal')` 走「组长下达调查任务 → 组员各自调研 → 组长汇总」的内部流程；③ 各组报告汇总给最终的 `decision maker`。

- **通信**：既有**组内**（lead↔assist 的指令/调研往返），也有**组间**（IAT 初评 → 中间团队 → FRDT 终审），还有**专家间**（参与式辩论的点对点提问）。层级由 LLM 动态生成，而非写死。

### 4.3 MDTeamGPT（LangGraph 状态机编排）

这是唯一用显式工作流引擎（LangGraph `StateGraph`）编排的一套：

```23:27:MedMASLab-main/methods/MDTeamGPT/agents.py
class MDTAgents:
    def __init__(self, api_key_vl=None, base_url_vl=None, api_key_text=None, base_url_text=None, text_model=None,
                 vl_model=None, enable_tools=True, root_path=None, batch_manager=None):
```

- **智能体角色**（`MDTAgents` 内方法）：`primary_care_doctor`（分诊）、`specialist_consult`（专科医生）、`lead_physician_synthesis`（组长综合）、`safety_reviewer`（安全/收敛审查）、`cot_reviewer`（评测用，含 ground truth）。
- **专科池**：`SPECIALIST_POOL` 固定 8 个专科（内科/普外/儿科/妇产/放射/神经/病理/药师），分诊时选 ≥3 个。

```30:32:MedMASLab-main/methods/MDTeamGPT/workflow.py
def create_workflow(agents_instance):
    def node_triage(state: MDTState):
```

- **编排**：`StateGraph(MDTState)` 三条边 `triage → consultation_layer → safety_layer`，`safety_layer` 后按 `router` 条件边决定 `continue`（回到 consultation）还是 `end`。状态里 `context_bullets` 用 `operator.add` 累加，实现跨轮信息传递。
- **通信**：状态机传递。专科医生**互相不可见当前轮**输出（「盲评/独立」设计），只看到 `residual_context`（上一轮的 lead 综合摘要 + 知识库检索结果），由 `lead_physician_synthesis` 生成 6 字段 JSON（Consistency/Conflict/Independence/Integration/Tools_Usage/Long_Term_Experience）后再进入下一轮。
- **收敛**：`safety_reviewer` 输出 `STATUS: [CONVERGED]/[DIVERGED]`，或到达 `max_rounds=6` 强制收敛。还带一个 `knowledge_base.py` 的双知识库检索。

### 4.4 Discussion（固定角色多轮讨论）

```43:48:MedMASLab-main/methods/Discussion/infer.py
def discussion_infer(
        question,
        root_path,
        model_info,
        img_path=None,
        batch_manager=None
):
```

- **智能体**：4 个**角色固定**的医生，定义在 `Discussion/multi_agent/config_role.json`：Primary Care Physician（初诊）、Emergency & Critical Care（急诊重症）、Radiologist（放射）、Clinical Pharmacist（临床药师），各带明确的 specialty 与 role_prompt。
- **编排**：`LLM_Debate`（`multi_agent/discussion.py:43`），固定 `rounds = 5`。每轮每个智能体发言时，通过 `construct_response` 把「其他智能体上一轮的回复」拼接进 prompt；最后一轮追加「只输出最终结论」的约束。
- **通信**：上下文拼接。最终取第一个智能体最后一轮的回答作为 `final_decision`。
- **智能体实现**：`multi_agent/agents.py:109` 的 `Qwen_VL`，维护自己的 `num_llm_calls` / token 计数。

### 4.5 Reconcile（异构智能体 + 置信度加权投票）

```21:27:MedMASLab-main/methods/Reconcile/model.py
class Reconcile_Model:
    def __init__(self, root_path, model_info, batch_manager):
```

- **智能体**：3 个异构智能体（原论文是 Gemini / GPT / Bard 各一个，`model.py` 里对应 `Gemini_gen_ans` / `gpt_gen_ans` / `bard_gen_ans` 三个方法；在 MedMASLab 里被适配为同一个 `model_info`，即 Qwen/LLaVA）。
- **协议**：每个智能体输出严格 JSON `{"reasoning": ..., "answer": ..., "confidence_level": 0.xx}`。
- **编排**（`reconcile_test.py:8`）：① 3 个智能体各自独立作答（带置信度）；② `clean_model_output` + `model_parse_output` 解析；③ **加权投票** `weighted_vote_0`，取票数最高的选项；④ 进入多轮辩论（`max_round=3`）——每轮每个智能体「参考其他智能体的解答」更新自己的答案，直到加权投票只剩 1 个候选（共识）或到最大轮数。
- **通信**：`*_debate` 方法把他人答案作为 `additional_instruc` 拼进 prompt。

### 4.6 MetaPrompting（元模型动态生成专家）

```57:62:MedMASLab-main/methods/MetaPrompting/infer.py
def metaprompting_infer(
    question: str,
    root_path: str,
    model_info: str,
    img_path: Optional[Any],
    api_key: str,
    base_url: str,
):
```

- **智能体**：一个 **Meta 模型**（负责编排）+ 它**动态生成**的若干 `Expert XYZ`（专家身份由 meta 模型在运行时产出，如 `Expert Cardiologist:`），以及可选的 `Expert Python`（能写代码并用 `execute_code_with_timeout` 执行）。
- **编排**（`utils/meta_scaffolding.py:16` `MetaPromptingScaffolding`）：递归的 `meta_model_generate`。meta 模型输出若含 `Expert XXX:\n"""指令"""` 模式，就切分指令、逐个调用对应专家，把专家输出回填进 meta 对话；再递归进入下一轮，直到出现 `final-answer-indicator` 或达到 `counter == 16` 上限。
- **通信**：meta 模型 ↔ 专家的递归调用链，专家结果以 `专家名's output: """..."""` 形式回传。
- `current_config` 固定记为 `{"current_num_agents": 4, "round": 1}`（实际上专家数量动态）。

### 4.7 AutoGen（双智能体对话）

```18:23:MedMASLab-main/methods/autogen/autogen_main.py
class AutoGen_Main(MAS):
    def __init__(self, model_name=None, batch_manager=None):
        super().__init__(model_name, batch_manager)
        self.max_turn = self.method_config["max_turn"]
```

- **智能体**：2 个 —— Assistant Agent（医学专家）+ User Proxy Agent。这是**两套真正继承 `MAS` 基类**的方法之一。
- **编排**（`inference`）：`max_turn` 轮对话循环。Assistant 先答，User Proxy 对答案反馈，再交回 Assistant，交替进行。
- **通信**：双方各自维护 `history`（消息列表），交替 append 对方回复。
- **收敛**：检测到 `is_termination_msg`（终止词，如 "TERMINATE"）即停；另有 `_get_best_answer_response` 用正则从回复里挑出最像最终答案的一句。可选 `code_execute`（执行 ```` ```python ```` 代码块）。

### 4.8 DyLAN（动态 LLM Agent 网络）

```10:14:MedMASLab-main/methods/dylan/dylan_main.py
class DyLAN_Main(MAS):
    """Dynamic LLM Agent Network (DyLAN) implementation."""

    def __init__(self,model_name,batch_manager):
        super().__init__(model_name, batch_manager)
```

- **智能体**：`num_agents` 个节点（默认 4），`num_rounds` 轮（默认 3）。也是继承 `MAS` 基类。
- **编排**：`_init_network` 建图（节点 + 带权边）。每轮打乱顺序逐个 `_activate_node` 激活节点（激活时看其他节点的 `answer`），激活数量超过 2/3 就做 `_check_consensus`（Bleu 相似度聚合 + 2/3 多数判定）；后续轮用 `_listwise_ranker` 给各回复打分、筛出「重要」节点继续激活。
- **通信**：节点间通过共享的 `self.nodes[idx]["answer"]` 传递信息，并计算 `importance`（重要性排名）。
- **收敛**：共识达成（2/3 多数）或跑满轮次；最后 `_most_frequent` 取最频繁答案。

### 4.9 MedAgents（领域专家流水线 + 多轮共识）

```66:72:MedMASLab-main/methods/MedAgents/infer.py
def medagents_infer(question: str, root_path: str, model_info: str, img_path=None,batch_manager=None):
    config_path = str(Path(root_path) / 'methods' / 'MedAgents' / 'configs' / 'config_main.yaml')
    config = load_config(config_path)
    num_qd = config.get('num_qd', 5)
    num_od = config.get('num_od', 2)
```

- **动态角色**（由 `prompt_generator.py` 生成 prompt，`utils.py:fully_decode` 编排）：question classifier（把问题分类到 N 个领域）→ **question domain experts**（`num_qd=5` 个问题领域专家）→ option classifier → **option domain experts**（`num_od=2` 个选项领域专家）→ **synthesizer**（综合报告）→ **voter**（多轮共识投票）。
- **编排**：`fully_decode` 里先分类、再逐领域分析、再综合、再进入 `syn_verif` 共识循环：每个领域专家对综合报告投票 yes/no，若有 no 就提出修改意见并重写报告（`revision_history` 记录），直到 `max_attempt_vote=3` 轮内全票 yes，最后用综合报告出答案。
- **通信**：纯流水线 + 共识循环，各阶段输出以文本 dict 传递（`question_analyses`、`option_analyses`、`syn_report`）。

### 4.10 ColaCare（MDT 会诊：3 专科医生 + 1 协调者）

```149:151:MedMASLab-main/methods/ColaCare/medagentboard/medqa/multi_agent_colacare_full_log.py
class DoctorAgent(BaseAgent):
    """Doctor agent with a medical specialty."""
```

- **智能体**：3 个 `DoctorAgent`（`MedicalSpecialty`：Internal Medicine 内科 / Surgery 外科 / Radiology 放射）+ 1 个 `MetaAgent`（`multi_agent_colacare_full_log.py:363`，协调/综合者）。`MDTConsultation`（第 567 行）负责编排。
- **编排**（`run_consultation`，`max_rounds=3`）：每轮四步——① 各医生 `analyze_case` 独立分析；② MetaAgent `synthesize_opinions` 综合；③ 各医生 `review_synthesis` 对综合结果表态 `agree` yes/no；④ MetaAgent `make_final_decision` 做决策。**全票同意或达到最大轮数**即收敛。
- **通信**：MetaAgent 是唯一「信息汇聚点」——医生之间不直接通信，都经由 MetaAgent 的综合意见（`memory` 记录每轮 analysis/review/synthesis/decision）。
- **注意**：该目录下还有 `multi_agent_mac.py`、`multi_agent_healthcareagent.py`、`*_add_mechanism.py`（含 `AuditorAgent`）等变体，但 `main.py` 只调用 `multi_agent_colacare_full_log.py`，其余是未接入的变体/实验。

---

## 5. 编排方式对比汇总

| 方法 | 智能体数量 | 编排模式 | 通信方式 | 收敛/终止条件 |
|------|-----------|---------|---------|--------------|
| Single | 1 | 单次调用 | — | 1 轮 |
| CoT | 1 | 单次调用 + 思维链 | — | 1 轮 |
| SelfConsistency | 5 采样 + 1 聚合 | 并行采样 + 聚合 | 文本拼接 | 固定 6 次调用 |
| Debate | 3 | 固定轮次辩论 | 上下文拼接 | 2 轮 |
| MDAgents | 自适应（basic/intermediate/advanced） | 难度自适应 + 招募 + 层级 + 参与式辩论 | 组内/组间/专家点对点 | moderator 投票 / 决策者汇总 |
| MDTeamGPT | 1 分诊 + ≥3 专科 + 组长 + 安全员 | **LangGraph StateGraph** | 状态机 + 上下文摘要 | 收敛标志或 6 轮 |
| Discussion | 4 固定角色 | 固定轮次讨论 | 上下文拼接 | 5 轮 |
| Reconcile | 3 异构 + 置信度 | 独立作答 + 加权投票 + 辩论 | 他人答案拼接 | 共识或 3 轮 |
| MetaPrompting | 1 meta + 动态专家 | 递归元生成 | meta↔专家递归调用 | 结束标志或 16 轮 |
| AutoGen | 2（Assistant + User Proxy） | 交替对话 | 历史消息列表 | 终止词或 max_turn |
| DyLAN | 4 节点网络 | 动态激活 + 重要性排名 | 共享节点 answer + 边权重 | 2/3 共识或 3 轮 |
| MedAgents | 分类器 + 5 问题专家 + 2 选项专家 + 综合者 + 投票者 | 流水线 + 共识循环 | 阶段文本 dict | 全票 yes 或 3 轮 |
| ColaCare | 3 医生 + 1 协调者 | 多轮 MDT 会诊 | 经 MetaAgent 汇聚 | 全票同意或 3 轮 |

---

## 6. 关键结论

1. **共 13 套**：3 套单模型基线 + 10 套多智能体架构。
2. **通信本质是「上下文拼接」**：绝大多数方法没有独立的消息总线或共享黑板，而是把其他智能体的文本回复拼进下一个智能体的 prompt；只有 **MDTeamGPT** 用 LangGraph 状态机显式编排，**AutoGen/DyLAN** 继承 `MAS` 基类但仍是简单循环。
3. **统一出口**：所有方法都收敛到 `qwen_generate_content → VLLMBatchInferenceManager`（vLLM 批量并发），并返回统一三元组 `(final_decision, token_stats, current_config)`，对应论文协议 `R = (y, Γ, Θ)`。
4. **角色生成方式分两类**：`Discussion`、`MDTeamGPT`、`ColaCare` 是**固定角色**；`MDAgents`、`MedAgents`、`MetaPrompting` 是**LLM 动态生成角色**；`Debate`、`Reconcile`、`AutoGen`、`DyLAN` 是同构/异构智能体的**自由对话**。
