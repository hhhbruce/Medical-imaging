"""Unified orchestration engine for MONAI Label multi-agent (MAS) inference.

A declarative ``OrchestrationSpec`` (typed nodes + directed edges + control
primitives) executed by a super-step scheduler that emits a full ``Trace``
event stream. That trace powers the runtime data-flow visualization rendered
in the OHIF viewer.

Migrated from MedMASLab's ``methods/orchestration`` package. Lightweight on
purpose: every module depends only on the Python standard library so the
engine can be unit-tested without torch/gradio/openai installed.
"""

from .messages import Message, Trace, TraceEvent
from .blackboard import Blackboard
from .spec import (
    NodeKind,
    NodeSpec,
    EdgeSpec,
    OrchestrationSpec,
    AggregatorStrategy,
)
from .agent import Agent, MockAgent
from .engine import RuntimeEngine, RunResult, WorkflowCancelled
from .tracer import write_trace_jsonl, load_trace_jsonl
from .report import render_html, save_report

__all__ = [
    "Message",
    "Trace",
    "TraceEvent",
    "Blackboard",
    "NodeKind",
    "NodeSpec",
    "EdgeSpec",
    "OrchestrationSpec",
    "AggregatorStrategy",
    "Agent",
    "MockAgent",
    "RuntimeEngine",
    "RunResult",
    "WorkflowCancelled",
    "write_trace_jsonl",
    "load_trace_jsonl",
    "render_html",
    "save_report",
]
