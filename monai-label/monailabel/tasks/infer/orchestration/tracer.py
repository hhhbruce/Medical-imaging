"""Trace serialization for the orchestration engine.

The engine emits a :class:`~monailabel.tasks.infer.orchestration.messages.Trace`
directly; this module adds (de)serialization so a run can be persisted to JSONL
and later replayed by the viewer-side visualization.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from .messages import Trace, TraceEvent


def trace_to_dict(trace: Trace) -> Dict[str, Any]:
    return trace.to_dict()


def write_trace_jsonl(trace: Trace, path) -> str:
    """Write a single-run trace as one JSON line (self-describing)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(trace.to_dict(), ensure_ascii=False) + "\n")
    return str(path)


def load_trace_jsonl(path) -> Trace:
    path = Path(path)
    with open(path, "r", encoding="utf-8") as f:
        data = json.loads(f.readline())
    trace = Trace(name=data.get("name", path.stem))
    trace.final_answer = data.get("final_answer", "")
    trace.num_llm_calls = data.get("num_llm_calls", 0)
    trace.prompt_tokens = data.get("prompt_tokens", 0)
    trace.completion_tokens = data.get("completion_tokens", 0)
    trace.rounds = data.get("rounds", 0)
    for ev in data.get("events", []):
        trace.events.append(
            TraceEvent(
                ts=ev.get("ts", 0.0),
                type=ev.get("type", ""),
                node=ev.get("node"),
                src=ev.get("src"),
                dst=ev.get("dst"),
                content=ev.get("content", ""),
                prompt_tokens=ev.get("prompt_tokens", 0),
                completion_tokens=ev.get("completion_tokens", 0),
                round=ev.get("round", 0),
                meta=ev.get("meta", {}),
            )
        )
    return trace
