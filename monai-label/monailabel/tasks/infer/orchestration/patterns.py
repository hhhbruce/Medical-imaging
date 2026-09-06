"""The 11 orchestration patterns as reusable :class:`OrchestrationSpec` builders.

Each function returns a validated spec that the :class:`RuntimeEngine` can
execute directly. The default *expert diagnosis* pipeline
(:func:`build_expert_panel`) composes several of them — difficulty routing,
orchestrator recruitment, parallel specialists, blackboard debate with a
convergence loop, and majority-vote moderation.
"""
from __future__ import annotations

from .spec import (
    AggregatorStrategy,
    EdgeSpec,
    NodeKind,
    NodeSpec,
    OrchestrationSpec,
)


def _n(id, kind, name="", role="", agg=AggregatorStrategy.VOTE, targets=None,
       rbb=False, wbb=False):
    return NodeSpec(
        id=id,
        kind=kind,
        name=name or id,
        role_prompt=role,
        aggregator=agg,
        route_targets=targets or [],
        read_blackboard=rbb,
        write_blackboard=wbb,
    )


def _e(src, dst, port="", loop=False):
    return EdgeSpec(src, dst, port, loop)


def _spec(name, nodes, edges, entry, exit, max_rounds=4):
    return OrchestrationSpec(
        name=name,
        nodes={n.id: n for n in nodes},
        edges=edges,
        entry=entry,
        exit=exit,
        max_rounds=max_rounds,
    )


_MED_EXPERT = (
    "你是一名经验丰富的医学专家。请逐步推理，给出你的依据和最终结论。"
    "若问题本身附带了 A/B/C/D 等选项，最终结论以所选选项字母开头；"
    "若问题没有提供选项，直接给出文字结论，不要自行编造或输出选项字母。"
)


def sequential() -> OrchestrationSpec:
    return _spec(
        "Sequential",
        [_n("in", NodeKind.IO), _n("a", NodeKind.AGENT, "信息提取", _MED_EXPERT),
         _n("b", NodeKind.AGENT, "推理", _MED_EXPERT), _n("c", NodeKind.AGENT, "决策", _MED_EXPERT),
         _n("out", NodeKind.IO)],
        [_e("in", "a"), _e("a", "b"), _e("b", "c"), _e("c", "out")],
        "in", "out",
    )


def parallel() -> OrchestrationSpec:
    return _spec(
        "Parallel",
        [_n("in", NodeKind.IO),
         _n("a", NodeKind.AGENT, "路径甲", _MED_EXPERT),
         _n("b", NodeKind.AGENT, "路径乙", _MED_EXPERT),
         _n("c", NodeKind.AGENT, "路径丙", _MED_EXPERT),
         _n("agg", NodeKind.AGGREGATOR, "汇总", agg=AggregatorStrategy.VOTE),
         _n("out", NodeKind.IO)],
        [_e("in", "a"), _e("in", "b"), _e("in", "c"),
         _e("a", "agg"), _e("b", "agg"), _e("c", "agg"), _e("agg", "out")],
        "in", "out",
    )


def router() -> OrchestrationSpec:
    return _spec(
        "Router",
        [_n("in", NodeKind.IO),
         _n("r", NodeKind.ROUTER, "分诊路由", targets=["a", "b", "c"]),
         _n("a", NodeKind.AGENT, "分支甲", _MED_EXPERT),
         _n("b", NodeKind.AGENT, "分支乙", _MED_EXPERT),
         _n("c", NodeKind.AGENT, "分支丙", _MED_EXPERT),
         _n("out", NodeKind.IO)],
        [_e("in", "r"), _e("r", "a"), _e("r", "b"), _e("r", "c"),
         _e("a", "out"), _e("b", "out"), _e("c", "out")],
        "in", "out",
    )


def orchestrator() -> OrchestrationSpec:
    return _spec(
        "Orchestrator-Workers",
        [_n("in", NodeKind.IO),
         _n("orch", NodeKind.AGENT, "统筹者",
            "你是任务统筹者。请把任务拆解为若干聚焦的子任务，分派给各执行专家。请全程使用简体中文作答。"),
         _n("w1", NodeKind.AGENT, "执行专家一", _MED_EXPERT),
         _n("w2", NodeKind.AGENT, "执行专家二", _MED_EXPERT),
         _n("w3", NodeKind.AGENT, "执行专家三", _MED_EXPERT),
         _n("syn", NodeKind.AGGREGATOR, "综合", agg=AggregatorStrategy.SUMMARIZE),
         _n("out", NodeKind.IO)],
        [_e("in", "orch"), _e("orch", "w1"), _e("orch", "w2"), _e("orch", "w3"),
         _e("w1", "syn"), _e("w2", "syn"), _e("w3", "syn"), _e("syn", "out")],
        "in", "out",
    )


def evaluator_optimizer() -> OrchestrationSpec:
    return _spec(
        "Evaluator-Optimizer",
        [_n("gen", NodeKind.AGENT, "生成者", _MED_EXPERT),
         _n("eval", NodeKind.EVALUATOR, "评审",
            "你是评审者。请判断生成的答案是否令人满意。"
            "请先输出恰好一个英文判定词（'converged' 表示满意/通过，'not converged' 表示不满意），"
            "随后用简体中文给出理由。请全程使用简体中文作答。"),
         _n("out", NodeKind.IO)],
        [_e("gen", "eval"), _e("eval", "gen", loop=True), _e("eval", "out")],
        "gen", "out",
    )


def reflection() -> OrchestrationSpec:
    return _spec(
        "Reflection",
        [_n("ag", NodeKind.AGENT, "答题者", _MED_EXPERT),
         _n("cr", NodeKind.EVALUATOR, "批评者",
            "你是批评者。请指出答案的缺陷，并判断答案是否已是最终版本。"
            "请先输出恰好一个英文判定词（'converged' 表示已是最终版本，'not converged' 表示仍需修改），"
            "随后用简体中文说明理由。请全程使用简体中文作答。"),
         _n("out", NodeKind.IO)],
        [_e("ag", "cr"), _e("cr", "ag", loop=True), _e("ag", "out")],
        "ag", "out",
    )


def hierarchical() -> OrchestrationSpec:
    return _spec(
        "Hierarchical",
        [_n("in", NodeKind.IO),
         _n("lead", NodeKind.AGENT, "团队组长",
            "你是团队组长。请把该病例分派给你的两个子团队。请全程使用简体中文作答。"),
         _n("ta", NodeKind.AGENT, "甲组组长", _MED_EXPERT),
         _n("tb", NodeKind.AGENT, "乙组组长", _MED_EXPERT),
         _n("ma", NodeKind.AGENT, "甲组组员", _MED_EXPERT),
         _n("mb", NodeKind.AGENT, "乙组组员", _MED_EXPERT),
         _n("agg", NodeKind.AGGREGATOR, "最终汇总", agg=AggregatorStrategy.VOTE),
         _n("out", NodeKind.IO)],
        [_e("in", "lead"), _e("lead", "ta"), _e("lead", "tb"),
         _e("ta", "ma"), _e("tb", "mb"), _e("ma", "agg"), _e("mb", "agg"),
         _e("agg", "out")],
        "in", "out",
    )


def hub_and_spoke() -> OrchestrationSpec:
    return _spec(
        "Hub-and-Spoke",
        [_n("in", NodeKind.IO),
         _n("hub", NodeKind.AGENT, "协调中枢",
            "你是协调中枢。请把该病例分派给各专科医生。请全程使用简体中文作答。"),
         _n("s1", NodeKind.AGENT, "专科一", _MED_EXPERT),
         _n("s2", NodeKind.AGENT, "专科二", _MED_EXPERT),
         _n("s3", NodeKind.AGENT, "专科三", _MED_EXPERT),
         _n("agg", NodeKind.AGGREGATOR, "意见收集", agg=AggregatorStrategy.VOTE),
         _n("out", NodeKind.IO)],
        [_e("in", "hub"), _e("hub", "s1"), _e("hub", "s2"), _e("hub", "s3"),
         _e("s1", "agg"), _e("s2", "agg"), _e("s3", "agg"), _e("agg", "out")],
        "in", "out",
    )


def blackboard() -> OrchestrationSpec:
    return _spec(
        "Blackboard",
        [_n("in", NodeKind.IO),
         _n("bb", NodeKind.BLACKBOARD),
         _n("a1", NodeKind.AGENT, "专家一", _MED_EXPERT, rbb=True, wbb=True),
         _n("a2", NodeKind.AGENT, "专家二", _MED_EXPERT, rbb=True, wbb=True),
         _n("a3", NodeKind.AGENT, "专家三", _MED_EXPERT, rbb=True, wbb=True),
         _n("agg", NodeKind.AGGREGATOR, "汇总", agg=AggregatorStrategy.VOTE),
         _n("out", NodeKind.IO)],
        [_e("in", "a1"), _e("in", "a2"), _e("in", "a3"),
         _e("bb", "a1"), _e("bb", "a2"), _e("bb", "a3"),
         _e("a1", "bb"), _e("a2", "bb"), _e("a3", "bb"),
         _e("a1", "agg"), _e("a2", "agg"), _e("a3", "agg"), _e("agg", "out")],
        "in", "out",
    )


def debate() -> OrchestrationSpec:
    return _spec(
        "Debate",
        [_n("in", NodeKind.IO),
         _n("a1", NodeKind.AGENT, "辩手一", _MED_EXPERT, rbb=True, wbb=True),
         _n("a2", NodeKind.AGENT, "辩手二", _MED_EXPERT, rbb=True, wbb=True),
         _n("a3", NodeKind.AGENT, "辩手三", _MED_EXPERT, rbb=True, wbb=True),
         _n("gate", NodeKind.EVALUATOR, "收敛门"),
         _n("judge", NodeKind.AGGREGATOR, "评委", agg=AggregatorStrategy.VOTE),
         _n("out", NodeKind.IO)],
        [_e("in", "a1"), _e("in", "a2"), _e("in", "a3"),
         _e("a1", "gate"), _e("a2", "gate"), _e("a3", "gate"),
         _e("a1", "judge"), _e("a2", "judge"), _e("a3", "judge"),
         _e("gate", "a1", loop=True), _e("gate", "a2", loop=True), _e("gate", "a3", loop=True),
         _e("judge", "out")],
        "in", "out",
    )


def swarm() -> OrchestrationSpec:
    return _spec(
        "Swarm",
        [_n("in", NodeKind.IO),
         _n("n1", NodeKind.AGENT, "智能体一", _MED_EXPERT, rbb=True, wbb=True),
         _n("n2", NodeKind.AGENT, "智能体二", _MED_EXPERT, rbb=True, wbb=True),
         _n("n3", NodeKind.AGENT, "智能体三", _MED_EXPERT, rbb=True, wbb=True),
         _n("n4", NodeKind.AGENT, "智能体四", _MED_EXPERT, rbb=True, wbb=True),
         _n("agg", NodeKind.AGGREGATOR, "加权汇总", agg=AggregatorStrategy.WEIGHTED),
         _n("out", NodeKind.IO)],
        [_e("in", "n1"), _e("in", "n2"), _e("in", "n3"), _e("in", "n4"),
         _e("n1", "agg"), _e("n2", "agg"), _e("n3", "agg"), _e("n4", "agg"),
         _e("agg", "out")],
        "in", "out",
    )


PATTERN_BUILDERS = {
    "sequential": sequential,
    "parallel": parallel,
    "router": router,
    "orchestrator": orchestrator,
    "evaluator_optimizer": evaluator_optimizer,
    "reflection": reflection,
    "hierarchical": hierarchical,
    "hub_and_spoke": hub_and_spoke,
    "blackboard": blackboard,
    "debate": debate,
    "swarm": swarm,
}


def build_expert_panel() -> OrchestrationSpec:
    """Default *expert diagnosis* pipeline composing several patterns.

    Flow: difficulty router → (basic: single expert | complex: recruiter →
    3 specialists → blackboard debate loop → moderator vote) → answer.
    """
    return _spec(
        "ExpertPanel",
        [
            _n("in", NodeKind.IO),
            _n("router", NodeKind.ROUTER, "难度分诊路由",
               "你是医疗分诊智能体。请评估该问题（结合影像）的复杂程度："
               "若单一专家即可作答，只回复 solo；若需要多学科小组会诊，只回复 recruiter。",
               targets=["solo", "recruiter"]),
            _n("solo", NodeKind.AGENT, "全科专家", _MED_EXPERT),
            _n("recruiter", NodeKind.AGENT, "会诊组长",
               "你是一名高年资主诊医师。请针对该问题给出简短的多学科评估计划："
               "列出需要哪些专科参与、各自负责什么。请全程使用简体中文作答。",
               wbb=True),
            _n("e1", NodeKind.AGENT, "专科医生一", _MED_EXPERT, rbb=True, wbb=True),
            _n("e2", NodeKind.AGENT, "专科医生二", _MED_EXPERT, rbb=True, wbb=True),
            _n("e3", NodeKind.AGENT, "专科医生三", _MED_EXPERT, rbb=True, wbb=True),
            _n("gate", NodeKind.EVALUATOR, "共识收敛门",
               "你判断各位专科医生是否已就结论达成共识。"
               "请先输出恰好一个英文判定词（'converged' 表示已收敛，'not converged' 表示未收敛），"
               "未收敛时随后用简体中文给出简明的修改意见。"),
            _n("moderator", NodeKind.AGGREGATOR, "会诊主持人",
               "你是会诊主持人。请综合各专科意见给出最终结论："
               "按少数服从多数的原则裁决分歧，区分影像观察与可能诊断，并附安全提示。"
               "请全程使用简体中文作答。",
               agg=AggregatorStrategy.VOTE),
            _n("out", NodeKind.IO),
        ],
        [
            _e("in", "router"),
            _e("router", "solo"), _e("router", "recruiter"),
            _e("solo", "out"),
            _e("recruiter", "e1"), _e("recruiter", "e2"), _e("recruiter", "e3"),
            _e("e1", "gate"), _e("e2", "gate"), _e("e3", "gate"),
            _e("e1", "moderator"), _e("e2", "moderator"), _e("e3", "moderator"),
            _e("gate", "e1", loop=True), _e("gate", "e2", loop=True), _e("gate", "e3", loop=True),
            _e("moderator", "out"),
        ],
        "in", "out",
    )
