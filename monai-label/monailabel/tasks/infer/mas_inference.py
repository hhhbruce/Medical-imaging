"""Lightweight medical multi-agent workflows for the custom VLM endpoint.

This module keeps the orchestration layer inside MONAI Label while reusing the
same OpenAI-compatible multimodal request format as the existing ``custom``
VLM path.  It is intentionally independent of the heavyweight local-model
imports in MedMASLab, so a remote OpenAI-compatible endpoint only needs the
``openai`` package.
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple
import json
import logging
import os
import re
import tempfile
import time

from monailabel.tasks.infer.orchestration import Agent, RuntimeEngine, WorkflowCancelled
from monailabel.tasks.infer.orchestration.spec import (
    AggregatorStrategy,
    EdgeSpec,
    NodeKind,
    NodeSpec,
    OrchestrationSpec,
)
from monailabel.tasks.infer.orchestration.patterns import build_expert_panel

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AgentProfile:
    name: str
    specialty: str
    instruction: str


@dataclass
class WorkflowStats:
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0

    def add_usage(self, response: Any) -> None:
        usage = getattr(response, "usage", None)
        if usage is None:
            return
        self.prompt_tokens += int(getattr(usage, "prompt_tokens", 0) or 0)
        self.completion_tokens += int(getattr(usage, "completion_tokens", 0) or 0)


DISCUSSION_PROFILES: Tuple[AgentProfile, ...] = (
    AgentProfile(
        "全科医生",
        "初诊评估与鉴别诊断",
        "梳理临床问题、病程时间线与危险信号，给出鉴别诊断和初步检查建议。",
    ),
    AgentProfile(
        "急诊重症医生",
        "分诊与时效性危重识别",
        "重点排查危及生命的表现，明确需要紧急升级处理的红线与最不能漏诊的诊断。",
    ),
    AgentProfile(
        "放射科医生",
        "影像判读与影像陷阱",
        "谨慎描述可见的影像学表现，指出判读的局限性，给出结构化的影像印象。",
    ),
    AgentProfile(
        "临床药师",
        "用药安全与治疗方案优化",
        "评估用药选择、禁忌证、药物相互作用与监测要点，必要时考虑肝肾功能剂量调整。",
    ),
)

TRIAGE_PROFILES: Tuple[AgentProfile, ...] = (
    DISCUSSION_PROFILES[1],
    DISCUSSION_PROFILES[2],
    AgentProfile(
        "专科医生",
        "受累器官系统的鉴别诊断与处理",
        "聚焦问题涉及的器官系统与临床背景，给出下一步最稳妥的处理动作。",
    ),
)


class MASWorkflowError(ValueError):
    """Raised when a multi-agent workflow cannot be executed."""


def _sanitize_model_text(text: str) -> str:
    """Clean text-level transport damage before it enters the workflow.

    Upstream relays occasionally corrupt multi-byte UTF-8 (truncated emoji,
    chunk-boundary splits) which surfaces as the replacement character
    ``\ufffd``. Left in place it poisons every later prompt: downstream
    agents start retransmitting and commenting on the "garbled character".
    The damaged byte is unrecoverable, so drop the marker instead.
    """
    if "\ufffd" in text:
        text = text.replace("\ufffd", "")
    return text


_THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def _strip_thinking(text: str) -> str:
    """Drop reasoning-model chain-of-thought blocks from model output.

    Some relays inline ``<think>...</think>`` blocks into ``content``; an
    unclosed ``<think>`` means the budget was cut mid-thinking, so everything
    from the tag on is reasoning rather than the answer.
    """
    if not text:
        return text
    text = _THINK_BLOCK_RE.sub("", text)
    idx = text.lower().find("<think>")
    if idx != -1:
        text = text[:idx]
    return text


def _message_text(response: Any) -> str:
    """Extract text from OpenAI-compatible response objects and dictionaries."""
    try:
        message = response.choices[0].message
    except (AttributeError, IndexError, TypeError) as exc:
        raise MASWorkflowError("The model returned no assistant message.") from exc

    content = getattr(message, "content", None)
    if content is None and isinstance(message, dict):
        content = message.get("content")
    if isinstance(content, str):
        text = _strip_thinking(content).strip()
        if text:
            return _sanitize_model_text(text)
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
            else:
                text = getattr(item, "text", None)
                if isinstance(text, str):
                    parts.append(text)
        text = _strip_thinking("".join(parts)).strip()
        if text:
            return _sanitize_model_text(text)

    # Some reasoning models return an empty final ``content`` when the completion
    # budget is exhausted. Preserve the available text instead of misdiagnosing
    # a successful upstream response as a transport failure.
    reasoning = getattr(message, "reasoning_content", None)
    if reasoning is None and isinstance(message, dict):
        reasoning = message.get("reasoning_content")
    return _sanitize_model_text(_strip_thinking(str(reasoning or "")).strip())


def _has_final_text(response: Any) -> bool:
    """True when the response carries visible final content, not only hidden reasoning."""
    try:
        message = response.choices[0].message
    except (AttributeError, IndexError, TypeError):
        return False
    content = getattr(message, "content", None)
    if content is None and isinstance(message, dict):
        content = message.get("content")
    if isinstance(content, str) and _strip_thinking(content).strip():
        return True
    if isinstance(content, list):
        for item in content:
            if isinstance(item, str) and item.strip():
                return True
            if isinstance(item, dict) and isinstance(item.get("text"), str) and item["text"].strip():
                return True
            text = getattr(item, "text", None)
            if isinstance(text, str) and text.strip():
                return True
    return False


def _reasoning_text(response: Any) -> str:
    """Best-effort extraction of the model's hidden reasoning (last-resort fallback)."""
    try:
        message = response.choices[0].message
    except (AttributeError, IndexError, TypeError):
        return ""
    reasoning = getattr(message, "reasoning_content", None)
    if reasoning is None and isinstance(message, dict):
        reasoning = message.get("reasoning_content")
    return reasoning if isinstance(reasoning, str) else ""


def _finish_reason(response: Any) -> str:
    """Best-effort extraction of ``choices[0].finish_reason`` from a chat response."""
    try:
        reason = getattr(response.choices[0], "finish_reason", None)
    except (AttributeError, IndexError):
        return ""
    return str(reason or "").lower()


def _clean_upstream_error(exc: BaseException) -> str:
    """Compact, human-readable reason from an upstream exception.

    Relays/gateways sometimes answer with a full HTML error page (ALB 504) or
    a long multi-line JSON body; embedding those verbatim into the user-facing
    failure banner looks like leaking code. Keep the status code and the short
    reason (the HTML ``<title>`` for gateway pages) instead.
    """
    raw = str(exc)
    lowered = raw.lower()
    status = getattr(exc, "status_code", None)
    if "<html" in lowered or "<body" in lowered or "<title>" in lowered:
        match = re.search(r"<title>(.*?)</title>", raw, re.IGNORECASE | re.DOTALL)
        title = match.group(1).strip() if match else ""
        reason = title or "网关返回了 HTML 错误页"
    else:
        reason = re.sub(r"\s+", " ", raw).strip()
        if len(reason) > 300:
            reason = reason[:300] + "…"
    prefix = f"HTTP {status}: " if status and "error code" not in lowered else ""
    return f"{prefix}{reason}"


_RETRYABLE_STATUS_CODES = frozenset({408, 429, 500, 502, 503, 504})

# Transient upstream failures (timeout / 5xx / 504 / connection reset) are
# retried up to this many times per agent call with exponential backoff before
# the step is considered failed. 5 attempts give a slow-but-recovering gateway
# room to get a request through (a 60s-capped relay eats one attempt per hit);
# once exhausted the step degrades and the run keeps its checkpoint, so the
# same mas_run_id can resume from the failed node instead of restarting.
_MAX_TRANSIENT_RETRIES = 5
_BACKOFF_BASE_SECONDS = 1.0
_BACKOFF_MAX_SECONDS = 8.0

# Output-token budget ladder. Attempt 0 keeps a small budget so specialist
# calls stay below common relay/ALB time limits; subsequent rungs raise the
# ceiling so a reasoning model that spent the first budget on hidden thinking
# (empty final ``content``) or a mid-sentence cut (``finish_reason=length``)
# can fit its visible answer. The final rung is repeated once so a reasoning
# model has a second chance at the larger budget before its hidden reasoning
# is surfaced as a last-resort fallback.
_BUDGET_LADDER = (1536, 4096, 4096)


def _is_retryable_upstream_error(exc: BaseException) -> bool:
    """True when an upstream exception is transient and worth retrying.

    The ``openai`` SDK raises typed exceptions (``APITimeoutError``,
    ``APIConnectionError``, ``RateLimitError``, and the ``APIStatusError``
    subclasses such as ``InternalServerError``). Their ``str()`` frequently
    omits the numeric status — a 504 gateway body can be raw HTML and a timeout
    reads "Request timed out." — so match on the status-code attribute and the
    exception class name first, then fall back to message keywords.
    """
    status = getattr(exc, "status_code", None)
    if status is not None:
        try:
            if int(status) in _RETRYABLE_STATUS_CODES:
                return True
        except (TypeError, ValueError):
            pass
    name = type(exc).__name__.lower()
    if any(
        marker in name
        for marker in (
            "timeout", "connection", "ratelimit", "internalserver",
            "serviceunavailable", "badgateway", "gatewaytimeout",
        )
    ):
        return True
    lowered = str(exc).lower()
    return any(
        marker in lowered
        for marker in (
            "408", "429", "500", "502", "503", "504",
            "timeout", "timed out", "temporarily", "connection reset",
            "connection error", "service unavailable", "bad gateway",
        )
    )


def _backoff_delay(attempt: int) -> float:
    """Exponential backoff with jitter (``attempt`` is 1-based)."""
    import random
    cap = min(_BACKOFF_MAX_SECONDS, _BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)))
    return cap * (0.5 + random.random() * 0.5)


def _call_agent(
    client: Any,
    model: str,
    messages: List[Dict[str, Any]],
    stats: WorkflowStats,
    temperature: float = 0.1,
) -> str:
    last_error: Exception | None = None
    reasoning_tail = ""
    best_truncated = ""
    transient_retries = 0

    # Attempt ladder: attempt 0 keeps a small output budget so specialist calls
    # stay below common relay/ALB time limits, and the next rung raises the
    # ceiling so a reasoning model that spent the first budget on hidden
    # thinking can fit its visible answer. Transient upstream failures (408 /
    # 429 / 5xx / 504 / timeout / connection reset) are retried *in place*
    # with exponential backoff and do not consume the ladder, so a flaky relay
    # no longer collapses the whole multi-agent run.
    for attempt, max_tokens in enumerate(_BUDGET_LADDER):
        while True:
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                stats.calls += 1
                stats.add_usage(response)
                if _has_final_text(response):
                    text = _message_text(response)
                    if _finish_reason(response) != "length" or attempt == len(_BUDGET_LADDER) - 1:
                        return text
                    # The visible answer hit the attempt-0 output-token budget
                    # and was cut mid-sentence. Remember it as a fallback and
                    # advance the ladder so the recorded opinion is complete —
                    # an answer truncated by ``max_tokens`` looks like a normal
                    # (non-empty) response otherwise.
                    best_truncated = text
                else:
                    reasoning_tail = _reasoning_text(response) or reasoning_tail
                    last_error = MASWorkflowError(
                        "The model returned an empty assistant message; the output budget may be exhausted."
                    )
                break  # a response arrived (successful or empty) — advance the ladder
            except Exception as exc:
                if _is_retryable_upstream_error(exc) and transient_retries < _MAX_TRANSIENT_RETRIES:
                    transient_retries += 1
                    last_error = exc
                    time.sleep(_backoff_delay(transient_retries))
                    continue  # retry the same token budget after backoff
                if _is_retryable_upstream_error(exc):
                    # Retry budget exhausted. Give up gracefully — the engine
                    # records the partial results collected so far and returns
                    # them to the viewer instead of silently dropping them.
                    raise MASWorkflowError(
                        f"上游模型服务调用失败，本次多智能体会话已中止：{_clean_upstream_error(exc)}"
                    ) from exc
                # Non-transient (content-filter rejection, auth, bad request, ...):
                # retrying cannot help, so abort immediately.
                raise MASWorkflowError(
                    f"上游模型服务调用失败，本次多智能体会话已中止：{_clean_upstream_error(exc)}"
                ) from exc

    # Last resort: prefer the (truncated) visible answer from attempt 0 over
    # the model's hidden reasoning, then the reasoning itself. The prompt-level
    # output rules and the larger-budget rung make these paths rare.
    if best_truncated:
        return _sanitize_model_text(best_truncated.strip())
    if reasoning_tail:
        return _sanitize_model_text(_strip_thinking(reasoning_tail).strip())
    if last_error is not None:
        # Either the empty-content MASWorkflowError or a transient error whose
        # retry budget was consumed before any rung produced text.
        raise last_error
    raise MASWorkflowError("The model request failed without a response.")


def _role_system(profile: AgentProfile) -> str:
    return (
        "你是一支医疗会诊团队的成员。你的输出仅用于辅助临床推理，不构成最终诊断。"
        "不要臆造影像或病历中不存在的信息；存在不确定性时如实说明，"
        "并在适当情况下建议由执业医师复核。\n\n"
        f"你的角色：{profile.name}。\n"
        f"你的专长：{profile.specialty}。\n"
        f"你的任务：{profile.instruction}\n\n"
        "请全程使用简体中文作答；医学术语首次出现时可括注英文缩写。"
        "请勿使用 emoji 表情或特殊装饰符号（对勾、警告、圆点等），仅使用常规标点。"
    )


def _report_block(reports: Sequence[Tuple[str, str]]) -> str:
    blocks = []
    for name, report in reports:
        # Keep a single workflow from producing an unbounded follow-up prompt.
        blocks.append(f"[{name}]\n{report[:5000]}")
    return "\n\n".join(blocks)


def _clinical_panel(
    client: Any,
    model: str,
    initial_content: List[Dict[str, Any]],
    question: str,
    stats: WorkflowStats,
) -> str:
    reports: List[Tuple[str, str]] = []
    for profile in DISCUSSION_PROFILES:
        answer = _call_agent(
            client,
            model,
            [
                {"role": "system", "content": _role_system(profile)},
                {"role": "user", "content": initial_content},
            ],
            stats,
        )
        reports.append((profile.name, answer))

    synthesis_prompt = (
        "你是首席医学评审。请综合下方的各份独立报告回答该问题："
        "区分已观察到的影像事实与假设，消解分歧，指出缺失的信息，"
        "给出简明、有优先级的临床结论与建议的后续步骤，"
        "并附明确的安全提示（本结论不能替代执业医师）。"
        "请全程使用简体中文作答；请勿使用 emoji 或特殊符号。\n\n"
        f"问题：{question}\n\n报告：\n{_report_block(reports)}"
    )
    return _call_agent(
        client,
        model,
        [
            {"role": "system", "content": "你是一名资深医学评审。请全程使用简体中文作答。"},
            {"role": "user", "content": synthesis_prompt},
        ],
        stats,
    )


def _triage_panel(
    client: Any,
    model: str,
    initial_content: List[Dict[str, Any]],
    question: str,
    stats: WorkflowStats,
) -> str:
    reports: List[Tuple[str, str]] = []
    for profile in TRIAGE_PROFILES:
        answer = _call_agent(
            client,
            model,
            [
                {"role": "system", "content": _role_system(profile)},
                {"role": "user", "content": initial_content},
            ],
            stats,
        )
        reports.append((profile.name, answer))

    final_prompt = (
        "你是急诊分诊高年资组长。请审阅各专科评估并回答原始问题："
        "优先考虑即刻危险、紧迫程度、最可能的解释与下一步处置。"
        "不要给出超出所提供影像与病史的确定性结论，"
        "最后以一句安全声明收尾。请全程使用简体中文作答；请勿使用 emoji 或特殊符号。\n\n"
        f"问题：{question}\n\n评估：\n{_report_block(reports)}"
    )
    return _call_agent(
        client,
        model,
        [
            {"role": "system", "content": "你是急诊分诊高年资评审。请全程使用简体中文作答。"},
            {"role": "user", "content": final_prompt},
        ],
        stats,
    )


def _discussion(
    client: Any,
    model: str,
    initial_content: List[Dict[str, Any]],
    question: str,
    rounds: int,
    stats: WorkflowStats,
) -> str:
    """Run the discussion workflow adapted from MedMASLab's Discussion method."""
    rounds = max(1, min(int(rounds), 5))
    reports: List[Tuple[str, str]] = []

    # Round one gives each specialist the original images. Later rounds contain
    # text-only peer reports, avoiding repeated image upload and prompt growth.
    for profile in DISCUSSION_PROFILES:
        answer = _call_agent(
            client,
            model,
            [
                {"role": "system", "content": _role_system(profile)},
                {"role": "user", "content": initial_content},
            ],
            stats,
        )
        reports.append((profile.name, answer))

    for round_index in range(1, rounds):
        previous = list(reports)
        updated: List[Tuple[str, str]] = []
        for profile in DISCUSSION_PROFILES:
            peer_reports = [item for item in previous if item[0] != profile.name]
            prompt = (
                f"原始问题：{question}\n\n"
                "请审阅下方其他专科医生的评估意见：纠正其中的错误，指出证据不足之处，"
                "并给出你更新后的评估。"
                f"本轮为第 {round_index + 1}/{rounds} 轮讨论。请全程使用简体中文作答。\n\n"
                f"同行评估：\n{_report_block(peer_reports)}"
            )
            answer = _call_agent(
                client,
                model,
                [
                    {"role": "system", "content": _role_system(profile)},
                    {"role": "user", "content": prompt},
                ],
                stats,
            )
            updated.append((profile.name, answer))
        reports = updated

    final_prompt = (
        "你是主诊评审。请依据各位专科医生的最终评估回答原始问题："
        "给出一份连贯、有优先级的结论；区分影像观察与可能诊断，并包含安全的后续处理步骤。"
        "最后附一句说明：本输出仅为决策支持，不构成诊断。\n\n"
        f"问题：{question}\n\n最终评估：\n{_report_block(reports)}"
    )
    return _call_agent(
        client,
        model,
        [
            {"role": "system", "content": "你是主诊医学评审。请全程使用简体中文作答。"},
            {"role": "user", "content": final_prompt},
        ],
        stats,
    )


def run_workflow(
    *,
    client: Any,
    model: str,
    strategy: str,
    question: str,
    initial_content: List[Dict[str, Any]],
    rounds: int = 2,
) -> Tuple[str, Dict[str, int], Dict[str, Any]]:
    """Run one selected workflow and return answer, token stats, and metadata."""
    strategy = (strategy or "single").strip().lower()
    stats = WorkflowStats()

    if strategy == "single":
        answer = _call_agent(
            client,
            model,
            [{"role": "user", "content": initial_content}],
            stats,
        )
        agent_count = 1
    elif strategy == "discussion":
        answer = _discussion(client, model, initial_content, question, rounds, stats)
        agent_count = len(DISCUSSION_PROFILES)
    elif strategy == "clinical-panel":
        answer = _clinical_panel(client, model, initial_content, question, stats)
        agent_count = len(DISCUSSION_PROFILES) + 1
    elif strategy == "triage-panel":
        answer = _triage_panel(client, model, initial_content, question, stats)
        agent_count = len(TRIAGE_PROFILES) + 1
    else:
        raise MASWorkflowError(
            "Unknown mas_strategy. Use single, discussion, clinical-panel, or triage-panel."
        )

    token_stats = {
        "num_llm_calls": stats.calls,
        "prompt_tokens": stats.prompt_tokens,
        "completion_tokens": stats.completion_tokens,
    }
    metadata = {
        "strategy": strategy,
        "agent_count": agent_count,
        "rounds": rounds if strategy == "discussion" else 1,
    }
    return answer, token_stats, metadata


# ---------------------------------------------------------------------------
# Orchestration-engine based workflows (MedMASLab agent design migrated here).
#
# The declarative specs below map each ``mas_strategy`` to a typed data-flow
# graph.  ``RuntimeEngine`` executes it and emits a ``Trace`` event stream that
# the OHIF viewer replays as a live agent data-flow visualization.
# ---------------------------------------------------------------------------

_DISCUSSION_ZH = {}  # 角色名已直接使用中文（AgentProfile.name），保留空映射兼容旧引用。

_TRIAGE_ZH = {}

_GATE_ROLE = (
    "你是一名严谨的医学评审。请判断各位专家是否已就同一结论达成收敛。"
    "请先输出恰好一个英文判定词（'converged' 表示已收敛，'not converged' 表示未收敛），"
    "随后用简体中文给出一段简明、可操作的修改意见。"
)

_LEAD_ROLE = (
    "你是主诊医生。请综合各位专家的最终评估回答原始问题："
    "给出一份连贯、有优先级的结论，区分影像观察与可能诊断，并包含安全的后续处理建议。"
    "最后附一句说明：本结论仅为决策支持，不能替代执业医师诊断。请全程使用简体中文作答。"
)

_CHIEF_ROLE = (
    "你是首席评审。请针对问题综合各份独立报告：区分已观察到的影像事实与假设，"
    "消解分歧，指出缺失的信息，给出简明、有优先级的临床结论与建议的后续步骤，"
    "并附明确的安全提示（本结论不能替代执业医师）。请全程使用简体中文作答。"
)

_TRIAGE_LEAD_ROLE = (
    "你是急诊分诊高年资评审。请审阅各专科评估并回答原始问题："
    "优先考虑即刻危险、紧迫程度、最可能的解释与下一步处置。"
    "不要给出超出所提供影像与病史的确定性结论，最后以一句安全声明收尾。"
    "请全程使用简体中文作答。"
)

_SINGLE_ROLE = (
    "你是一名经验丰富的医学专家。请逐步推理并给出最终结论。"
    "请全程使用简体中文作答；医学术语首次出现时可括注英文缩写。"
)


def _extract_image_parts(initial_content: Any) -> List[Dict[str, Any]]:
    """Pull only the ``image_url`` parts out of an OpenAI-chat ``content`` payload."""
    if isinstance(initial_content, str) or not initial_content:
        return []
    parts: List[Dict[str, Any]] = []
    for item in initial_content:
        if isinstance(item, dict) and item.get("type") == "image_url":
            parts.append(item)
    return parts


def _n(nid, kind, name="", role="", agg=AggregatorStrategy.VOTE, targets=None,
       rbb=False, wbb=False, extra=None) -> NodeSpec:
    return NodeSpec(
        id=nid, kind=kind, name=name or nid, role_prompt=role, aggregator=agg,
        route_targets=targets or [], read_blackboard=rbb, write_blackboard=wbb,
        extra=extra or {},
    )


def _e(src, dst, port="", loop=False) -> EdgeSpec:
    return EdgeSpec(src, dst, port, loop)


def _single_spec() -> OrchestrationSpec:
    return OrchestrationSpec(
        name="SingleExpert",
        nodes={"in": _n("in", NodeKind.IO),
               "expert": _n("expert", NodeKind.AGENT, "医学专家", _SINGLE_ROLE),
               "out": _n("out", NodeKind.IO)},
        edges=[_e("in", "expert"), _e("expert", "out")],
        entry="in", exit="out", max_rounds=1,
    )


def _discussion_spec(rounds: int) -> OrchestrationSpec:
    agents = []
    for i, profile in enumerate(DISCUSSION_PROFILES, start=1):
        agents.append(_n(f"d{i}", NodeKind.AGENT, _DISCUSSION_ZH.get(profile.name, profile.name),
                         _role_system(profile), rbb=True, wbb=True))
    nodes = [_n("in", NodeKind.IO)] + agents + [
        _n("gate", NodeKind.EVALUATOR, "会诊收敛门", _GATE_ROLE),
        _n("lead", NodeKind.AGGREGATOR, "主诊医生", _LEAD_ROLE, agg=AggregatorStrategy.SUMMARIZE),
        _n("out", NodeKind.IO),
    ]
    edges = [_e("in", f"d{i}") for i in range(1, len(DISCUSSION_PROFILES) + 1)]
    edges += [_e(f"d{i}", "gate") for i in range(1, len(DISCUSSION_PROFILES) + 1)]
    edges += [_e(f"d{i}", "lead") for i in range(1, len(DISCUSSION_PROFILES) + 1)]
    edges += [_e("gate", f"d{i}", loop=True) for i in range(1, len(DISCUSSION_PROFILES) + 1)]
    edges += [_e("lead", "out")]
    return OrchestrationSpec(
        name="Discussion", nodes={n.id: n for n in nodes}, edges=edges,
        entry="in", exit="out", max_rounds=max(1, min(int(rounds), 5)),
    )


def _clinical_panel_spec() -> OrchestrationSpec:
    agents = []
    for i, profile in enumerate(DISCUSSION_PROFILES, start=1):
        agents.append(_n(f"d{i}", NodeKind.AGENT, _DISCUSSION_ZH.get(profile.name, profile.name),
                         _role_system(profile)))
    nodes = [_n("in", NodeKind.IO)] + agents + [
        _n("chief", NodeKind.AGGREGATOR, "首席评审", _CHIEF_ROLE, agg=AggregatorStrategy.SUMMARIZE),
        _n("out", NodeKind.IO),
    ]
    edges = [_e("in", f"d{i}") for i in range(1, len(DISCUSSION_PROFILES) + 1)]
    edges += [_e(f"d{i}", "chief") for i in range(1, len(DISCUSSION_PROFILES) + 1)]
    edges += [_e("chief", "out")]
    return OrchestrationSpec(
        name="ClinicalPanel", nodes={n.id: n for n in nodes}, edges=edges,
        entry="in", exit="out", max_rounds=1,
    )


def _triage_panel_spec() -> OrchestrationSpec:
    agents = []
    for i, profile in enumerate(TRIAGE_PROFILES, start=1):
        agents.append(_n(f"t{i}", NodeKind.AGENT, _TRIAGE_ZH.get(profile.name, profile.name),
                         _role_system(profile)))
    nodes = [_n("in", NodeKind.IO)] + agents + [
        _n("lead", NodeKind.AGGREGATOR, "分诊组长", _TRIAGE_LEAD_ROLE, agg=AggregatorStrategy.SUMMARIZE),
        _n("out", NodeKind.IO),
    ]
    edges = [_e("in", f"t{i}") for i in range(1, len(TRIAGE_PROFILES) + 1)]
    edges += [_e(f"t{i}", "lead") for i in range(1, len(TRIAGE_PROFILES) + 1)]
    edges += [_e("lead", "out")]
    return OrchestrationSpec(
        name="TriagePanel", nodes={n.id: n for n in nodes}, edges=edges,
        entry="in", exit="out", max_rounds=1,
    )


# ---------------------------------------------------------------------------
# MedMASLab 方法移植（Debate / MDAgents / MDTeamGPT / ReConcile / MetaPrompting
# / AutoGen / DyLAN / MedAgents / ColaCare / SC / CoT）。
#
# 每个构建器把对应论文/MedMASLab 参考实现的多智能体拓扑映射为一张声明式
# OrchestrationSpec 图：ROLE 提示词忠实还原各方法里每个角色的职责，
# 收敛/终止判定交给 EVALUATOR 节点，循环用显式 ``loop=True`` 回边表达。
# 所有角色提示词均要求全程简体中文作答。
# ---------------------------------------------------------------------------

_ZH = "请全程使用简体中文作答；医学术语首次出现时可括注英文缩写。"


def _converged_gate_role(extra: str = "") -> str:
    return (
        "你是严谨的会评裁判。请判断各专家是否已就结论达成收敛。"
        "请先输出恰好一个英文判定词（'converged' 表示已收敛，'not converged' 表示未收敛），"
        "未收敛时随后用一句话给出修改意见。" + extra + _ZH
    )


_DEBATE_GATE_ROLE = _converged_gate_role("收敛时请明确认可现有答案。")


def _debate_spec() -> OrchestrationSpec:
    """Debate（Du et al.）：3 名辩手互相审视对方答案并迭代修正，末轮由评委裁决。"""
    roles = (
        "你是辩论会诊中的辩论专家甲。先独立给出你的判断与依据；看到同伴观点后，"
        "逐步审视自己与他人的推理，纠正错误并更新结论，最后一轮以“最终答案：”开头给出明确结论。" + _ZH,
        "你是辩论会诊中的辩论专家乙。先独立给出你的判断与依据；看到同伴观点后，"
        "重点挑战证据不足、逻辑跳跃的论断并给出更稳的替代解释，最后一轮以“最终答案：”开头给出明确结论。" + _ZH,
        "你是辩论会诊中的辩论专家丙。先独立给出你的判断与依据；看到同伴观点后，"
        "负责核查证据与影像事实是否被正确引用，指出过度推断，"
        "最后一轮以“最终答案：”开头给出明确结论。" + _ZH,
    )
    nodes: List[NodeSpec] = [_n("in", NodeKind.IO)]
    edges: List[EdgeSpec] = []
    for i, role in enumerate(roles, start=1):
        nodes.append(_n(f"deb{i}", NodeKind.AGENT, f"辩论专家{'甲乙丙'[i - 1]}", role,
                        rbb=True, wbb=True))
        edges += [
            _e("in", f"deb{i}"),
            _e(f"deb{i}", "gate"),
            _e(f"deb{i}", "judge"),
            _e("gate", f"deb{i}", loop=True),
        ]
    nodes += [
        _n("gate", NodeKind.EVALUATOR, "辩论收敛门", _DEBATE_GATE_ROLE),
        _n("judge", NodeKind.AGGREGATOR, "评委裁决",
           "你是辩论评委。请统计各辩手最新答案，按少数服从多数裁决分歧；"
           "若难以裁决，采纳论证最充分的一方并说明理由。给出面向临床的连贯结论。" + _ZH,
           agg=AggregatorStrategy.VOTE),
        _n("out", NodeKind.IO),
    ]
    edges.append(_e("judge", "out"))
    return OrchestrationSpec(
        name="Debate", nodes={n.id: n for n in nodes}, edges=edges,
        entry="in", exit="out", max_rounds=2,
    )


def _mdagents_spec() -> OrchestrationSpec:
    """MDAgents：先评估难度——简单问题单专家直答，复杂问题招募小组协作后表决。"""
    expert_role = (
        "你是受招募的临床专家。请结合会诊组长的工作安排与同伴意见，"
        "基于你的专长独立分析并给出结论与依据。" + _ZH
    )
    nodes = [
        _n("in", NodeKind.IO),
        _n("router", NodeKind.ROUTER, "难度评估路由",
           "你是 MDAgents 的难度评估器。请评估该问题（结合影像）的复杂度："
           "若一名医生即可可靠作答，只回复 solo；若需多名专家协作，只回复 recruiter。",
           targets=["solo", "recruiter"]),
        _n("solo", NodeKind.AGENT, "全科医生", _SINGLE_ROLE),
        _n("recruiter", NodeKind.AGENT, "会诊组长",
           "你是会诊组长（MDAgents 招募者）。请针对该问题拟定简短的多学科工作安排，"
           "明确各专家的分工与关注点。" + _ZH, wbb=True),
        _n("e1", NodeKind.AGENT, "专家一（内科视角）", expert_role, rbb=True, wbb=True),
        _n("e2", NodeKind.AGENT, "专家二（影像视角）", expert_role, rbb=True, wbb=True),
        _n("e3", NodeKind.AGENT, "专家三（专科视角）", expert_role, rbb=True, wbb=True),
        _n("mod", NodeKind.AGGREGATOR, "主持人表决",
           "你是最终决策主持人。请审阅各专家结论，按少数服从多数原则给出最终答案，"
           "分歧较大时说明你的取舍依据。" + _ZH,
           agg=AggregatorStrategy.VOTE),
        _n("out", NodeKind.IO),
    ]
    edges = [
        _e("in", "router"),
        _e("router", "solo"), _e("router", "recruiter"),
        _e("solo", "out"),
        _e("recruiter", "e1"), _e("recruiter", "e2"), _e("recruiter", "e3"),
        _e("e1", "mod"), _e("e2", "mod"), _e("e3", "mod"),
        _e("mod", "out"),
    ]
    return OrchestrationSpec(
        name="MDAgents", nodes={n.id: n for n in nodes}, edges=edges,
        entry="in", exit="out", max_rounds=1,
    )


def _mdteamgpt_spec() -> OrchestrationSpec:
    """MDTeamGPT：全科分诊组建 MDT，各专科逐轮独立发言，组长逐轮综合，直至收敛。"""
    specialist_role = (
        "你是多学科团队（MDT）中的专科成员。每轮发言只依据分诊意见与既往轮次纪要，"
        "保持独立判断，不要假设已看到本轮其他专科的发言；"
        "给出你的发现、鉴别要点与建议。" + _ZH
    )
    specialists = ("影像科医生", "内科医生", "外科医生", "肿瘤科医生")
    nodes: List[NodeSpec] = [
        _n("in", NodeKind.IO),
        _n("triage", NodeKind.AGENT, "全科分诊医生",
           "你是 MDTeamGPT 的全科分诊医生。请概括病例要点，说明为何需要该多学科团队，"
           "并向各专科成员布置本轮关注的重点问题。" + _ZH, wbb=True),
    ]
    edges: List[EdgeSpec] = [_e("in", "triage")]
    for i, name in enumerate(specialists, start=1):
        nodes.append(_n(f"s{i}", NodeKind.AGENT, name, specialist_role, rbb=True, wbb=True))
        edges += [_e("triage", f"s{i}"), _e(f"s{i}", "gate"), _e(f"s{i}", "lead"),
                  _e("gate", f"s{i}", loop=True)]
    nodes += [
        _n("gate", NodeKind.EVALUATOR, "轮次收敛门", _DEBATE_GATE_ROLE),
        _n("lead", NodeKind.AGGREGATOR, "主诊组长",
           "你是 MDT 主诊组长。请汇总本轮各专科发言形成简要会诊纪要（后续轮次将以此为基础），"
           "并给出当前最可能的结论与待办事项。" + _ZH,
           agg=AggregatorStrategy.SUMMARIZE),
        _n("out", NodeKind.IO),
    ]
    edges.append(_e("lead", "out"))
    return OrchestrationSpec(
        name="MDTeamGPT", nodes={n.id: n for n in nodes}, edges=edges,
        entry="in", exit="out", max_rounds=3,
    )


def _reconcile_spec() -> OrchestrationSpec:
    """ReConcile：3 个独立视角先作答并给出置信度，加权调和；未全票一致则辩论修正。"""
    reasoner_roles = (
        ("首选诊断视角", "优先考虑最可能的单一诊断，给出支持要点，并标注你的置信度。"),
        ("鉴别诊断视角", "系统列出需鉴别的疾病谱并逐一排除，给出你倾向的结论，并标注你的置信度。"),
        ("循证核查视角", "核查影像与病史证据是否支撑结论，指出证据缺口，给出修正后的结论，并标注你的置信度。"),
    )
    nodes: List[NodeSpec] = [_n("in", NodeKind.IO)]
    edges: List[EdgeSpec] = []
    for i, (name, task) in enumerate(reasoner_roles, start=1):
        role = (
            f"你是 ReConcile 框架中的独立推理者（{name}）。首轮请完全独立作答，不要参考他人。"
            f"{task}答复最后一行请写“置信度：0.XX”。"
            "后续轮次会看到同伴的最新答案与调和意见，请修正或坚持你的结论并重申置信度。" + _ZH
        )
        nodes.append(_n(f"r{i}", NodeKind.AGENT, name, role, rbb=True, wbb=True))
        edges += [_e("in", f"r{i}"), _e(f"r{i}", "wv"), _e(f"r{i}", "gate"),
                  _e("gate", f"r{i}", loop=True)]
    nodes += [
        _n("wv", NodeKind.AGGREGATOR, "置信度加权调和",
           "你是 ReConcile 的调和裁判。请按各方置信度与论据强度加权裁决："
           "意见一致时直接采纳；不一致时以高置信度方为主并说明取舍。" + _ZH,
           agg=AggregatorStrategy.WEIGHTED),
        _n("gate", NodeKind.EVALUATOR, "全票一致核查",
           _converged_gate_role("仅当各方结论实质一致（同一诊断方向）才判 converged。")),
        _n("out", NodeKind.IO),
    ]
    edges.append(_e("wv", "out"))
    return OrchestrationSpec(
        name="ReConcile", nodes={n.id: n for n in nodes}, edges=edges,
        entry="in", exit="out", max_rounds=3,
    )


def _metaprompting_spec() -> OrchestrationSpec:
    """MetaPrompting：元模型统筹拆解问题，领域专家作答，元模型终审并驱动迭代。"""
    return OrchestrationSpec(
        name="MetaPrompting",
        nodes={
            "in": _n("in", NodeKind.IO),
            "meta": _n("meta", NodeKind.AGENT, "元提示统筹者",
                       "你是 MetaPrompting 的元模型统筹者。请拆解问题、给出向专家咨询的"
                       "具体指引与关注点，但不要自行下诊断结论。" + _ZH, wbb=True),
            "expert": _n("expert", NodeKind.AGENT, "领域专家",
                         "你是受统筹者指派的领域专家。请按其指引逐步作答，"
                         "给出充分推理与明确结论；若指引有偏差，请指出并按医学实际作答。" + _ZH,
                         rbb=True, wbb=True),
            "rev": _n("rev", NodeKind.EVALUATOR, "元提示终审",
                      _converged_gate_role(
                          "若专家答案完整可靠请判 converged；否则给出具体的补问或修正指令。")),
            "fin": _n("fin", NodeKind.AGGREGATOR, "最终答案提炼",
                      "你是 MetaPrompting 的统筹者终审。请依据专家的最新答案与终审意见，"
                      "给出简明、面向临床的最终结论。" + _ZH,
                      agg=AggregatorStrategy.SUMMARIZE),
            "out": _n("out", NodeKind.IO),
        },
        edges=[
            _e("in", "meta"), _e("meta", "expert"),
            _e("expert", "rev"), _e("expert", "fin"),
            _e("rev", "expert", loop=True),
            _e("fin", "out"),
        ],
        entry="in", exit="out", max_rounds=3,
    )


def _autogen_spec() -> OrchestrationSpec:
    """AutoGen：助手智能体与用户代理多轮对话，用户代理判定是否终止并给出反馈。"""
    return OrchestrationSpec(
        name="AutoGen",
        nodes={
            "in": _n("in", NodeKind.IO),
            "asst": _n("asst", NodeKind.AGENT, "助手智能体",
                       "你是 AutoGen 框架中的医学助手智能体。请与用户代理协作完成会诊作答："
                       "给出充分推理与明确结论；收到反馈后逐条回应并修订。" + _ZH,
                       rbb=True, wbb=True),
            "proxy": _n("proxy", NodeKind.EVALUATOR, "用户代理",
                        _converged_gate_role(
                            "若助手回复已完整、可作为交付结论（相当于发出终止消息），判 converged；"
                            "否则指出仍缺失的内容，让助手继续补充。")),
            "out": _n("out", NodeKind.IO),
        },
        edges=[
            _e("in", "asst"), _e("asst", "proxy"), _e("asst", "out"),
            _e("proxy", "asst", loop=True),
        ],
        entry="in", exit="out", max_rounds=3,
    )


def _dylan_spec() -> OrchestrationSpec:
    """DyLAN：分层激活的动态智能体网络，共识早停，最终按高频答案裁决。"""
    roles = (
        ("智能体一（全科视角）", "概括主诉、病程与优先处理事项。"),
        ("智能体二（影像视角）", "聚焦影像证据与判读局限。"),
        ("智能体三（内科视角）", "给出诊断假设与内科处置。"),
        ("智能体四（外科视角）", "评估是否需要手术或操作干预。"),
    )
    nodes: List[NodeSpec] = [_n("in", NodeKind.IO)]
    edges: List[EdgeSpec] = []
    for i, (name, task) in enumerate(roles, start=1):
        role = (
            f"你是 DyLAN 动态分层网络中的独立智能体（{name}）。你的任务：{task}"
            "每轮基于网络中累积的信息更新你的结论；共识达成后不再改动。" + _ZH
        )
        nodes.append(_n(f"a{i}", NodeKind.AGENT, name, role, rbb=True, wbb=True))
        edges += [_e("in", f"a{i}"), _e(f"a{i}", "gate"), _e(f"a{i}", "agg"),
                  _e("gate", f"a{i}", loop=True)]
    nodes += [
        _n("gate", NodeKind.EVALUATOR, "共识早停检查", _DEBATE_GATE_ROLE),
        _n("agg", NodeKind.AGGREGATOR, "高频答案裁决",
           "你是 DyLAN 的答案裁决器。请统计各智能体答案，采纳出现频率最高的结论；"
           "若出现多种说法，选择论据最充分者并说明票数分布。" + _ZH,
           agg=AggregatorStrategy.VOTE),
        _n("out", NodeKind.IO),
    ]
    edges.append(_e("agg", "out"))
    return OrchestrationSpec(
        name="DyLAN", nodes={n.id: n for n in nodes}, edges=edges,
        entry="in", exit="out", max_rounds=3,
    )


def _medagents_spec() -> OrchestrationSpec:
    """MedAgents：招募领域专家→独立分析→报告汇总→综合验证循环，直至结论稳定。"""
    nodes: List[NodeSpec] = [
        _n("in", NodeKind.IO),
        _n("rc", NodeKind.AGENT, "专家招募",
           "你是 MedAgents 的专家招募者。请针对该问题提出 3 位领域专家的角色设定"
           "与各自的分析重点（例如影像、内科、循证）。" + _ZH, wbb=True),
    ]
    edges: List[EdgeSpec] = [_e("in", "rc")]
    for i, name in enumerate(("领域专家一", "领域专家二", "领域专家三"), start=1):
        nodes.append(_n(f"e{i}", NodeKind.AGENT, name,
                        "你是受招募的领域专家。请按招募方案中你的角色独立完成分析，"
                        "给出发现、鉴别与建议。" + _ZH, rbb=True, wbb=True))
        edges += [_e("rc", f"e{i}"), _e(f"e{i}", "rep"), _e(f"e{i}", "gate"),
                  _e("gate", f"e{i}", loop=True)]
    nodes += [
        _n("rep", NodeKind.AGGREGATOR, "会诊报告汇总",
           "你是 MedAgents 的报告汇总者。请把各专家分析整合成一份结构化会诊报告"
           "（发现/鉴别/建议），供下一轮综合验证使用。" + _ZH,
           agg=AggregatorStrategy.SUMMARIZE),
        _n("gate", NodeKind.EVALUATOR, "综合验证门",
           _converged_gate_role("请核对报告是否忠实于各专家意见且结论完整。")),
        _n("out", NodeKind.IO),
    ]
    edges.append(_e("rep", "out"))
    return OrchestrationSpec(
        name="MedAgents", nodes={n.id: n for n in nodes}, edges=edges,
        entry="in", exit="out", max_rounds=3,
    )


def _colacare_spec() -> OrchestrationSpec:
    """ColaCare：内/外/放射三专科给出结构化推荐，主诊裁判官汇总裁决。"""
    def _rec(spec: str) -> str:
        return (
            f"你是 ColaCare 多学科协作中的{spec}。请以结构化方式输出："
            "1) 诊断印象；2) 建议的进一步检查；3) 治疗/管理方案建议；"
            "4) 推荐理由与置信度。" + _ZH
        )
    return OrchestrationSpec(
        name="ColaCare",
        nodes={
            "in": _n("in", NodeKind.IO),
            "c1": _n("c1", NodeKind.AGENT, "内科医生", _rec("内科医生")),
            "c2": _n("c2", NodeKind.AGENT, "外科医生", _rec("外科医生")),
            "c3": _n("c3", NodeKind.AGENT, "放射科医生", _rec("放射科医生")),
            "j": _n("j", NodeKind.AGGREGATOR, "主诊裁判官",
                    "你是 ColaCare 的主诊裁判官（meta reviewer）。请综合三位专科医生的结构化推荐："
                    "消解分歧、去重补充，给出最终的诊断评估与建议方案，并附安全提示。" + _ZH,
                    agg=AggregatorStrategy.SUMMARIZE),
            "out": _n("out", NodeKind.IO),
        },
        edges=[
            _e("in", "c1"), _e("in", "c2"), _e("in", "c3"),
            _e("c1", "j"), _e("c2", "j"), _e("c3", "j"), _e("j", "out"),
        ],
        entry="in", exit="out", max_rounds=1,
    )


def _sc_spec() -> OrchestrationSpec:
    """SC（Self-Consistency）：5 路独立采样推理，按多数派结论裁决。"""
    role = "你是一名医学推理采样器。请独立、逐步地推理并给出你的结论。" + _ZH
    nodes: List[NodeSpec] = [_n("in", NodeKind.IO)]
    edges: List[EdgeSpec] = []
    for i in range(1, 6):
        nodes.append(_n(f"s{i}", NodeKind.AGENT, f"推理样本{i}", role,
                        extra={"temperature": 0.8}))
        edges += [_e("in", f"s{i}"), _e(f"s{i}", "agg")]
    nodes += [
        _n("agg", NodeKind.AGGREGATOR, "多数派裁决",
           "你是 Self-Consistency 的裁决器。请统计 5 份独立答案，"
           "采纳出现频率最高的结论并说明票数分布；无法裁决时选论证最充分者。" + _ZH,
           agg=AggregatorStrategy.VOTE),
        _n("out", NodeKind.IO),
    ]
    edges.append(_e("agg", "out"))
    return OrchestrationSpec(
        name="SelfConsistency", nodes={n.id: n for n in nodes}, edges=edges,
        entry="in", exit="out", max_rounds=1,
    )


def _cot_spec() -> OrchestrationSpec:
    """CoT：单专家思维链推理。"""
    return OrchestrationSpec(
        name="CoT",
        nodes={"in": _n("in", NodeKind.IO),
               "expert": _n("expert", NodeKind.AGENT, "思维链专家",
                            "你是一名经验丰富的医学专家。让我们一步一步思考："
                            "先梳理关键信息与影像发现，再逐步推理，最后给出明确结论。" + _ZH),
               "out": _n("out", NodeKind.IO)},
        edges=[_e("in", "expert"), _e("expert", "out")],
        entry="in", exit="out", max_rounds=1,
    )


_STRATEGY_SPECS = {
    "single": _single_spec,
    "discussion": _discussion_spec,
    "clinical-panel": _clinical_panel_spec,
    "triage-panel": _triage_panel_spec,
    "expert-panel": lambda rounds=None: build_expert_panel(),
    # ---- MedMASLab 方法移植 ----
    "debate": _debate_spec,
    "mdagents": _mdagents_spec,
    "mdteamgpt": _mdteamgpt_spec,
    "reconcile": _reconcile_spec,
    "metaprompting": _metaprompting_spec,
    "autogen": _autogen_spec,
    "dylan": _dylan_spec,
    "medagents": _medagents_spec,
    "colacare": _colacare_spec,
    "sc": _sc_spec,
    "cot": _cot_spec,
}

_STRATEGY_META = {
    "single": "单模型（custom）",
    "discussion": "Discussion 多轮讨论",
    "clinical-panel": "临床专家小组",
    "triage-panel": "急诊分诊小组",
    "expert-panel": "专家会诊（ExpertPanel）",
    # ---- MedMASLab 方法移植 ----
    "debate": "Debate 多智能体辩论",
    "mdagents": "MDAgents 自适应分层会诊",
    "mdteamgpt": "MDTeamGPT 多学科团队（MDT）",
    "reconcile": "ReConcile 多视角调和",
    "metaprompting": "MetaPrompting 元提示编排",
    "autogen": "AutoGen 代理对话",
    "dylan": "DyLAN 动态分层网络",
    "medagents": "MedAgents 专家分析与验证",
    "colacare": "ColaCare 多学科协作推荐",
    "sc": "SC 自一致性投票",
    "cot": "CoT 思维链",
}


# Output rules appended to every orchestrated agent call. Emoji and other
# 4-byte symbols are the characters relays most often corrupt into U+FFFD,
# so models are asked not to use them at all.
_OUTPUT_RULES = (
    "输出规范：请全程使用简体中文作答（医学术语首次出现时可括注英文缩写）；"
    "无论指令或问题使用何种语言，回答一律使用简体中文；"
    "请勿使用 emoji 表情或特殊装饰符号（对勾、警告、圆点等），仅使用简体中文、英文与常规标点；"
    "请直接输出面向用户的最终结论，不要输出思考过程、内部推理或 <think> 等标签内容。"
)


def _make_orchestrated_llm_call(client: Any, model: str, image_parts: List[Dict[str, Any]]):
    """Adapt ``_call_agent`` to the engine's ``llm_call(messages, images)`` contract.

    Returns ``(text, prompt_tokens, completion_tokens)``. The multimodal image
    parts are prepended to the first user message (the engine passes ``images``
    only on round 0). Each call gets its own :class:`WorkflowStats` instance:
    sibling agents execute concurrently (engine tier batches), and a shared
    counter would lose read-modify-write updates and report wrong per-call
    deltas — per-call stats make the usage accounting exact.
    """
    def llm_call(messages, images=None, temperature=None):
        system = next((m["content"] for m in messages if m.get("role") == "system"), None)
        user_text = next((m["content"] for m in messages if m.get("role") == "user"), "")

        if images is not None and image_parts:
            user_content: Any = image_parts + [{"type": "text", "text": user_text}]
        else:
            user_content = user_text

        msgs: List[Dict[str, Any]] = []
        # Chinese-only output rules ride on the system message so every agent
        # (with or without its own role prompt) obeys them.
        msgs.append({
            "role": "system",
            "content": (f"{system}\n{_OUTPUT_RULES}" if system else _OUTPUT_RULES),
        })
        # The user turn carries the actual question (plus the image parts on
        # round 0). Relays such as LiteLLM reject system-only ``messages``
        # with ``400 messages 参数非法``, and even when accepted the model
        # would never see the question — so this append is mandatory.
        if isinstance(user_content, str) and not user_content.strip():
            user_content = "请根据系统指令开始作答。"
        msgs.append({"role": "user", "content": user_content})

        call_stats = WorkflowStats()
        text = _call_agent(
            client, model, msgs, call_stats,
            temperature=0.1 if temperature is None else float(temperature),
        )
        return text, call_stats.prompt_tokens, call_stats.completion_tokens

    return llm_call


# ---------------------------------------------------------------------------
# Live run registry — lets the viewer poll a running MAS workflow in real time.
#
# The POST that executes the workflow is synchronous and only returns the final
# payload; this registry records every engine event as it happens so a separate
# GET endpoint (``/mas/runs/{run_id}``) can serve the live data flow to the
# viewer's popup while the run is still in progress.  Single-process uvicorn
# only: the registry is intentionally in-memory and TTL-pruned.
# ---------------------------------------------------------------------------

_MAS_RUNS: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
_MAS_RUNS_LOCK = Lock()
_MAS_RUN_TTL_SECONDS = 2 * 60 * 60
_MAS_RUN_MAX_ENTRIES = 32


def mas_run_register(run_id: str, strategy: str) -> Dict[str, Any]:
    """Create (or reset) a registry entry for one MAS run."""
    entry: Dict[str, Any] = {
        "run_id": run_id,
        "status": "running",
        "cancelled": False,
        "strategy": strategy,
        "strategy_label": _STRATEGY_META.get(strategy, strategy),
        "spec": None,
        "events": [],
        "trace": None,
        "answer": None,
        "token_stats": None,
        "metadata": None,
        "error": None,
        "updated_ts": time.time(),
    }
    with _MAS_RUNS_LOCK:
        _MAS_RUNS[run_id] = entry
        now = time.time()
        expired = [
            k for k, v in _MAS_RUNS.items() if now - v.get("updated_ts", 0) > _MAS_RUN_TTL_SECONDS
        ]
        for k in expired:
            _MAS_RUNS.pop(k, None)
        while len(_MAS_RUNS) > _MAS_RUN_MAX_ENTRIES:
            _MAS_RUNS.popitem(last=False)
    return entry


def mas_run_update(entry: Dict[str, Any], **fields: Any) -> None:
    """Lock-protected update of a registry entry."""
    with _MAS_RUNS_LOCK:
        entry.update(fields)
        entry["updated_ts"] = time.time()


def mas_run_append_event(entry: Dict[str, Any], event: Dict[str, Any]) -> None:
    """Lock-protected append of one engine trace event (live streaming)."""
    with _MAS_RUNS_LOCK:
        entry["events"].append(event)
        entry["updated_ts"] = time.time()


def mas_run_snapshot(run_id: str) -> Optional[Dict[str, Any]]:
    """Return ``{status, error, payload}`` for a run, or None if unknown.

    ``payload`` matches the viewer's ``MasTracePayload`` shape. While the run
    is in progress the events accumulated so far are served (live view); once
    finished, the exact final trace is served.
    """
    with _MAS_RUNS_LOCK:
        entry = _MAS_RUNS.get(run_id)
        if entry is None:
            return None
        spec = entry.get("spec")
        events = list(entry.get("events") or [])
        status = entry.get("status")
        error = entry.get("error")
        final_trace = entry.get("trace")
        token_stats = entry.get("token_stats")
        metadata = entry.get("metadata")
        answer = entry.get("answer")
        strategy = entry.get("strategy")
        strategy_label = entry.get("strategy_label")

    spec_nodes = (spec or {}).get("nodes") or []
    live_agent_count = sum(
        1 for n in spec_nodes if n.get("kind") in ("agent", "router", "aggregator", "evaluator")
    )

    if final_trace is not None and status in ("done", "error"):
        # Terminal state (done, or degraded/error after the final trace was
        # stored): serve the exact final trace instead of the live-event
        # approximation, so the poller's last snapshot matches what the run
        # actually produced (including the node_error / partial flags).
        trace = final_trace
        rounds = int((metadata or {}).get("rounds", 0))
        agent_count = int((metadata or {}).get("agent_count", live_agent_count))
        stats = dict(token_stats or {})
    else:
        live_rounds = max((int(e.get("round") or 0) for e in events), default=0) + 1
        live_pt = sum(int(e.get("prompt_tokens") or 0) for e in events)
        live_ct = sum(int(e.get("completion_tokens") or 0) for e in events)
        trace = {
            "name": (spec or {}).get("name", ""),
            "final_answer": answer or "",
            # Count per-event usage, not the run totals: once any node reports
            # tokens, ``live_pt or live_ct`` is truthy for the whole run and
            # would wrongly count every event (start/edge/route) as a call.
            "num_llm_calls": sum(
                1
                for e in events
                if e.get("prompt_tokens") or e.get("completion_tokens") or e.get("type") == "node_end"
            ),
            "prompt_tokens": live_pt,
            "completion_tokens": live_ct,
            "rounds": live_rounds,
            "events": events,
        }
        rounds = live_rounds
        agent_count = live_agent_count
        stats = {
            "num_llm_calls": trace["num_llm_calls"],
            "prompt_tokens": live_pt,
            "completion_tokens": live_ct,
        }

    payload = {
        "answer": answer or "",
        "strategy": strategy,
        "strategy_label": strategy_label,
        "agent_count": agent_count,
        "rounds": rounds,
        "token_stats": stats,
        "spec": spec,
        "trace": trace,
    }
    return {"status": status, "error": error, "payload": payload}


def mas_run_cancel(run_id: str) -> bool:
    """Mark a running workflow cancelled (cooperative engine abort).

    Returns True when the run exists. Unknown/finished runs are a no-op.
    The engine checks the flag between LLM calls and raises
    :class:`WorkflowCancelled`, which terminates the run without further
    model calls (the viewer starts a newer run that supersedes it).
    """
    with _MAS_RUNS_LOCK:
        entry = _MAS_RUNS.get(run_id)
        if entry is None:
            return False
        if entry.get("status") == "running":
            entry["cancelled"] = True
            entry["updated_ts"] = time.time()
        return True


# ---------------------------------------------------------------------------
# Checkpoint / resume ("断点续传").
#
# Completed node outputs are persisted to disk keyed by ``run_id`` so that a
# multi-agent run that dies part-way (upstream timeout / 5xx after the retry
# budget) can be resumed by re-submitting the same ``mas_run_id``: the engine
# replays already-finished nodes instead of re-invoking the model and starting
# from zero. On success the checkpoint is deleted; on failure it is retained
# for the next attempt. All disk I/O is best-effort — checkpoint failures must
# never break a clinical workflow.
# ---------------------------------------------------------------------------

_MAS_CHECKPOINT_ENV_DIR = "MONAI_LABEL_MAS_CHECKPOINT_DIR"


def _mas_checkpoint_dir() -> str:
    base = os.environ.get(_MAS_CHECKPOINT_ENV_DIR) or tempfile.gettempdir()
    return os.path.join(base, "monailabel-mas-checkpoints")


def _mas_checkpoint_path(run_id: str) -> str:
    return os.path.join(_mas_checkpoint_dir(), f"{run_id}.json")


def mas_checkpoint_save(
    run_id: str,
    strategy: str,
    model: str,
    nodes: Dict[str, Any],
) -> None:
    """Best-effort persist of completed node outputs for a run."""
    try:
        path = _mas_checkpoint_path(run_id)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        payload = {
            "run_id": run_id,
            "strategy": strategy,
            "model": model,
            "updated_ts": time.time(),
            "nodes": nodes,
        }
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception:
        logger.exception("MAS checkpoint save failed for run_id=%s", run_id)


def mas_checkpoint_load(run_id: str) -> Optional[Dict[str, Any]]:
    """Load a persisted checkpoint for a run, or None if absent/corrupt."""
    try:
        path = _mas_checkpoint_path(run_id)
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return None
        return data
    except Exception:
        logger.exception("MAS checkpoint load failed for run_id=%s", run_id)
        return None


def mas_checkpoint_clear(run_id: str) -> None:
    """Remove a checkpoint once a run has completed successfully."""
    try:
        path = _mas_checkpoint_path(run_id)
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        logger.exception("MAS checkpoint clear failed for run_id=%s", run_id)


def run_orchestrated_workflow(
    *,
    client: Any,
    model: str,
    strategy: str,
    question: str,
    initial_content: Any,
    rounds: int = 2,
    run_id: Optional[str] = None,
) -> Tuple[str, Dict[str, int], Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
    """Run a strategy through the orchestration engine and return the full trace.

    Returns ``(answer, token_stats, metadata, spec_dict, trace_dict)`` where
    ``spec_dict`` (nodes/edges) and ``trace_dict`` (event stream) are what the
    viewer needs to render the live agent data-flow visualization.

    When ``run_id`` is provided, every engine event is also streamed into an
    in-process registry (see :func:`mas_run_snapshot`) so the viewer can poll
    the run in real time while the POST request is still in flight.

    A degraded run (a node exhausted its retry budget) is a failed
    consultation: the registry entry is recorded with ``status="error"`` and
    the full intermediate trace, the checkpoint is retained for resume, and
    :class:`MASWorkflowError` is raised so the synchronous request fails
    instead of returning an empty answer.
    """
    strategy = (strategy or "single").strip().lower()
    builder = _STRATEGY_SPECS.get(strategy)
    if builder is None:
        raise MASWorkflowError(
            f"Unknown mas_strategy: {strategy}. Available: "
            f"{', '.join(sorted(_STRATEGY_SPECS))}."
        )

    entry = mas_run_register(run_id, strategy) if run_id else None
    spec = builder(rounds) if strategy == "discussion" else builder()
    if entry is not None:
        mas_run_update(entry, spec=spec.to_dict())

    # Resume ("断点续传"): load any persisted node outputs from a prior failed
    # attempt of this run so completed steps are replayed instead of re-invoked.
    completed: Dict[str, Any] = {}
    if run_id:
        checkpoint = mas_checkpoint_load(run_id)
        if checkpoint and checkpoint.get("strategy") == strategy and checkpoint.get("model") == model:
            completed = dict(checkpoint.get("nodes") or {})

    image_parts = _extract_image_parts(initial_content)
    llm_call = _make_orchestrated_llm_call(client, model, image_parts)
    agent = Agent(llm_call=llm_call, model_name=model)

    # Serializes checkpoint writes from the engine's concurrent worker threads.
    _checkpoint_lock = Lock()

    def on_node_complete(round_no, nid, out_text, pt, ct, meta):
        if run_id is None:
            return
        # The engine completes sibling nodes concurrently, so the checkpoint
        # append + disk write must be serialized: concurrent json.dump calls
        # on the same tmp path would interleave and corrupt the file.
        with _checkpoint_lock:
            completed[f"{round_no}:{nid}"] = {
                "output": out_text,
                "prompt_tokens": int(pt or 0),
                "completion_tokens": int(ct or 0),
                "meta": dict(meta or {}),
            }
            mas_checkpoint_save(run_id, strategy, model, completed)

    engine = RuntimeEngine(
        spec, agent,
        on_event=(lambda ev: mas_run_append_event(entry, ev)) if entry is not None else None,
        should_abort=(lambda: bool(entry.get("cancelled"))) if entry is not None else None,
        on_node_complete=on_node_complete if run_id else None,
    )
    try:
        result = engine.run(question, images=initial_content, completed=completed)
    except WorkflowCancelled:
        # Superseded by a newer run — record a distinct terminal status so the
        # viewer's poller stops without surfacing this as an error.
        if entry is not None:
            mas_run_update(entry, status="cancelled", error="superseded by a newer run")
        raise
    except Exception as exc:
        # Keep the checkpoint so the next attempt can resume from here instead
        # of restarting from zero; record the failure on the registry.
        if entry is not None:
            mas_run_update(entry, status="error", error=str(exc))
        raise

    # A fully successful run no longer needs its checkpoint. A degraded run
    # (one or more agents exhausted their retry budget) keeps its checkpoint
    # so the client can re-submit the same ``mas_run_id`` and resume only the
    # failed steps instead of restarting the whole consultation from zero.
    if run_id and not result.degraded:
        mas_checkpoint_clear(run_id)

    token_stats: Dict[str, int] = {
        "num_llm_calls": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
    }
    for stats in result.token_stats.values():
        token_stats["num_llm_calls"] += int(stats.get("num_llm_calls", 0))
        token_stats["prompt_tokens"] += int(stats.get("prompt_tokens", 0))
        token_stats["completion_tokens"] += int(stats.get("completion_tokens", 0))

    metadata = {
        "strategy": strategy,
        "strategy_label": _STRATEGY_META.get(strategy, strategy),
        "agent_count": spec.num_agents(),
        "rounds": result.rounds,
    }
    trace_dict = result.trace.to_dict()

    # A failed node invalidates the consultation. Preserve intermediate agent
    # outputs in the trace for diagnosis, but never return them as answer or
    # store the run as done.
    answer = result.final_answer
    if result.degraded:
        metadata["partial"] = True
        metadata["error"] = result.degraded
        trace_dict["partial"] = True
        trace_dict["error"] = result.degraded
        answer = ""

    if entry is not None:
        mas_run_update(
            entry,
            status="error" if result.degraded else "done",
            answer=answer,
            token_stats=token_stats,
            metadata=metadata,
            trace=trace_dict,
            error=result.degraded,
        )
    if result.degraded:
        # The synchronous POST must not return 200 with an empty answer (the
        # viewer would render it as a successful consultation). Reject the
        # request with the failed node's reason; the run registry and the
        # retained checkpoint already hold the intermediate results, and the
        # client can re-submit the same ``mas_run_id`` to resume.
        raise MASWorkflowError(
            "本次多智能体会诊未完整完成："
            f"{result.degraded}。已完成步骤已通过检查点保留，重新提交相同请求可断点续传。"
        )
    return (
        answer,
        token_stats,
        metadata,
        spec.to_dict(),
        trace_dict,
    )
