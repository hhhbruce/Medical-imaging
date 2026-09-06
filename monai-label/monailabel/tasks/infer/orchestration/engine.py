"""RuntimeEngine — the tier-parallel super-step scheduler.

Executes an :class:`OrchestrationSpec` as a dataflow graph:

* forward edges form a DAG; nodes are grouped into dependency tiers (by
  longest forward path) and each tier is dispatched as one batch;
* sibling nodes in the same tier — the parallel specialists, debate
  round, or self-consistency samplers — execute concurrently on a
  ``ThreadPoolExecutor`` bounded by ``max_workers``, so the run's wall
  clock approximates the *slowest* call per tier instead of the *sum* of
  all calls (the sequential sum routinely exceeds reverse-proxy read
  timeouts and surfaces as 504 gateway errors);
* back-edges (detected via DFS or explicit ``loop=True``) drive bounded
  loops — evaluator-optimizer, reflection, and debate rounds;
* ROUTER nodes fan out to exactly one branch; AGGREGATOR nodes combine;
* BLACKBOARD nodes provide shared memory (agents read before / write
  after, guarded by a re-entrant lock);
* every step emits a :class:`TraceEvent` for the runtime visualization.

The scheduler never touches an LLM directly — it delegates to an
:class:`Agent` (or :class:`MockAgent`), which keeps the engine unit-testable.
"""
from __future__ import annotations

import logging
import threading
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from .agent import Agent
from .blackboard import Blackboard
from .messages import Trace
from .spec import NodeKind, NodeSpec, OrchestrationSpec

logger = logging.getLogger(__name__)


@dataclass
class RunResult:
    final_answer: str
    trace: Trace
    token_stats: Dict[str, Dict[str, int]]
    current_config: Dict[str, int]
    rounds: int
    agent: Agent
    partial_outputs: Dict[str, str] = field(default_factory=dict)
    degraded: Optional[str] = None


class WorkflowCancelled(RuntimeError):
    """Raised when a superseded MAS run is asked to stop.

    The viewer interrupts the previous consultation whenever a new one starts
    (serial-with-interrupt UX): the run registry marks the old run and the
    engine aborts cooperatively between LLM calls instead of burning tokens.
    """


def _compact_error(exc: BaseException) -> str:
    """Single-line, bounded error text safe to record on a trace event."""
    raw = str(exc) or type(exc).__name__
    raw = " ".join(raw.split())
    return raw if len(raw) <= 400 else raw[:400] + "…"


class RuntimeEngine:
    def __init__(
        self,
        spec: OrchestrationSpec,
        agent: Agent,
        max_workers: int = 4,
        on_event: Optional[Callable[[Dict[str, Any]], None]] = None,
        should_abort: Optional[Callable[[], bool]] = None,
        on_node_complete: Optional[Callable[[int, str, str, int, int, Dict[str, Any]], None]] = None,
    ):
        spec.validate()
        self.spec = spec
        self.agent = agent
        self.max_workers = max_workers
        # Optional per-event callback fired as the run progresses (live view).
        self.on_event = on_event
        # Optional cooperative-cancel probe checked between LLM calls.
        self._should_abort = should_abort
        # Optional callback fired after each node completes, used to persist
        # checkpoints for resume ("断点续传"). Signature:
        #   (round_no, node_id, output, prompt_tokens, completion_tokens, meta)
        self.on_node_complete = on_node_complete
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

        # Execution tiers: nodes grouped by longest-forward-path depth. Nodes
        # in the same tier share no forward dependency between them, so the
        # scheduler dispatches each tier as one parallel batch (sibling
        # specialists run concurrently; a tier with one node is sequential).
        # BLACKBOARD nodes occupy a slot but are filtered at dispatch time.
        depth: Dict[str, int] = {}
        for nid in topo:
            d = 0
            for p in self._pred[nid]:
                if (p, nid) in self._back_edges or self._is_bb(p):
                    continue
                d = max(d, depth.get(p, 0) + 1)
            depth[nid] = d
        self._levels: List[List[str]] = [
            [] for _ in range(max(depth.values(), default=0) + 1)
        ]
        for nid in topo:
            self._levels[depth[nid]].append(nid)

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

    def _check_abort(self) -> None:
        """Cooperative cancellation: raise as soon as the run is superseded."""
        if self._should_abort is not None and self._should_abort():
            raise WorkflowCancelled("MAS run cancelled: superseded by a newer request")

    def run(self, query: str, images=None, completed: Optional[Dict[str, Any]] = None) -> RunResult:
        spec = self.spec
        trace = Trace(spec.name, on_event=self.on_event)
        bb = Blackboard()
        query = query or ""
        completed = completed or {}

        trace.add("run_start", node=spec.entry, content=spec.name, round=0)

        loop_feedback: Dict[str, List[str]] = defaultdict(list)
        final_answer = ""
        round_no = 0
        total_rounds = 1
        degraded_error: Optional[str] = None
        latest_outputs: Dict[str, str] = {}

        # One pool for the whole run: tiers are dispatched as parallel batches
        # of sibling nodes. This is the fix for proxy-level 504 timeouts — the
        # wall clock of a multi-agent consultation is the sum of every LLM call
        # when nodes run sequentially, which routinely exceeds the reverse
        # proxy's read timeout (nginx 300s) even with a healthy upstream.
        with ThreadPoolExecutor(max_workers=max(1, self.max_workers)) as pool:
            while round_no < spec.max_rounds:
                self._check_abort()
                total_rounds = round_no + 1

                outputs: Dict[str, str] = {}
                node_meta: Dict[str, Dict[str, Any]] = {}
                route_to: Dict[str, str] = {}

                executed_any = False
                failed = False

                # Tier 0 runs the full graph; later rounds re-run the loop
                # body only (the subset reachable from a back-edge target).
                tiers = (
                    self._levels
                    if round_no == 0
                    else [
                        [nid for nid in lvl if nid in self._loop_body]
                        for lvl in self._levels
                    ]
                )

                for tier in tiers:
                    if failed:
                        break
                    # Abort between tiers so an interrupted run stops before
                    # dispatching further LLM calls.
                    self._check_abort()

                    batch = [
                        nid for nid in tier
                        if spec.nodes[nid].kind is not NodeKind.BLACKBOARD
                    ]
                    if not batch:
                        continue

                    futures = {
                        pool.submit(
                            self._process_node,
                            nid, round_no, outputs, node_meta, route_to,
                            loop_feedback, latest_outputs,
                            query, images, bb, trace, completed,
                        ): nid
                        for nid in batch
                    }
                    cancelled: Optional[WorkflowCancelled] = None
                    for fut in as_completed(futures):
                        try:
                            outcome, reason = fut.result()
                        except WorkflowCancelled as wc:
                            # Superseded mid-batch: drain the in-flight
                            # siblings (they stop at their next node), then
                            # re-raise from this thread so the run unwinds.
                            cancelled = cancelled or wc
                            continue
                        if outcome == "error":
                            # A failed node invalidates the whole consultation.
                            # Sibling results that land after the failure stay
                            # in the trace as intermediate opinions for
                            # diagnosis, but are never promoted to a conclusion.
                            if degraded_error is None:
                                degraded_error = reason
                                final_answer = ""
                                failed = True
                        elif outcome in ("done", "replay"):
                            executed_any = True
                    if cancelled is not None:
                        raise cancelled

                if failed:
                    break

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

        # Only a completely successful graph may publish a final answer. If
        # any node failed after retries, keep prior outputs in the trace as
        # intermediate opinions but leave final_answer empty.
        if degraded_error is None:
            if not final_answer and latest_outputs:
                final_answer = self._fallback_answer(latest_outputs)
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
            partial_outputs=dict(latest_outputs),
            degraded=degraded_error,
        )

    def _process_node(
        self,
        nid: str,
        round_no: int,
        outputs: Dict[str, str],
        node_meta: Dict[str, Dict[str, Any]],
        route_to: Dict[str, str],
        loop_feedback: Dict[str, List[str]],
        latest_outputs: Dict[str, str],
        query: str,
        images,
        bb: Blackboard,
        trace: Trace,
        completed: Dict[str, Any],
    ) -> Tuple[str, str]:
        """Execute one node — the worker-thread body of a tier batch.

        Returns ``("done"|"replay"|"skip", "")`` on success, ``("error",
        reason)`` when the node's LLM call failed, or raises
        :class:`WorkflowCancelled` for cooperative abort. Shared dicts are
        only ever written per-key (``outputs[nid]`` etc.), and every key is
        owned by exactly one worker per round, so sibling nodes running in
        parallel never collide; cross-node reads only touch keys from
        strictly earlier tiers, which are already settled.
        """
        spec = self.spec
        node = spec.nodes[nid]

        # Abort before the LLM call so an interrupted run stops burning
        # tokens (the tier-level check covers the dispatch boundary).
        self._check_abort()

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
            # Make the silent skip explicit so the viewer can mark the
            # node as skipped and explain why nothing was delivered.
            route_blocked = any(
                p in route_to and route_to[p] != nid for p in self._pred[nid]
            )
            trace.add(
                "node_skip",
                node=nid,
                round=round_no,
                meta={"reason": "route_filtered" if route_blocked else "no_input"},
            )
            return "skip", ""

        # Checkpoint replay: reuse this node's output from a prior
        # (failed) attempt instead of re-invoking the upstream model,
        # so a resumed conversation does not restart from zero.
        replay = completed.get(f"{round_no}:{nid}")
        if replay is not None and nid != spec.entry:
            out_text = replay.get("output", "") if isinstance(replay, dict) else str(replay)
            meta = dict(replay.get("meta") or {}) if isinstance(replay, dict) else {}
            meta.setdefault("kind", node.kind.value)
            meta["replayed"] = True
            pt = int((replay.get("prompt_tokens") if isinstance(replay, dict) else None) or 0)
            ct = int((replay.get("completion_tokens") if isinstance(replay, dict) else None) or 0)
            outputs[nid] = out_text
            node_meta[nid] = meta
            latest_outputs[nid] = out_text
            self._credit_replay_tokens(pt, ct)
            trace.add(
                "node_replay",
                node=nid,
                content=out_text,
                prompt_tokens=pt,
                completion_tokens=ct,
                round=round_no,
                meta=meta,
            )
            self._finalize_node(nid, node, out_text, meta, round_no, route_to, bb, trace)
            return "replay", ""

        trace.add("node_start", node=nid, round=round_no)
        # Multimodal input (images) is only sent on the first round; later
        # rounds refine over text summaries only, keeping prompts bounded.
        effective_images = images if round_no == 0 else None
        try:
            out_text, pt, ct, meta = self._execute(node, inputs, query, effective_images, bb, round_no)
        except WorkflowCancelled:
            raise
        except Exception as exc:
            # A failed node invalidates the whole consultation. Earlier
            # node outputs remain visible as intermediate opinions, but
            # they must never be promoted to a final conclusion.
            reason = _compact_error(exc)
            trace.add(
                "node_error",
                node=nid,
                content=reason,
                round=round_no,
                meta={"kind": node.kind.value},
            )
            return "error", reason

        outputs[nid] = out_text
        node_meta[nid] = meta
        latest_outputs[nid] = out_text
        if node.kind is not NodeKind.IO:
            self._notify_complete(round_no, nid, out_text, pt, ct, meta)

        trace.add(
            "node_end",
            node=nid,
            content=out_text,
            prompt_tokens=pt,
            completion_tokens=ct,
            round=round_no,
            meta=meta,
        )
        self._finalize_node(nid, node, out_text, meta, round_no, route_to, bb, trace)
        return "done", ""

    def _notify_complete(
        self, round_no: int, nid: str, out_text: str, pt: int, ct: int, meta: Dict[str, Any]
    ) -> None:
        """Fire the checkpoint callback; failures must never break a run."""
        if self.on_node_complete is None:
            return
        try:
            self.on_node_complete(round_no, nid, out_text, int(pt or 0), int(ct or 0), dict(meta or {}))
        except Exception:  # pragma: no cover - checkpointing must never break a run
            logger.exception("RuntimeEngine on_node_complete callback failed for %s", nid)

    def _credit_replay_tokens(self, pt: int, ct: int) -> None:
        """Account for tokens that were spent in the original (checkpointed) run."""
        self.agent.credit_tokens(int(pt or 0), int(ct or 0))

    def _finalize_node(self, nid, node, out_text, meta, round_no, route_to, bb, trace) -> None:
        """Route / blackboard / edge bookkeeping shared by fresh and replayed nodes."""
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
            if node.kind is NodeKind.ROUTER and meta.get("target") and v != meta["target"]:
                # The router delivered only to its chosen branch — do not
                # animate message delivery into filtered branches, otherwise
                # the viewer shows communication that never happened (the
                # skipped branch never receives input).
                continue
            trace.add("edge", node=None, src=nid, dst=v, content=out_text[:200], round=round_no)

    def _fallback_answer(self, latest_outputs: Dict[str, str]) -> str:
        """Assemble a degraded answer from completed node outputs.

        Prefer the exit node, then the last LLM-backed node to finish in
        topological order (its synthesis is closest to a final answer).
        """
        exit_text = latest_outputs.get(self.spec.exit, "")
        if exit_text.strip():
            return exit_text
        candidates = [
            latest_outputs[nid]
            for nid in self._topo
            if nid in latest_outputs
            and latest_outputs[nid].strip()
            and self.spec.nodes[nid].kind not in (NodeKind.IO, NodeKind.ROUTER)
        ]
        if not candidates:
            return exit_text
        return candidates[-1]

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
