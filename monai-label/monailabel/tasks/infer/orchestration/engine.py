"""RuntimeEngine — the super-step scheduler.

Executes an :class:`OrchestrationSpec` as a dataflow graph:

* forward edges form a DAG, executed in topological order;
* back-edges (detected via DFS) drive bounded loops — evaluator-optimizer,
  reflection, and debate rounds;
* sibling nodes in the same dependency tier are executed in parallel;
* ROUTER nodes fan out to exactly one branch; AGGREGATOR nodes combine;
* BLACKBOARD nodes provide shared memory (agents read before / write after);
* every step emits a :class:`TraceEvent` for the runtime visualization.

The scheduler never touches an LLM directly — it delegates to an
:class:`Agent` (or :class:`MockAgent`), which keeps the engine unit-testable.
"""
from __future__ import annotations

import threading
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from .agent import Agent
from .blackboard import Blackboard
from .messages import Trace
from .spec import NodeKind, NodeSpec, OrchestrationSpec


@dataclass
class RunResult:
    final_answer: str
    trace: Trace
    token_stats: Dict[str, Dict[str, int]]
    current_config: Dict[str, int]
    rounds: int
    agent: Agent


class RuntimeEngine:
    def __init__(
        self,
        spec: OrchestrationSpec,
        agent: Agent,
        max_workers: int = 4,
        on_event: Optional[Callable[[Dict[str, Any]], None]] = None,
    ):
        spec.validate()
        self.spec = spec
        self.agent = agent
        self.max_workers = max_workers
        # Optional per-event callback fired as the run progresses (live view).
        self.on_event = on_event
        self._succ: Dict[str, List[Tuple[str, Any]]] = defaultdict(list)
        self._pred: Dict[str, List[str]] = defaultdict(list)
        self._back_edges = set()
        self._topo: List[str] = []
        self._loop_body = set()
        self._bb_read: set = set()
        self._bb_write: set = set()
        self._build_graph()

    # -- graph construction -------------------------------------------------

    def _is_bb(self, nid: str) -> bool:
        return self.spec.nodes[nid].kind is NodeKind.BLACKBOARD

    def _build_graph(self) -> None:
        for e in self.spec.edges:
            self._succ[e.src].append((e.dst, e))
            self._pred[e.dst].append(e.src)

        # Loop/back-edge detection. Specs may mark feedback edges explicitly
        # (``loop=True``); when they do, those edges are authoritative (DFS
        # alone mis-labels edges in mutual cycles like debate's gate↔agent).
        explicit_loops = {(e.src, e.dst) for e in self.spec.edges if e.loop}
        if explicit_loops:
            self._back_edges = set(explicit_loops)
        else:
            visited = set()
            onstack = set()

            def dfs(u: str) -> None:
                if self._is_bb(u):
                    return
                visited.add(u)
                onstack.add(u)
                for (v, _e) in self._succ[u]:
                    if self._is_bb(v):
                        continue
                    if v in onstack:
                        self._back_edges.add((u, v))
                    elif v not in visited:
                        dfs(v)
                onstack.discard(u)

            dfs(self.spec.entry)

        # Kahn topological order over forward edges only. Edges touching a
        # BLACKBOARD node are data annotations (the bb node never executes and
        # never produces an output), so they must not gate the ordering.
        indeg: Dict[str, int] = defaultdict(int)
        for e in self.spec.edges:
            if (e.src, e.dst) in self._back_edges:
                continue
            if self._is_bb(e.src) or self._is_bb(e.dst):
                continue
            indeg[e.dst] += 1

        roots = sorted(nid for nid in self.spec.nodes if indeg[nid] == 0)
        if self.spec.entry in roots:
            roots.remove(self.spec.entry)
            roots.insert(0, self.spec.entry)

        q = deque(roots)
        topo: List[str] = []
        while q:
            u = q.popleft()
            topo.append(u)
            for (v, _e) in self._succ[u]:
                if (u, v) in self._back_edges:
                    continue
                if self._is_bb(u) or self._is_bb(v):
                    continue
                indeg[v] -= 1
                if indeg[v] == 0:
                    q.append(v)
        self._topo = topo

        # Loop body: every node reachable (via forward edges) from a back-edge
        # target. Rounds after the first only re-run this subset.
        targets = {dst for (src, dst) in self._back_edges}
        if targets:
            reach = set(targets)
            stack = list(targets)
            while stack:
                u = stack.pop()
                for (v, _e) in self._succ[u]:
                    if (u, v) in self._back_edges:
                        continue
                    if v not in reach:
                        reach.add(v)
                        stack.append(v)
            self._loop_body = reach

        # blackboard read/write auto-detection from adjacency
        for nid, node in self.spec.nodes.items():
            if node.kind in (NodeKind.BLACKBOARD, NodeKind.IO):
                continue
            if node.read_blackboard or any(self._is_bb(p) for p in self._pred[nid]):
                self._bb_read.add(nid)
            if node.write_blackboard or any(self._is_bb(v) for (v, _e) in self._succ[nid]):
                self._bb_write.add(nid)

    # -- execution ----------------------------------------------------------

    def run(self, query: str, images=None) -> RunResult:
        spec = self.spec
        trace = Trace(spec.name, on_event=self.on_event)
        bb = Blackboard()
        query = query or ""

        trace.add("run_start", node=spec.entry, content=spec.name, round=0)

        loop_feedback: Dict[str, List[str]] = defaultdict(list)
        final_answer = ""
        round_no = 0
        total_rounds = 1

        while round_no < spec.max_rounds:
            total_rounds = round_no + 1

            outputs: Dict[str, str] = {}
            node_meta: Dict[str, Dict[str, Any]] = {}
            route_to: Dict[str, str] = {}

            executed_any = False

            nodes_this_round = self._topo if round_no == 0 else [n for n in self._topo if n in self._loop_body]

            for nid in nodes_this_round:
                node = spec.nodes[nid]
                if node.kind is NodeKind.BLACKBOARD:
                    continue

                inputs: List[str] = []
                for p in self._pred[nid]:
                    if (p, nid) in self._back_edges:
                        continue
                    if p not in outputs:
                        continue
                    if p in route_to and route_to[p] != nid:
                        continue
                    inputs.append(outputs[p])

                if nid == spec.entry and round_no == 0:
                    inputs = [query] + inputs
                if nid in loop_feedback:
                    inputs = loop_feedback[nid] + inputs

                if not inputs and nid != spec.entry:
                    continue

                trace.add("node_start", node=nid, round=round_no)
                # Multimodal input (images) is only sent on the first round; later
                # rounds refine over text summaries only, keeping prompts bounded.
                effective_images = images if round_no == 0 else None
                out_text, pt, ct, meta = self._execute(node, inputs, query, effective_images, bb, round_no)
                outputs[nid] = out_text
                node_meta[nid] = meta
                executed_any = True

                trace.add(
                    "node_end",
                    node=nid,
                    content=out_text,
                    prompt_tokens=pt,
                    completion_tokens=ct,
                    round=round_no,
                    meta=meta,
                )

                if node.kind is NodeKind.ROUTER and meta.get("target"):
                    route_to[nid] = meta["target"]
                    trace.add("route", node=nid, src=nid, dst=meta["target"],
                              content=f"route → {meta['target']}", round=round_no)

                if nid in self._bb_write:
                    bb.write(nid, out_text)
                    trace.add("edge", node=None, src=nid, dst="blackboard",
                              content=out_text[:200], round=round_no)

                for (v, e) in self._succ[nid]:
                    if (nid, v) in self._back_edges:
                        continue
                    trace.add("edge", node=None, src=nid, dst=v, content=out_text[:200], round=round_no)

            if not executed_any:
                break

            if spec.exit in outputs:
                final_answer = outputs[spec.exit]

            continue_round = False
            new_feedback: Dict[str, List[str]] = defaultdict(list)
            for (src, dst) in self._back_edges:
                if src not in outputs:
                    continue
                m = node_meta.get(src, {})
                if m.get("kind") == NodeKind.EVALUATOR.value and m.get("converged"):
                    continue
                new_feedback[dst].append(outputs[src])
                continue_round = True
                trace.add("loop", node=None, src=src, dst=dst,
                          content="refine (next round)", round=round_no)

            if not continue_round:
                break
            loop_feedback = new_feedback
            round_no += 1

        trace.add("final", node=spec.exit, content=final_answer, round=round_no)
        trace.final_answer = final_answer

        st = self.agent.get_token_stats()
        trace.num_llm_calls = sum(v["num_llm_calls"] for v in st.values())
        trace.prompt_tokens = sum(v["prompt_tokens"] for v in st.values())
        trace.completion_tokens = sum(v["completion_tokens"] for v in st.values())
        trace.rounds = total_rounds

        current_config = {
            "current_num_agents": spec.num_agents(),
            "round": total_rounds,
        }
        return RunResult(
            final_answer=final_answer,
            trace=trace,
            token_stats=st,
            current_config=current_config,
            rounds=total_rounds,
            agent=self.agent,
        )

    def _execute(self, node: NodeSpec, inputs: List[str], query: str, images, bb: Blackboard, round_no: int):
        kind = node.kind
        meta: Dict[str, Any] = {"kind": kind.value}

        if kind is NodeKind.IO:
            return inputs[-1] if inputs else query, 0, 0, meta

        if kind is NodeKind.AGENT:
            ctx = list(inputs)
            if node.id in self._bb_read:
                snap = bb.snapshot_text()
                if snap:
                    ctx = [snap] + ctx
            text, pt, ct = self.agent.respond(node, query, ctx, images, round_no)
            return text, pt, ct, meta

        if kind is NodeKind.ROUTER:
            text, pt, ct = self.agent.route(node, query, inputs, images, round_no)
            meta["target"] = self._parse_target(node, text)
            return text, pt, ct, meta

        if kind is NodeKind.AGGREGATOR:
            text, pt, ct = self.agent.aggregate(node, query, inputs, images, round_no)
            return text, pt, ct, meta

        if kind is NodeKind.EVALUATOR:
            converged, text, pt, ct = self.agent.evaluate(node, query, inputs, images, round_no)
            meta["converged"] = bool(converged)
            return text, pt, ct, meta

        return inputs[-1] if inputs else "", 0, 0, meta

    def _parse_target(self, node: NodeSpec, router_text: str) -> Optional[str]:
        text = (router_text or "").lower()
        for t in node.route_targets:
            if t.lower() in text:
                return t
        import re
        m = re.search(r"\b([0-9]+)\b", text)
        if m and node.route_targets:
            idx = int(m.group(1)) - 1
            if 0 <= idx < len(node.route_targets):
                return node.route_targets[idx]
        return node.route_targets[0] if node.route_targets else None
