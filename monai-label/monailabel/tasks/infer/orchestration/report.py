"""Self-contained HTML visualization of an orchestration run.

Turns a :class:`OrchestrationSpec` + :class:`Trace` into a single HTML file
(no server, no dependencies) that replays the agent data flow: a layered DAG
with live node/edge highlighting, a scrolling message log, and token counters.

The layout is computed here (top-to-bottom layers by longest forward path;
back-edges are drawn as dashed loops). The OHIF viewer renders its own
React-based visualization from the same trace payload; this HTML export remains
available for offline review.
"""
from __future__ import annotations

import html
import json
from collections import defaultdict, deque
from typing import Any, Dict, List, Tuple

from .messages import Trace
from .spec import NodeKind, OrchestrationSpec

NODE_W, NODE_H = 156, 46
GAP_X, GAP_Y = 44, 96

_KIND_COLORS = {
    NodeKind.IO.value: ("#f1f5f9", "#94a3b8"),
    NodeKind.AGENT.value: ("#eef2f7", "#cbd5e1"),
    NodeKind.ROUTER.value: ("#e0edff", "#3b82f6"),
    NodeKind.AGGREGATOR.value: ("#ede9fe", "#7c3aed"),
    NodeKind.EVALUATOR.value: ("#fef3c7", "#d97706"),
    NodeKind.BLACKBOARD.value: ("#f3f4f6", "#9ca3af"),
}


def _compute_layout(spec: OrchestrationSpec) -> Tuple[Dict[str, Dict], float, float]:
    succ = defaultdict(list)
    for e in spec.edges:
        succ[e.src].append(e.dst)

    level = {spec.entry: 0}
    q = deque([spec.entry])
    seen = {spec.entry}
    while q:
        u = q.popleft()
        for v in succ[u]:
            if v not in seen:
                seen.add(v)
                level[v] = level[u] + 1
                q.append(v)
    for nid in spec.nodes:
        level.setdefault(nid, 0)

    by_level: Dict[int, List[str]] = defaultdict(list)
    for nid, lv in level.items():
        by_level[lv].append(nid)

    pos: Dict[str, Dict] = {}
    for lv in sorted(by_level):
        for i, nid in enumerate(by_level[lv]):
            pos[nid] = {
                "x": i * (NODE_W + GAP_X),
                "y": lv * (NODE_H + GAP_Y),
                "w": NODE_W,
                "h": NODE_H,
                "level": lv,
            }

    width = max((p["x"] + NODE_W for p in pos.values()), default=NODE_W) + 20
    max_level = max(level.values()) if level else 0
    height = (max_level + 1) * (NODE_H + GAP_Y) - GAP_Y + NODE_H + 20
    return pos, width, height


def _edge_paths(spec: OrchestrationSpec, pos: Dict[str, Dict]) -> List[Dict]:
    edges = []
    for e in spec.edges:
        s = pos.get(e.src)
        d = pos.get(e.dst)
        if s is None or d is None:
            continue
        back = s["level"] >= d["level"]
        if not back:
            x1, y1 = s["x"] + NODE_W / 2, s["y"] + NODE_H
            x2, y2 = d["x"] + NODE_W / 2, d["y"]
            dstr = f"M {x1} {y1} C {x1} {(y1 + y2) / 2}, {x2} {(y1 + y2) / 2}, {x2} {y2}"
        else:
            x1, y1 = s["x"] + NODE_W, s["y"] + NODE_H / 2
            x2, y2 = d["x"] + NODE_W, d["y"] + NODE_H / 2
            dx = 46
            dstr = (f"M {x1} {y1} C {x1 + dx} {y1}, {x2 + dx} {y2}, {x2} {y2}")
        edges.append({"src": e.src, "dst": e.dst, "back": back, "d": dstr})
    return edges


def render_html(spec: OrchestrationSpec, trace: Trace, title: str = "Agent Data Flow") -> str:
    pos, width, height = _compute_layout(spec)
    edge_list = _edge_paths(spec, pos)

    nodes_json = []
    for nid, node in spec.nodes.items():
        p = pos[nid]
        fill, stroke = _KIND_COLORS.get(node.kind.value, ("#eef2f7", "#cbd5e1"))
        nodes_json.append({
            "id": nid,
            "name": node.name,
            "kind": node.kind.value,
            "x": p["x"], "y": p["y"], "w": NODE_W, "h": NODE_H,
            "fill": fill, "stroke": stroke,
        })

    events = trace.to_dict()["events"]
    payload = {
        "title": title,
        "nodes": nodes_json,
        "edges": edge_list,
        "events": events,
        "final_answer": trace.final_answer,
    }

    return _TEMPLATE.replace("__TITLE__", html.escape(title)) \
        .replace("__PAYLOAD__", json.dumps(payload, ensure_ascii=False))


_TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>__TITLE__</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
         background: #fafafa; color: #1f2937; }
  header { padding: 18px 24px 12px; border-bottom: 1px solid #e5e7eb; background: #fff; }
  header h1 { margin: 0; font-size: 20px; font-weight: 600; }
  header p { margin: 4px 0 0; font-size: 13px; color: #64748b; }
  .wrap { display: flex; gap: 16px; padding: 16px 24px; align-items: flex-start; flex-wrap: wrap; }
  .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; }
  .graph { padding: 12px; overflow: auto; }
  .side { width: 360px; min-width: 300px; display: flex; flex-direction: column; gap: 12px; }
  .controls { display: flex; gap: 8px; flex-wrap: wrap; }
  button { padding: 7px 14px; border: 1px solid #d1d5db; border-radius: 8px; background: #fff;
           font-size: 13px; cursor: pointer; }
  button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
  button:disabled { opacity: .4; cursor: default; }
  .stats { display: flex; gap: 16px; font-size: 13px; }
  .stats b { font-size: 18px; }
  .log { height: 380px; overflow: auto; padding: 10px 12px; font-size: 12px; }
  .log .row { padding: 5px 0; border-bottom: 1px solid #f1f5f9; }
  .log .row.now { color: #2563eb; font-weight: 600; }
  .log .dim { color: #94a3b8; }
  .node rect { transition: fill .18s, stroke .18s; }
  .node text { font-size: 12px; pointer-events: none; }
  .node .sub { font-size: 10px; opacity: .62; }
  .edge { fill: none; stroke: #94a3b8; stroke-width: 1.4; }
  .edge.back { stroke-dasharray: 5 4; }
  .edge.on { stroke: #2563eb; stroke-width: 2.6; }
  .final { margin-top: 2px; padding: 10px 12px; border-left: 3px solid #2563eb;
           background: #eff6ff; font-size: 13px; }
</style>
</head>
<body>
<header>
  <h1>__TITLE__</h1>
  <p>Source: MedMASLab RuntimeEngine trace · 点击「播放」查看 agent 数据流动</p>
</header>
<div class="wrap">
  <div class="panel graph" id="graph"></div>
  <div class="side">
    <div class="panel" style="padding:12px">
      <div class="controls">
        <button class="primary" id="playBtn">播放</button>
        <button id="resetBtn">重置</button>
        <button id="prevBtn">上一步</button>
        <button id="nextBtn">下一步</button>
      </div>
      <div class="stats" style="margin-top:10px">
        <span>步骤 <b id="stepNum">0</b>/<b id="stepTotal">0</b></span>
        <span>调用 <b id="callNum">0</b></span>
        <span>Token <b id="tokNum">0</b></span>
        <span>轮次 <b id="roundNum">0</b></span>
      </div>
    </div>
    <div class="panel" style="padding:10px 12px">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px">Message 日志</div>
      <div class="log" id="log"></div>
    </div>
    <div class="final" id="final"></div>
  </div>
</div>
<script>
const DATA = __PAYLOAD__;
const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

const svg = document.createElementNS(NS, "svg");
const W = Math.max(...DATA.nodes.map(n => n.x + n.w)) + 24;
const H = Math.max(...DATA.nodes.map(n => n.y + n.h)) + 24;
svg.setAttribute("viewBox", "0 0 " + W + " " + H);
svg.setAttribute("width", W);
svg.setAttribute("height", H);
document.getElementById("graph").appendChild(svg);

const defs = el("defs", {});
el("marker", { id: "arrow", markerWidth: 8, markerHeight: 8, refX: 7, refY: 3,
  orient: "auto", markerUnits: "userSpaceOnUse" }, defs)
  .innerHTML = '<path d="M0,0 L8,3 L0,6 Z" fill="#94a3b8"/>';
el("marker", { id: "arrowOn", markerWidth: 8, markerHeight: 8, refX: 7, refY: 3,
  orient: "auto", markerUnits: "userSpaceOnUse" }, defs)
  .innerHTML = '<path d="M0,0 L8,3 L0,6 Z" fill="#2563eb"/>';
svg.appendChild(defs);

const edgeEls = {};
DATA.edges.forEach((e, i) => {
  const p = el("path", { d: e.d, class: "edge" + (e.back ? " back" : ""),
    "marker-end": "url(#arrow)" });
  edgeEls[e.src + ">" + e.dst] = p;
  edgeEls[i] = p;
  svg.appendChild(p);
});

const nodeEls = {};
DATA.nodes.forEach(n => {
  const g = el("g", { class: "node", id: "n-" + n.id });
  el("rect", { x: n.x, y: n.y, width: n.w, height: n.h, rx: 8, fill: n.fill,
    stroke: n.stroke, "stroke-width": 1.2, "stroke-dasharray": n.kind === "blackboard" ? "5 4" : null }, g);
  const label = n.name.length > 18 ? n.name.slice(0, 18) + "…" : n.name;
  const t = el("text", { x: n.x + n.w / 2, y: n.y + n.h / 2 - 2, "text-anchor": "middle",
    "font-weight": 600 }, g);
  t.textContent = label;
  const s = el("text", { x: n.x + n.w / 2, y: n.y + n.h / 2 + 13, "text-anchor": "middle",
    class: "sub" }, g);
  s.textContent = n.kind;
  g.style.cursor = "pointer";
  g.addEventListener("click", () => showNode(n));
  svg.appendChild(g);
  nodeEls[n.id] = g;
});

function showNode(n) {
  document.getElementById("final").innerHTML =
    "<b>" + n.name + "</b> (" + n.kind + ")";
}

let idx = -1, calls = 0, tokens = 0, roundNo = 0, timer = null;

function clearHighlights() {
  Object.values(nodeEls).forEach(g => {
    const r = g.querySelector("rect");
    const node = DATA.nodes.find(x => "n-" + x.id === g.id);
    if (r && node) r.setAttribute("fill", node.fill);
  });
  Object.values(edgeEls).forEach(p => p.classList.remove("on"));
}

function applyEvent(ev, isNow) {
  clearHighlights();
  if (ev.node && nodeEls[ev.node]) {
    const r = nodeEls[ev.node].querySelector("rect");
    if (r) r.setAttribute("fill", "#2563eb");
  }
  if (ev.type === "edge" || ev.type === "route") {
    const key = (ev.src || "") + ">" + (ev.dst || "");
    if (edgeEls[key]) { edgeEls[key].classList.add("on"); edgeEls[key].setAttribute("marker-end", "url(#arrowOn)"); }
  }
  if (ev.type === "loop") {
    const key = (ev.src || "") + ">" + (ev.dst || "");
    if (edgeEls[key]) edgeEls[key].classList.add("on");
  }
  if (ev.type === "node_end" || ev.type === "final") {
    calls += (ev.prompt_tokens > 0 || ev.completion_tokens > 0) ? 1 : 0;
    tokens += (ev.prompt_tokens || 0) + (ev.completion_tokens || 0);
  }
  if (ev.type === "final") {
    document.getElementById("final").innerHTML =
      "<b>最终答案</b><br>" + (DATA.final_answer || ev.content || "");
  }
}

function logLine(ev, isNow) {
  const div = document.createElement("div");
  div.className = "row" + (isNow ? " now" : "");
  let label = "";
  if (ev.type === "node_start") label = "▶ " + (ev.node || "");
  else if (ev.type === "node_end") label = "✓ " + (ev.node || "") + " 输出";
  else if (ev.type === "route") label = "→ 路由到 " + (ev.dst || "");
  else if (ev.type === "edge") label = (ev.src || "") + " → " + (ev.dst || "");
  else if (ev.type === "loop") label = "↻ 回环 " + (ev.src || "") + " → " + (ev.dst || "");
  else if (ev.type === "final") label = "★ 最终答案";
  else label = ev.type;
  const txt = (ev.content || "").replace(/\n/g, " ").slice(0, 90);
  div.innerHTML = '<span>' + label + '</span> <span class="dim">' + txt + '</span>';
  return div;
}

function stepTo(i) {
  i = Math.max(0, Math.min(DATA.events.length - 1, i));
  if (i < 0) return;
  idx = i;
  const ev = DATA.events[i];
  applyEvent(ev, true);
  const log = document.getElementById("log");
  log.appendChild(logLine(ev, true));
  log.scrollTop = log.scrollHeight;
  document.getElementById("stepNum").textContent = i + 1;
  document.getElementById("stepTotal").textContent = DATA.events.length;
  document.getElementById("callNum").textContent = calls;
  document.getElementById("tokNum").textContent = tokens;
  document.getElementById("roundNum").textContent = ev.round + 1;
}

function reset() {
  stop();
  idx = -1; calls = 0; tokens = 0; roundNo = 0;
  clearHighlights();
  document.getElementById("log").innerHTML = "";
  document.getElementById("final").innerHTML = "";
  document.getElementById("stepNum").textContent = 0;
  document.getElementById("callNum").textContent = 0;
  document.getElementById("tokNum").textContent = 0;
  document.getElementById("roundNum").textContent = 0;
  document.getElementById("playBtn").textContent = "播放";
}

function play() {
  if (timer) { stop(); return; }
  document.getElementById("playBtn").textContent = "暂停";
  timer = setInterval(() => {
    if (idx >= DATA.events.length - 1) { stop(); return; }
    stepTo(idx + 1);
  }, 700);
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  document.getElementById("playBtn").textContent = "播放";
}

document.getElementById("playBtn").addEventListener("click", play);
document.getElementById("resetBtn").addEventListener("click", reset);
document.getElementById("prevBtn").addEventListener("click", () => stepTo(idx - 1));
document.getElementById("nextBtn").addEventListener("click", () => stepTo(idx + 1));

document.getElementById("stepTotal").textContent = DATA.events.length;
</script>
</body>
</html>
"""


def save_report(spec: OrchestrationSpec, trace: Trace, path, title: str = "Agent Data Flow") -> str:
    from pathlib import Path
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    html_text = render_html(spec, trace, title)
    path.write_text(html_text, encoding="utf-8")
    return str(path)
