"""Declarative orchestration specification (the "DSL").

An :class:`OrchestrationSpec` is a typed directed graph:

* nodes have a :class:`NodeKind` (agent / router / aggregator / evaluator /
  blackboard / io) and behaviour flags;
* edges are the data-flow links (message routing);
* ``entry`` / ``exit`` mark the input and answer boundaries;
* ``max_rounds`` caps any loop (evaluator-optimizer, reflection, debate rounds).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class NodeKind(str, Enum):
    IO = "io"                    # pass-through boundary (input/output)
    AGENT = "agent"              # one LLM call with a role prompt
    ROUTER = "router"            # picks exactly one downstream branch
    AGGREGATOR = "aggregator"    # combines several inputs into one (vote/summarize)
    EVALUATOR = "evaluator"      # gate: decides convergence (drives loops)
    BLACKBOARD = "blackboard"    # shared memory (not executed as an LLM node)


class AggregatorStrategy(str, Enum):
    VOTE = "vote"                # majority vote over option letters
    WEIGHTED = "weighted"        # confidence-weighted vote
    SUMMARIZE = "summarize"      # LLM synthesis
    CONCAT = "concat"            # plain concatenation (no LLM)


@dataclass
class NodeSpec:
    id: str
    kind: NodeKind
    name: str = ""
    role_prompt: str = ""          # system/role prompt for LLM-backed nodes
    aggregator: str = AggregatorStrategy.VOTE
    route_targets: List[str] = field(default_factory=list)   # router candidates
    read_blackboard: bool = False
    write_blackboard: bool = False
    extra: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.name:
            self.name = self.id


@dataclass
class EdgeSpec:
    src: str
    dst: str
    port: str = ""    # optional label ("continue"/"stop", route label, ...)
    loop: bool = False  # marks a feedback/back edge that drives a bounded loop


@dataclass
class OrchestrationSpec:
    name: str
    nodes: Dict[str, NodeSpec]
    edges: List[EdgeSpec]
    entry: str
    exit: str
    max_rounds: int = 4

    def validate(self) -> None:
        ids = set(self.nodes)
        if self.entry not in ids:
            raise ValueError(f"entry node '{self.entry}' missing")
        if self.exit not in ids:
            raise ValueError(f"exit node '{self.exit}' missing")
        for e in self.edges:
            if e.src not in ids:
                raise ValueError(f"edge src '{e.src}' missing")
            if e.dst not in ids:
                raise ValueError(f"edge dst '{e.dst}' missing")
        for nid, node in self.nodes.items():
            if node.kind is NodeKind.ROUTER and not node.route_targets:
                raise ValueError(f"router '{nid}' needs route_targets")
            if node.kind is NodeKind.ROUTER:
                for t in node.route_targets:
                    if t not in ids:
                        raise ValueError(f"router '{nid}' target '{t}' missing")

    def num_agents(self) -> int:
        return sum(
            1 for n in self.nodes.values()
            if n.kind in (NodeKind.AGENT, NodeKind.ROUTER, NodeKind.AGGREGATOR, NodeKind.EVALUATOR)
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize the graph (nodes + edges) for the viewer-side visualization."""
        return {
            "name": self.name,
            "entry": self.entry,
            "exit": self.exit,
            "max_rounds": self.max_rounds,
            "nodes": [
                {
                    "id": nid,
                    "name": node.name,
                    "kind": node.kind.value,
                }
                for nid, node in self.nodes.items()
            ],
            "edges": [
                {"src": e.src, "dst": e.dst, "port": e.port, "loop": e.loop}
                for e in self.edges
            ],
        }
