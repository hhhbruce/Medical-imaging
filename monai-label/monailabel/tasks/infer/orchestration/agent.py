"""Unified agent abstraction used by the engine.

The engine is decoupled from any concrete LLM backend: it talks to an
:class:`Agent` that knows how to turn a :class:`NodeSpec` + inputs into an
answer (or routing decision / convergence verdict). Two implementations ship:

* :class:`Agent` — production wrapper around an OpenAI-compatible ``llm_call``,
  with token accounting.
* :class:`MockAgent` — deterministic, dependency-free, used for offline tests.
"""
from __future__ import annotations

import re
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple

from .spec import NodeSpec, AggregatorStrategy


# ``llm_call(messages, images, temperature) -> (text, prompt_tokens, completion_tokens)``
LLMCall = Callable[..., Tuple[str, int, int]]

_OPTION_RE = re.compile(r"\(([A-Fa-f])\)|\b([A-Fa-f])\b")


class Agent:
    """Production agent wrapper. Defaults to a no-op call if none is given."""

    def __init__(self, llm_call: Optional[LLMCall] = None, model_name: str = "model"):
        self.llm_call: LLMCall = llm_call or (
            lambda messages, images=None, temperature=None: ("", 0, 0)
        )
        self.model_name = model_name
        self.token_stats: Dict[str, Dict[str, int]] = {
            model_name: {"num_llm_calls": 0, "prompt_tokens": 0, "completion_tokens": 0}
        }
        # Sibling nodes may execute in parallel (RuntimeEngine tier batches),
        # and the token counters are read-modify-write — guard them.
        self._stats_lock = threading.Lock()

    def _call(self, system: str, user: str, images=None, temperature: Optional[float] = None) -> Tuple[str, int, int]:
        messages: List[Dict[str, Any]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})
        text, pt, ct = self.llm_call(messages, images, temperature)
        with self._stats_lock:
            st = self.token_stats[self.model_name]
            st["num_llm_calls"] += 1
            st["prompt_tokens"] += int(pt or 0)
            st["completion_tokens"] += int(ct or 0)
        return text or "", int(pt or 0), int(ct or 0)

    def credit_tokens(self, prompt_tokens: int, completion_tokens: int) -> None:
        """Account tokens already spent in a prior (checkpointed) attempt.

        Used by the engine when a resumed run replays a completed node
        instead of re-invoking the model, so aggregate stats stay truthful.
        """
        with self._stats_lock:
            st = self.token_stats.setdefault(
                self.model_name,
                {"num_llm_calls": 0, "prompt_tokens": 0, "completion_tokens": 0},
            )
            st["num_llm_calls"] += 1
            st["prompt_tokens"] += int(prompt_tokens or 0)
            st["completion_tokens"] += int(completion_tokens or 0)

    # -- engine callbacks ---------------------------------------------------

    def respond(self, node: NodeSpec, query: str, inputs: List[str], images, round_no: int) -> Tuple[str, int, int]:
        system = node.role_prompt or "你是一名经验丰富的医学专家。请全程使用简体中文作答。"
        ctx = "\n\n".join(x for x in inputs if x)
        if ctx:
            user = f"问题：\n{query}\n\n相关背景 / 其他专家意见：\n{ctx}\n\n请回答上述问题。"
        else:
            user = f"问题：\n{query}\n\n请回答上述问题。"
        return self._call(system, user, images, temperature=node.extra.get("temperature"))

    def route(self, node: NodeSpec, query: str, inputs: List[str], images, round_no: int) -> Tuple[str, int, int]:
        opts = ", ".join(node.route_targets)
        system = node.role_prompt or "你是一名分诊路由器。请选出唯一最合适的分支。"
        user = (
            f"问题：\n{query}\n\n"
            f"请从 [{opts}] 中选择恰好一个目标 id，只回复该目标 id 本身。"
        )
        return self._call(system, user, images)

    def aggregate(self, node: NodeSpec, query: str, inputs: List[str], images, round_no: int) -> Tuple[str, int, int]:
        strategy = node.aggregator or AggregatorStrategy.VOTE
        if strategy == AggregatorStrategy.CONCAT:
            return "\n\n".join(inputs), 0, 0
        if strategy in (AggregatorStrategy.VOTE, AggregatorStrategy.WEIGHTED):
            voted = self._weighted_vote(inputs) if strategy == AggregatorStrategy.WEIGHTED else self._majority_vote(inputs)
            if voted:
                return voted, 0, 0
        # fall back to LLM synthesis
        system = node.role_prompt or "你是会诊主持人。请把各专家意见综合为一份最终结论。"
        ctx = "\n\n".join(x for x in inputs if x)
        user = f"问题：\n{query}\n\n专家意见：\n{ctx}\n\n请给出最终结论。"
        return self._call(system, user, images)

    def evaluate(self, node: NodeSpec, query: str, inputs: List[str], images, round_no: int) -> Tuple[bool, str, int, int]:
        """Judge convergence via the LLM and return a refinement critique."""
        system = node.role_prompt or (
            "你是一名严谨的医学评审。请判断各位专家是否已就同一结论达成收敛；"
            "若尚未收敛，请给出一段可供他们改进的简明意见。"
        )
        ctx = "\n\n".join(x for x in inputs if x)
        user = (
            f"问题：\n{query}\n\n专家意见：\n{ctx}\n\n"
            "请先输出恰好一个英文判定词（'converged' 表示已收敛，'not converged' 表示未收敛），"
            "随后用一句简体中文给出给各专家的修改意见。"
        )
        text, pt, ct = self._call(system, user, images)
        low = (text or "").lower()
        if "not converged" in low:
            converged = False
        else:
            converged = "converged" in low
        return converged, text or "", pt, ct

    # -- voting helpers -----------------------------------------------------

    def _extract_letters(self, text: str) -> List[str]:
        letters = [m.group(1) or m.group(2) for m in _OPTION_RE.finditer(text)]
        return [c.upper() for c in letters if c]

    def _majority_vote(self, inputs: List[str]) -> Optional[str]:
        counts: Dict[str, int] = {}
        for text in inputs:
            letters = self._extract_letters(text)
            if not letters:
                continue
            counts[letters[0]] = counts.get(letters[0], 0) + 1
        if not counts:
            return None
        best = max(counts, key=counts.get)
        ties = [k for k, v in counts.items() if v == counts[best]]
        return None if len(ties) > 1 else best

    def _weighted_vote(self, inputs: List[str]) -> Optional[str]:
        weights: Dict[str, float] = {}
        for text in inputs:
            letters = self._extract_letters(text)
            if not letters:
                continue
            w = 1.0
            m = re.search(r"confidence[:\s]*([0-9.]+)", text, re.IGNORECASE)
            if m:
                try:
                    w = float(m.group(1))
                except ValueError:
                    w = 1.0
            key = letters[0]
            weights[key] = weights.get(key, 0.0) + w
        if not weights:
            return None
        return max(weights, key=weights.get)

    def get_token_stats(self) -> Dict[str, Dict[str, int]]:
        return self.token_stats


class MockAgent(Agent):
    """Deterministic agent for offline engine tests. No heavy dependencies."""

    def __init__(self, answers: Optional[Dict[str, str]] = None, router_choice: str = "basic"):
        super().__init__(llm_call=self._fake_llm, model_name="mock")
        self.answers = answers or {}
        self.router_choice = router_choice
        self.converge_after_round = 1
        self.calls: List[str] = []

    def _fake_llm(self, messages, images=None, temperature=None) -> Tuple[str, int, int]:
        return "(A) mock answer", 10, 4

    def respond(self, node, query, inputs, images, round_no):
        self.calls.append(node.id)
        return self.answers.get(node.id, "(A) mock answer"), 10, 4

    def route(self, node, query, inputs, images, round_no):
        self.calls.append(node.id)
        return self.router_choice, 3, 1

    def aggregate(self, node, query, inputs, images, round_no):
        strategy = node.aggregator or AggregatorStrategy.VOTE
        if strategy in (AggregatorStrategy.VOTE, AggregatorStrategy.WEIGHTED):
            voted = self._weighted_vote(inputs) if strategy == AggregatorStrategy.WEIGHTED else self._majority_vote(inputs)
            if voted:
                return voted, 0, 0
        return "\n".join(inputs), 0, 0

    def evaluate(self, node, query, inputs, images, round_no):
        self.calls.append(node.id)
        converged = round_no >= self.converge_after_round
        return converged, ("consensus" if converged else "not converged"), 3, 1
