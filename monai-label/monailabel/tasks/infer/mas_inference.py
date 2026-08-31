"""Lightweight medical multi-agent workflows for the custom VLM endpoint.

This module keeps the orchestration layer inside MONAI Label while reusing the
same OpenAI-compatible multimodal request format as the existing ``custom``
VLM path.  It is intentionally independent of the heavyweight local-model
imports in MedMASLab, so a remote OpenAI-compatible endpoint only needs the
``openai`` package.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Sequence, Tuple
import time


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
        "Primary Care Physician",
        "initial assessment and differential diagnosis",
        "Clarify the clinical problem, timeline, red flags, differential diagnosis, and initial workup.",
    ),
    AgentProfile(
        "Emergency and Critical Care Clinician",
        "triage and time-sensitive diagnoses",
        "Look for life-threatening findings, urgent escalation thresholds, and must-not-miss diagnoses.",
    ),
    AgentProfile(
        "Radiologist",
        "medical-image interpretation and imaging pitfalls",
        "Describe visible imaging patterns cautiously, identify limitations, and give a structured impression.",
    ),
    AgentProfile(
        "Clinical Pharmacist",
        "medication safety and treatment optimization",
        "Consider medication options, contraindications, interactions, monitoring, and renal or hepatic adjustment when relevant.",
    ),
)

TRIAGE_PROFILES: Tuple[AgentProfile, ...] = (
    DISCUSSION_PROFILES[1],
    DISCUSSION_PROFILES[2],
    AgentProfile(
        "Relevant Clinical Specialist",
        "organ-system differential diagnosis and management",
        "Focus on the organ system and clinical context in the question, and identify the next safest action.",
    ),
)


class MASWorkflowError(ValueError):
    """Raised when a multi-agent workflow cannot be executed."""


def _message_text(response: Any) -> str:
    """Extract text from OpenAI-compatible response objects and dictionaries."""
    try:
        message = response.choices[0].message
    except (AttributeError, IndexError, TypeError) as exc:
        raise MASWorkflowError("The model returned no assistant message.") from exc

    content = getattr(message, "content", None)
    if content is None and isinstance(message, dict):
        content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
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
        if parts:
            return "".join(parts).strip()

    # Some reasoning models return an empty final ``content`` when the completion
    # budget is exhausted. Preserve the available text instead of misdiagnosing
    # a successful upstream response as a transport failure.
    reasoning = getattr(message, "reasoning_content", None)
    if reasoning is None and isinstance(message, dict):
        reasoning = message.get("reasoning_content")
    return str(reasoning or "").strip()


def _call_agent(
    client: Any,
    model: str,
    messages: List[Dict[str, Any]],
    stats: WorkflowStats,
) -> str:
    last_error: Exception | None = None
    for attempt, max_tokens in enumerate((1536, 1024, 768)):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.1,
                # Keep each specialist call below common relay/ALB time limits.
                max_tokens=max_tokens,
            )
            stats.calls += 1
            stats.add_usage(response)
            answer = _message_text(response)
            if answer:
                return answer
            last_error = MASWorkflowError(
                "The model returned an empty assistant message; the output budget may be exhausted."
            )
        except Exception as exc:
            last_error = exc
            retryable = any(
                marker in str(exc).lower()
                for marker in ("408", "429", "500", "502", "503", "504", "timeout", "temporarily")
            )
            if not retryable:
                raise
        if attempt < 2:
            time.sleep(1.5 * (attempt + 1))

    if last_error is not None:
        if isinstance(last_error, MASWorkflowError):
            raise last_error
        raise last_error
    raise MASWorkflowError("The model request failed without a response.")


def _role_system(profile: AgentProfile) -> str:
    return (
        "You are part of a medical review team. Your output supports clinical reasoning "
        "and is not a definitive diagnosis. Do not invent findings that are not visible "
        "or supplied in the case. State uncertainty and recommend professional review "
        "when appropriate.\n\n"
        f"Your role: {profile.name}.\n"
        f"Your specialty: {profile.specialty}.\n"
        f"Your task: {profile.instruction}"
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
        "You are the chief medical reviewer. Synthesize the independent reports below "
        "for the question. Separate observed imaging facts from hypotheses, resolve "
        "disagreements, identify missing information, and give a concise prioritized "
        "clinical conclusion with recommended next steps. Include an explicit safety "
        "note that this does not replace a qualified clinician.\n\n"
        f"Question: {question}\n\nReports:\n{_report_block(reports)}"
    )
    return _call_agent(
        client,
        model,
        [
            {"role": "system", "content": "You are a senior medical reviewer."},
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
        "Act as the final triage lead. Review these specialist assessments and answer "
        "the original question. Prioritize immediate danger, urgency, the most likely "
        "explanation, and the next action. Do not claim certainty beyond the provided "
        "image and history. Return a concise clinical response followed by a safety "
        "disclaimer.\n\n"
        f"Question: {question}\n\nAssessments:\n{_report_block(reports)}"
    )
    return _call_agent(
        client,
        model,
        [
            {"role": "system", "content": "You are a senior emergency triage reviewer."},
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
                f"Original question: {question}\n\n"
                "Review the other specialists' assessments below. Correct errors, state "
                "where evidence is insufficient, and provide your updated assessment. "
                f"This is discussion round {round_index + 1} of {rounds}.\n\n"
                f"Peer assessments:\n{_report_block(peer_reports)}"
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
        "You are the lead reviewer. Use the final specialist assessments to answer the "
        "original question. Give one coherent, prioritized answer; distinguish image "
        "observations from possible diagnoses and include safe next steps. Add a short "
        "statement that the output is decision support, not a diagnosis.\n\n"
        f"Question: {question}\n\nFinal assessments:\n{_report_block(reports)}"
    )
    return _call_agent(
        client,
        model,
        [
            {"role": "system", "content": "You are the lead medical reviewer."},
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
