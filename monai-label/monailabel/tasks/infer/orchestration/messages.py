"""Core data structures for orchestration tracing.

A ``Message`` is the atomic unit of data flow between agents. A ``TraceEvent``
is one observability record emitted by the engine (node start/end, edge hop,
routing decision, loop iteration, final answer). A ``Trace`` is the ordered
collection of events for one run, plus aggregate token/round accounting.
"""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class Message:
    """One message passed between two agents (or the input/output boundary)."""

    id: str
    src: str
    dst: str
    content: str
    role: str = "assistant"
    prompt_tokens: int = 0
    completion_tokens: int = 0
    meta: Dict[str, Any] = field(default_factory=dict)
    ts: float = field(default_factory=time.time)

    def __post_init__(self):
        if not self.id:
            self.id = uuid.uuid4().hex

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TraceEvent:
    """A single observability record.

    ``type`` is one of:
      run_start, node_start, node_end, edge, route, loop, final.
    """

    ts: float
    type: str
    node: Optional[str]
    src: Optional[str]
    dst: Optional[str]
    content: str
    prompt_tokens: int
    completion_tokens: int
    round: int
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["ts"] = round(d["ts"], 4)
        return d


class Trace:
    """Ordered event stream for a single orchestration run.

    ``on_event`` is an optional callback fired for every appended event (with
    its serialized dict) so a live consumer — e.g. the viewer-side data-flow
    polling endpoint — can stream the run in real time. Callback failures are
    swallowed: tracing must never break a clinical workflow.
    """

    def __init__(self, name: str, on_event: Optional[Callable[[Dict[str, Any]], None]] = None):
        self.name = name
        self.on_event = on_event
        self.events: List[TraceEvent] = []
        self.final_answer: str = ""
        self.num_llm_calls: int = 0
        self.prompt_tokens: int = 0
        self.completion_tokens: int = 0
        self.rounds: int = 0

    def add(
        self,
        type: str,
        node: Optional[str] = None,
        src: Optional[str] = None,
        dst: Optional[str] = None,
        content: str = "",
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        round: int = 0,
        meta: Optional[Dict[str, Any]] = None,
    ) -> TraceEvent:
        ev = TraceEvent(
            ts=time.time(),
            type=type,
            node=node,
            src=src,
            dst=dst,
            content=content or "",
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            round=round,
            meta=meta or {},
        )
        self.events.append(ev)
        if self.on_event is not None:
            try:
                self.on_event(ev.to_dict())
            except Exception:  # pragma: no cover - tracing must never break a run
                logger.exception("Trace on_event callback failed")
        return ev

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "final_answer": self.final_answer,
            "num_llm_calls": self.num_llm_calls,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "rounds": self.rounds,
            "events": [e.to_dict() for e in self.events],
        }
