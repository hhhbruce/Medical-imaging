import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MasTracePayload, MasNode, MasEdge, MasTraceEvent } from '../stores/toolboxState';
import { MarkdownText } from './MarkdownText';

/**
 * AgentFlowViz — 临床会诊数据流（agent 编排可视化）。
 *
 * Replays the real data flow of a multi-agent medical consultation from the
 * orchestration engine's ``spec`` (doctor + routing graph) and ``trace``
 * (ordered event stream): a doctor graph with animated edges, plus a
 * consultation transcript that shows the FULL text each doctor produced.
 *
 * Design language: NVIDIA (design-md base `nvidia`), adapted to a clinical AI
 * "GPU / neural-net" surface. Deep-black header + final-answer bands frame a
 * paper-white body; NVIDIA Green (#76b900) is the single accent, used only for
 * the live data-flow stream, active states, and the brand corner squares.
 * 2px angular radius everywhere, hairline borders, no shadows, no gradients.
 * Motion is reserved for the REAL data flow: an animated edge stream, a
 * travelling packet, and a pulse on the active doctor — never decorative glow.
 */

/* ------------------------------------------------------------------------ *
 * Design tokens — NVIDIA (design-md base: `nvidia`)
 * ------------------------------------------------------------------------ */
const C = {
  primary: '#76b900', // NVIDIA Green — the single brand accent
  primaryDark: '#5a8d00',
  onPrimary: '#000000',
  canvas: '#ffffff',
  surfaceDark: '#000000',
  surfaceElevated: '#1a1a1a',
  surfaceSoft: '#f7f7f7',
  hairline: '#cccccc',
  hairlineStrong: '#5e5e5e',
  ink: '#000000',
  body: '#1a1a1a',
  mute: '#757575',
  stone: '#898989',
  ash: '#a7a7a7',
  onDark: '#ffffff',
  onDarkMute: 'rgba(255,255,255,0.7)',
  successDeep: '#3f8500',
  warning: '#df6500',
  accentGreenPale: '#bff230',
};

type KindMeta = { color: string; label: string };

const KIND_META: Record<string, KindMeta> = {
  io: { color: '#a7a7a7', label: '输入/输出' },
  agent: { color: '#76b900', label: '医生' },
  router: { color: '#000000', label: '分诊' },
  aggregator: { color: '#3f8500', label: '汇总' },
  evaluator: { color: '#df6500', label: '收敛' },
  blackboard: { color: '#898989', label: '黑板' },
};

function kindMeta(kind: string): KindMeta {
  return KIND_META[kind] ?? { color: '#a7a7a7', label: kind };
}

const FONT =
  "'Inter', Arial, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";

/* ------------------------------------------------------------------------ *
 * Graph layout (top-to-bottom layered DAG; back-edges drawn as side loops)
 * ------------------------------------------------------------------------ */
const NODE_W = 116;
const NODE_H = 46;
const GAP_X = 24;
const GAP_Y = 66;
/* Upper bounds for the adaptive gap stretch — keeps sparse graphs (e.g. CoT's
   two nodes) from being absurdly spread out when the pane is much taller. */
const GAP_MAX_X = 96;
const GAP_MAX_Y = 150;
const PAD = 16;

interface LayoutPos {
  x: number;
  y: number;
  level: number;
}

function computeLayout(
  spec: MasTracePayload['spec'],
  gapX: number = GAP_X,
  gapY: number = GAP_Y
): Map<string, LayoutPos> {
  const succ = new Map<string, string[]>();
  for (const e of spec.edges) {
    const list = succ.get(e.src) ?? [];
    list.push(e.dst);
    succ.set(e.src, list);
  }

  const level = new Map<string, number>();
  level.set(spec.entry, 0);
  const queue: string[] = [spec.entry];
  const seen = new Set<string>([spec.entry]);
  while (queue.length) {
    const u = queue.shift()!;
    for (const v of succ.get(u) ?? []) {
      if (!seen.has(v)) {
        seen.add(v);
        level.set(v, (level.get(u) ?? 0) + 1);
        queue.push(v);
      }
    }
  }
  for (const n of spec.nodes) {
    if (!level.has(n.id)) level.set(n.id, 0);
  }

  const byLevel = new Map<number, string[]>();
  for (const n of spec.nodes) {
    const lv = level.get(n.id) ?? 0;
    const list = byLevel.get(lv) ?? [];
    list.push(n.id);
    byLevel.set(lv, list);
  }

  const pos = new Map<string, LayoutPos>();
  for (const lv of [...byLevel.keys()].sort((a, b) => a - b)) {
    (byLevel.get(lv) ?? []).forEach((id, i) => {
      pos.set(id, { x: i * (NODE_W + gapX), y: lv * (NODE_H + gapY), level: lv });
    });
  }
  return pos;
}

function edgePath(src: string, dst: string, pos: Map<string, LayoutPos>): string {
  const a = pos.get(src);
  const b = pos.get(dst);
  if (!a || !b) return '';
  if (a.level < b.level) {
    const x1 = a.x + NODE_W / 2;
    const y1 = a.y + NODE_H;
    const x2 = b.x + NODE_W / 2;
    const y2 = b.y;
    return `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
  }
  const x1 = a.x + NODE_W;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x + NODE_W;
  const y2 = b.y + NODE_H / 2;
  const dx = 36;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 + dx} ${y2}, ${x2} ${y2}`;
}

function shortName(name: string, max = 12): string {
  return name.length > max ? `${name.slice(0, max)}…` : name;
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/* ------------------------------------------------------------------------ *
 * Transcript entry — one doctor's actual output (the "real data flow")
 * ------------------------------------------------------------------------ */
interface TranscriptEntry {
  key: string;
  eventIdx: number;
  nodeId: string;
  name: string;
  kind: string;
  color: string;
  round: number;
  content: string;
  pt: number;
  ct: number;
}

export function AgentFlowViz({
  trace,
  autoPlay = false,
  live = false,
}: {
  trace: MasTracePayload;
  autoPlay?: boolean;
  /** True while the consultation POST is still in flight: follow the event tail. */
  live?: boolean;
}) {
  const spec = trace?.spec;
  const runTrace = trace?.trace;
  const specValid = Boolean(spec?.nodes?.length && spec?.edges?.length);
  const events = useMemo(() => runTrace?.events ?? [], [runTrace]);

  const nodeById = useMemo(() => {
    const m = new Map<string, MasNode>();
    for (const n of spec?.nodes ?? []) m.set(n.id, n);
    return m;
  }, [spec]);

  // Adaptive layout: the graph stretches to exactly fill the left pane.
  // Inter-column / inter-layer gaps grow (up to GAP_MAX_*) to use the free
  // space; for graphs larger than the pane a uniform shrink-to-fit scale
  // (fitScale, below) kicks in instead. The pane is measured with a
  // ResizeObserver so the fill follows every modal resize.
  const graphBoxRef = useRef<HTMLDivElement | null>(null);
  const [graphBox, setGraphBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = graphBoxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      setGraphBox(prev =>
        Math.abs(prev.w - rect.width) < 0.5 && Math.abs(prev.h - rect.height) < 0.5
          ? prev
          : { w: rect.width, h: rect.height }
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const naturalPos = useMemo(() => computeLayout(spec), [spec]);

  const shape = useMemo(() => {
    let levels = 0;
    let cols = 0;
    const perLevel = new Map<number, number>();
    naturalPos.forEach(p => {
      perLevel.set(p.level, (perLevel.get(p.level) ?? 0) + 1);
      levels = Math.max(levels, p.level + 1);
    });
    perLevel.forEach(c => {
      cols = Math.max(cols, c);
    });
    return { levels, cols };
  }, [naturalPos]);

  const gap = useMemo(() => {
    if (!graphBox.w || !graphBox.h || !shape.levels || !shape.cols) {
      return { x: GAP_X, y: GAP_Y };
    }
    const freeX = (graphBox.w - PAD * 2 - shape.cols * NODE_W) / Math.max(1, shape.cols - 1);
    const freeY = (graphBox.h - PAD * 2 - shape.levels * NODE_H) / Math.max(1, shape.levels - 1);
    return {
      x: Math.max(GAP_X, Math.min(GAP_MAX_X, freeX)),
      y: Math.max(GAP_Y, Math.min(GAP_MAX_Y, freeY)),
    };
  }, [graphBox, shape]);

  const pos = useMemo(
    () => (gap.x === GAP_X && gap.y === GAP_Y ? naturalPos : computeLayout(spec, gap.x, gap.y)),
    [naturalPos, gap.x, gap.y, spec]
  );

  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<number | null>(null);
  const msgsScrollRef = useRef<HTMLDivElement | null>(null);
  const wasLiveRef = useRef(live);

  // Conclusion card deck: slide 0 = consultation record, slide 1 = the final
  // conclusion. Once a final answer exists the record pane becomes a
  // swipeable card deck; dragging tracks a px offset for a rubber-band feel.
  const [slide, setSlide] = useState(0);
  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ startX: number; startY: number; engaged: boolean } | null>(null);

  const conclusion = step >= 0 && runTrace?.final_answer ? runTrace.final_answer : null;

  // A fresh payload means a new run: always land back on the record card.
  useEffect(() => {
    setSlide(0);
    setDragDx(0);
    setDragging(false);
    dragState.current = null;
  }, [trace]);

  // The conclusion card exists only while a final answer is on screen
  // (scrubbing back to step -1 removes it): never stay parked on slide 2.
  useEffect(() => {
    if (!conclusion) {
      setSlide(0);
      setDragDx(0);
    }
  }, [conclusion]);

  // Horizontal swipe between the record card and the conclusion card. The
  // gesture engages only on a clearly horizontal move so vertical scrolling
  // and text selection inside the cards keep working.
  const onSwipeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!conclusion || (e.pointerType === 'mouse' && e.button !== 0)) return;
    dragState.current = { startX: e.clientX, startY: e.clientY, engaged: false };
  };
  const onSwipeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragState.current;
    if (!st) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (!st.engaged) {
      if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy)) return;
      st.engaged = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const atEdge = (slide === 0 && dx > 0) || (slide === 1 && dx < 0);
    setDragDx(atEdge ? dx * 0.3 : dx);
  };
  const onSwipeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragState.current;
    dragState.current = null;
    if (st?.engaged) {
      const dx = e.clientX - st.startX;
      if (dx <= -60 && slide === 0) setSlide(1);
      else if (dx >= 60 && slide === 1) setSlide(0);
    }
    setDragging(false);
    setDragDx(0);
  };

  // Step policy:
  //  - live run: always follow the newest event as it streams in;
  //  - live → finished transition: keep the full flow visible (no jarring replay);
  //  - fresh replay (modal opened after the fact, autoPlay): start from zero.
  useEffect(() => {
    if (live) {
      wasLiveRef.current = true;
      setPlaying(false);
      setStep(events.length - 1);
      return;
    }
    if (wasLiveRef.current) {
      wasLiveRef.current = false;
      setPlaying(false);
      setStep(events.length - 1);
      return;
    }
    setStep(-1);
    setPlaying(autoPlay && events.length > 0);
  }, [trace, live, autoPlay, events.length]);

  // While live, keep the transcript pinned to the newest message; during a
  // replay only follow along while the reader is still near the bottom, so
  // scrolling up to read an earlier card is never yanked back down.
  useEffect(() => {
    const el = msgsScrollRef.current;
    if (!el) {
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (live || (playing && nearBottom)) {
      el.scrollTop = el.scrollHeight;
    }
  }, [live, playing, step, events.length]);

  useEffect(() => {
    if (!playing) return;
    timerRef.current = window.setInterval(() => {
      setStep(prev => {
        if (prev >= events.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 560);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [playing, events.length]);

  /* Transcript: every real message a doctor produced, in order. */
  const messages = useMemo(() => {
    const out: TranscriptEntry[] = [];
    events.forEach((ev, idx) => {
      if (ev.type !== 'node_end' || !ev.node) return;
      const n = nodeById.get(ev.node);
      if (!n || n.kind === 'io') return;
      out.push({
        key: `${idx}-${ev.ts}`,
        eventIdx: idx,
        nodeId: ev.node,
        name: n.name,
        kind: n.kind,
        color: kindMeta(n.kind).color,
        round: ev.round ?? 0,
        content: ev.content || '',
        pt: ev.prompt_tokens ?? 0,
        ct: ev.completion_tokens ?? 0,
      });
    });
    return out;
  }, [events, nodeById]);

  const visibleMessages = useMemo(() => messages.filter(m => m.eventIdx <= step), [messages, step]);

  const shownEvents = useMemo(() => events.slice(0, step + 1), [events, step]);
  const currentEvent = step >= 0 && step < events.length ? events[step] : null;

  const liveNode = currentEvent?.node ?? null;

  // Nodes whose node_start has been emitted but whose node_end / node_error
  // has not arrived yet — every such node is still awaiting its LLM response.
  // The engine now dispatches sibling agents of one tier in parallel, so a
  // single last-event loader would miss concurrent waits: one loader renders
  // per in-flight node. (node_replay / node_skip never emit node_start, so
  // they can never count as in-flight.)
  const inflightNodes = useMemo(() => {
    const set = new Set<string>();
    for (const ev of shownEvents) {
      if (!ev.node) continue;
      if (ev.type === 'node_start') {
        set.add(ev.node);
      } else if (ev.type === 'node_end' || ev.type === 'node_error') {
        set.delete(ev.node);
      }
    }
    return set;
  }, [shownEvents]);

  const liveEdgeKey =
    currentEvent &&
    (currentEvent.type === 'edge' || currentEvent.type === 'route' || currentEvent.type === 'loop')
      ? `${currentEvent.src ?? ''}>${currentEvent.dst ?? ''}`
      : null;

  const flowedEdges = useMemo(() => {
    const set = new Set<string>();
    for (const ev of shownEvents) {
      if (ev.type === 'edge' || ev.type === 'route' || ev.type === 'loop') {
        set.add(`${ev.src ?? ''}>${ev.dst ?? ''}`);
      }
    }
    return set;
  }, [shownEvents]);

  const visitedNodes = useMemo(() => {
    const set = new Set<string>();
    for (const ev of shownEvents) {
      // node_skip marks a node that did NOT execute — never treat it as visited.
      if (ev.node && ev.type !== 'node_skip') set.add(ev.node);
    }
    return set;
  }, [shownEvents]);

  // Nodes the engine explicitly skipped (routed elsewhere / no input received).
  const skippedNodes = useMemo(() => {
    const set = new Set<string>();
    for (const ev of shownEvents) {
      if (ev.type === 'node_skip' && ev.node) set.add(ev.node);
    }
    return set;
  }, [shownEvents]);

  const edgeDefs = useMemo(
    () =>
      (spec?.edges ?? []).map(e => ({
        ...e,
        d: edgePath(e.src, e.dst, pos),
      })),
    [spec, pos]
  );

  const svgWidth = useMemo(() => {
    let max = NODE_W;
    pos.forEach(p => {
      max = Math.max(max, p.x + NODE_W);
    });
    return max + PAD * 2;
  }, [pos]);

  const svgHeight = useMemo(() => {
    let max = NODE_H;
    pos.forEach(p => {
      max = Math.max(max, p.y + NODE_H);
    });
    return max + PAD * 2;
  }, [pos]);

  // Shrink-to-fit fallback for graphs that remain larger than the pane even
  // at the base gaps (dense specs, narrow viewports). Never upscales — gap
  // stretching already handles filling.
  const fitScale = useMemo(() => {
    if (!graphBox.w || !graphBox.h || !svgWidth || !svgHeight) return 1;
    return Math.max(0.2, Math.min(1, graphBox.w / svgWidth, graphBox.h / svgHeight));
  }, [graphBox, svgWidth, svgHeight]);

  const tokenTotal = (runTrace?.prompt_tokens ?? 0) + (runTrace?.completion_tokens ?? 0);
  const maxRound = runTrace?.rounds ?? 0;

  const onReset = () => {
    setPlaying(false);
    setStep(-1);
  };
  const onTogglePlay = () => {
    if (step >= events.length - 1) {
      onReset();
      return;
    }
    setPlaying(p => !p);
  };
  const onStep = (delta: number) => {
    setPlaying(false);
    setStep(prev => Math.max(-1, Math.min(events.length - 1, prev + delta)));
  };

  const done = step >= events.length - 1 && events.length > 0;
  const progress = events.length > 0 ? (step + 1) / events.length : 0;

  // Defensive fallback: a malformed/legacy payload without a spec graph must
  // degrade to a readable answer view instead of crashing the panel.
  if (!specValid) {
    return (
      <div
        style={{
          background: C.surfaceDark,
          borderRadius: 2,
          padding: '14px 16px',
          fontFamily: FONT,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 12, height: 12, background: C.primary, flex: '0 0 auto' }} />
          <span style={{ color: C.onDark, fontWeight: 700, fontSize: 14 }}>
            {spec?.name ?? (trace?.strategy || 'Agent')} · 数据流不可用
          </span>
        </div>
        <div
          style={{
            marginTop: 10,
            color: C.onDark,
            fontSize: 12.5,
            lineHeight: 1.65,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {runTrace?.final_answer || trace?.answer || '—'}
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes afvFlow { to { stroke-dashoffset: -16; } }
        @keyframes afvPulse { 0%, 100% { stroke-opacity: 1; } 50% { stroke-opacity: 0.35; } }
        .afv-flow { stroke-dasharray: 5 6; animation: afvFlow 0.7s linear infinite; }
        .afv-pulse { animation: afvPulse 1.1s ease-in-out infinite; }
        /* Split layout: data-flow graph (left) + consultation record (right).
           Narrow viewports stack the two panes vertically. flex-basis 0 lets
           the split fill the modal card below the header and stats strip
           (the card has a definite height). */
        .afv-split { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; overflow-y: auto; }
        .afv-left { display: flex; flex-direction: column; min-width: 0; background: ${C.canvas}; }
        .afv-right {
          display: flex; flex-direction: column; min-width: 0;
          background: ${C.surfaceSoft};
          border-top: 1px solid ${C.hairline};
          max-height: 440px;
        }
        .afv-cards {
          overflow-y: auto; padding: 10px;
          display: flex; flex-direction: column; gap: 8px;
          flex: 1 1 auto; min-height: 0;
        }
        @media (min-width: 960px) {
          .afv-split { flex-direction: row; overflow: hidden; }
          .afv-left { flex: 0 0 55%; overflow: hidden; border-right: 1px solid ${C.hairline}; }
          .afv-right { flex: 1 1 45%; max-height: none; border-top: none; }
        }
        /* Slim scrollbars for the record and conclusion scroll areas. */
        .afv-hairscroll { scrollbar-width: thin; scrollbar-color: ${C.hairline} transparent; }
        .afv-hairscroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .afv-hairscroll::-webkit-scrollbar-track { background: transparent; }
        .afv-hairscroll::-webkit-scrollbar-thumb { background: ${C.hairline}; border-radius: 4px; }
        .afv-hairscroll::-webkit-scrollbar-thumb:hover { background: ${C.stone}; }
      `}</style>

      <div
        style={{
          background: C.canvas,
          border: `1px solid ${C.hairline}`,
          borderRadius: 2,
          overflow: 'hidden',
          fontFamily: FONT,
          color: C.ink,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          flex: '1 1 auto',
        }}
      >
        {/* ---- Header (dark hero chapter) ---- */}
        <div style={{ background: C.surfaceDark, padding: '14px 16px 12px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ width: 12, height: 12, background: C.primary, flex: '0 0 auto' }} />
              <span
                style={{
                  color: C.onDark,
                  fontWeight: 700,
                  fontSize: 14,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {spec?.name ?? 'Agent'} · {trace.strategy_label || trace.strategy}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {live ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    border: `1px solid ${C.primary}`,
                    color: C.primary,
                    borderRadius: 2,
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: 1,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      background: C.primary,
                      display: 'inline-block',
                      animation: 'afvPulse 1.1s ease-in-out infinite',
                    }}
                  />
                  实时接收中
                </span>
              ) : (
                <>
                  <button
                    onClick={onTogglePlay}
                    style={btnPrimary()}
                  >
                    {playing ? '暂停' : done ? '重播' : '播放'}
                  </button>
                  <button
                    onClick={onReset}
                    style={btnOutlineDark()}
                  >
                    重置
                  </button>
                  <button
                    onClick={() => onStep(-1)}
                    style={{ ...btnOutlineDark(), opacity: step < 0 ? 0.35 : 1 }}
                    disabled={step < 0}
                  >
                    ◀
                  </button>
                  <button
                    onClick={() => onStep(1)}
                    style={{ ...btnOutlineDark(), opacity: done ? 0.35 : 1 }}
                    disabled={done}
                  >
                    ▶
                  </button>
                </>
              )}
            </div>
          </div>
          {/* Replay progress */}
          <div style={{ height: 3, background: C.surfaceElevated, marginTop: 10, borderRadius: 2 }}>
            <div
              style={{
                width: `${Math.round(progress * 100)}%`,
                height: '100%',
                background: C.primary,
                borderRadius: 2,
                transition: 'width 0.25s ease',
              }}
            />
          </div>
        </div>

        {/* ---- Stats (callout numerals) ---- */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            borderBottom: `1px solid ${C.hairline}`,
            background: C.canvas,
          }}
        >
          {[
            ['医生', `${trace.agent_count ?? 0}`, false],
            ['轮次', `${maxRound}`, false],
            ['调用', `${runTrace?.num_llm_calls ?? 0}`, false],
            ['Token', fmt(tokenTotal), false],
            ['步骤', `${step + 1}/${events.length}`, true],
          ].map(([label, value, accent], i) => (
            <div
              key={label as string}
              style={{
                textAlign: 'center',
                padding: '10px 4px',
                borderRight: i < 4 ? `1px solid ${C.hairline}` : undefined,
              }}
            >
              <div
                style={{
                  color: C.mute,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                }}
              >
                {label as string}
              </div>
              <div
                style={{
                  color: accent ? C.primary : C.ink,
                  fontWeight: 700,
                  fontSize: 20,
                  lineHeight: 1.2,
                  marginTop: 2,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {value as string}
              </div>
            </div>
          ))}
        </div>

        {/* ---- Split body: 数据流可视化（左） + 会诊记录（右） ---- */}
        <div className="afv-split">
          {/* Left pane: the data-flow visualization */}
          <div className="afv-left">
            {/* ---- Doctor graph (the real data-flow stream) ---- */}
            <div
              ref={graphBoxRef}
              style={{
                flex: '1 1 auto',
                minHeight: 0,
                overflow: 'auto',
                padding: 12,
                background: C.canvas,
                display: 'flex',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  width: svgWidth * fitScale,
                  height: svgHeight * fitScale,
                  margin: 'auto',
                  flex: '0 0 auto',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: svgWidth,
                    height: svgHeight,
                    transform: `scale(${fitScale})`,
                    transformOrigin: 'top left',
                  }}
                >
                  <svg
                    viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                    width={svgWidth}
                    height={svgHeight}
                    style={{ display: 'block' }}
                  >
                    <defs>
                      <marker
                        id="afvArrow"
                        markerWidth="8"
                        markerHeight="8"
                        refX="7"
                        refY="3"
                        orient="auto"
                        markerUnits="userSpaceOnUse"
                      >
                        <path
                          d="M0,0 L8,3 L0,6 Z"
                          fill={C.hairline}
                        />
                      </marker>
                      <marker
                        id="afvArrowOn"
                        markerWidth="8"
                        markerHeight="8"
                        refX="7"
                        refY="3"
                        orient="auto"
                        markerUnits="userSpaceOnUse"
                      >
                        <path
                          d="M0,0 L8,3 L0,6 Z"
                          fill={C.primary}
                        />
                      </marker>
                    </defs>

                    {edgeDefs.map(e => {
                      const key = `${e.src}>${e.dst}`;
                      const flowed = flowedEdges.has(key);
                      const live = liveEdgeKey === key;
                      return (
                        <React.Fragment key={key}>
                          <path
                            d={e.d}
                            fill="none"
                            stroke={live || flowed ? C.primary : C.ash}
                            strokeWidth={live ? 2.4 : flowed ? 1.8 : 1.2}
                            strokeDasharray={e.loop ? '5 4' : undefined}
                            markerEnd={flowed || live ? 'url(#afvArrowOn)' : 'url(#afvArrow)'}
                            style={{ transition: 'stroke 0.2s, stroke-width 0.2s' }}
                          />
                          {/* Animated data stream on the live edge */}
                          {live && (
                            <path
                              d={e.d}
                              fill="none"
                              stroke={C.ink}
                              strokeWidth={1.6}
                              className="afv-flow"
                            />
                          )}
                        </React.Fragment>
                      );
                    })}

                    {/* Travelling data packet on the live edge */}
                    {liveEdgeKey && edgeDefs.some(e => `${e.src}>${e.dst}` === liveEdgeKey) && (
                      <circle
                        r="3"
                        fill={C.primary}
                      >
                        <animateMotion
                          dur="0.6s"
                          repeatCount="indefinite"
                          path={edgeDefs.find(e => `${e.src}>${e.dst}` === liveEdgeKey)!.d}
                        />
                      </circle>
                    )}

                    {spec.nodes.map(n => {
                      const p = pos.get(n.id);
                      if (!p) return null;
                      const meta = kindMeta(n.kind);
                      // Active = awaiting its LLM response (in-flight set) or
                      // the node of the very last event — so every parallel
                      // sibling pulses in green while it works, not just one.
                      const active = inflightNodes.has(n.id) || liveNode === n.id;
                      const visited = visitedNodes.has(n.id);
                      const skipped = skippedNodes.has(n.id);
                      const dimmed = (!visited && step >= 0) || skipped;
                      const title = `${n.name} (${meta.label}${skipped ? ' · 未接收到输入，已跳过' : ''})`;
                      return (
                        <g
                          key={n.id}
                          style={{ cursor: 'pointer' }}
                        >
                          <title>{title}</title>
                          <rect
                            x={p.x}
                            y={p.y}
                            width={NODE_W}
                            height={NODE_H}
                            rx={2}
                            fill={active ? 'rgba(118,185,0,0.10)' : C.canvas}
                            stroke={active ? C.primary : C.hairline}
                            strokeWidth={active ? 2 : 1}
                            strokeDasharray={n.kind === 'blackboard' || skipped ? '4 4' : undefined}
                            className={active ? 'afv-pulse' : undefined}
                            style={{
                              transition: 'fill 0.2s, stroke 0.2s',
                              opacity: dimmed ? 0.5 : 1,
                            }}
                          />
                          <rect
                            x={p.x}
                            y={p.y}
                            width={3}
                            height={NODE_H}
                            fill={meta.color}
                            opacity={visited || active ? 1 : 0.3}
                          />
                          <text
                            x={p.x + 4 + (NODE_W - 4) / 2}
                            y={p.y + NODE_H / 2 - 2}
                            textAnchor="middle"
                            fontSize={11.5}
                            fontWeight={700}
                            fill={C.ink}
                          >
                            {shortName(n.name)}
                          </text>
                          <text
                            x={p.x + 4 + (NODE_W - 4) / 2}
                            y={p.y + NODE_H / 2 + 14}
                            textAnchor="middle"
                            fontSize={9.5}
                            fill={
                              skipped
                                ? C.mute
                                : n.kind === 'io' || n.kind === 'blackboard'
                                  ? C.mute
                                  : meta.color
                            }
                          >
                            {skipped ? '跳过' : meta.label}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                  {/* Cube loaders pinned to every node that is still awaiting
                      its LLM response (one per in-flight agent — sibling
                      agents of a tier run in parallel, so several loaders can
                      spin at once). They disappear when each node_end arrives. */}
                  {live &&
                    [...inflightNodes].map(nid => {
                      const p = pos.get(nid);
                      if (!p) return null;
                      return (
                        <div
                          key={nid}
                          style={{
                            position: 'absolute',
                            left: p.x + NODE_W - 21,
                            top: p.y - 21,
                            width: 42,
                            height: 42,
                            pointerEvents: 'none',
                          }}
                        >
                          <LoadingCubes size={3} />
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>

          {/* Right pane: consultation record (会诊记录) as a swipeable card
              deck — slide 1: agent transcript; slide 2 (once produced): the
              final conclusion. */}
          <div className="afv-right">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '10px 12px',
                background: C.canvas,
                borderBottom: `1px solid ${C.hairline}`,
                flex: '0 0 auto',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, background: C.primary, flex: '0 0 auto' }} />
                <span
                  style={{ color: C.ink, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}
                >
                  {conclusion && slide === 1 ? '最终结论' : '会诊记录'}
                </span>
                {(!conclusion || slide === 0) && (
                  <span style={{ color: C.mute, fontSize: 11, whiteSpace: 'nowrap' }}>
                    {visibleMessages.length}/{messages.length} 条意见
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto' }}>
                {live && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      color: C.primary,
                      fontSize: 10.5,
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        background: C.primary,
                        display: 'inline-block',
                        animation: 'afvPulse 1.1s ease-in-out infinite',
                      }}
                    />
                    实时接收中
                  </span>
                )}
                {conclusion && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      onClick={() => setSlide(0)}
                      disabled={slide === 0}
                      style={carBtn(slide === 0)}
                      title="会诊记录"
                    >
                      ‹
                    </button>
                    {[0, 1].map(i => (
                      <span
                        key={i}
                        onClick={() => setSlide(i)}
                        title={i === 0 ? '会诊记录' : '最终结论'}
                        style={{
                          width: i === slide ? 14 : 6,
                          height: 6,
                          borderRadius: 3,
                          background: i === slide ? C.primary : C.hairline,
                          cursor: 'pointer',
                          transition: 'all 0.25s ease',
                        }}
                      />
                    ))}
                    <button
                      onClick={() => setSlide(1)}
                      disabled={slide === 1}
                      style={carBtn(slide === 1)}
                      title="最终结论"
                    >
                      ›
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Card deck: the transcript is slide 1; once the run produced a
                final answer it becomes slide 2 — drag horizontally or use the
                arrows / dots in the header to move between the two. */}
            <div
              style={{
                flex: '1 1 auto',
                minHeight: 0,
                position: 'relative',
                overflow: 'hidden',
                cursor: conclusion ? (dragging ? 'grabbing' : 'grab') : 'default',
                userSelect: dragging ? 'none' : undefined,
                touchAction: 'pan-y',
              }}
              onPointerDown={onSwipeDown}
              onPointerMove={onSwipeMove}
              onPointerUp={onSwipeEnd}
              onPointerCancel={onSwipeEnd}
            >
              <div
                style={{
                  display: 'flex',
                  height: '100%',
                  width: conclusion ? '200%' : '100%',
                  transform: `translateX(calc(${conclusion ? -slide * 50 : 0}% + ${dragDx}px))`,
                  transition: dragging
                    ? 'none'
                    : 'transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1)',
                }}
              >
                {/* Slide 1 — one scrollable card per agent output */}
                <div
                  style={{
                    width: conclusion ? '50%' : '100%',
                    flex: '0 0 auto',
                    minWidth: 0,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                  }}
                >
                  <div
                    ref={msgsScrollRef}
                    className="afv-cards afv-hairscroll"
                  >
                    {visibleMessages.length === 0 && (
                      <div style={{ color: C.mute, fontSize: 11.5, padding: '8px 2px' }}>
                        {live
                          ? '正在等待各位医生接入会诊…事件到达后将实时展示。'
                          : '点击「播放」查看每位医生实际输出的内容，以及它们在医生之间如何流转。'}
                      </div>
                    )}
                    {visibleMessages.map((m, i) => {
                      const isLast = i === visibleMessages.length - 1;
                      const isLiveCard = live && isLast;
                      return (
                        <div
                          key={m.key}
                          style={{
                            background: C.canvas,
                            border: `1px solid ${isLiveCard ? C.primary : C.hairline}`,
                            borderLeft: `3px solid ${m.color}`,
                            borderRadius: 2,
                            padding: '10px 12px',
                            flex: '0 0 auto',
                            boxShadow: isLiveCard
                              ? `0 0 0 1px ${C.primary}22, 0 2px 10px rgba(0,0,0,0.08)`
                              : 'none',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              marginBottom: 6,
                              flexWrap: 'wrap',
                            }}
                          >
                            <span style={{ color: C.ink, fontSize: 13, fontWeight: 700 }}>
                              {m.name}
                            </span>
                            <span
                              style={{
                                color: m.kind === 'io' ? C.mute : m.color,
                                background: m.kind === 'io' ? 'transparent' : `${m.color}14`,
                                fontSize: 9.5,
                                fontWeight: 700,
                                letterSpacing: 0.4,
                                border: `1px solid ${m.kind === 'io' ? C.hairline : `${m.color}55`}`,
                                borderRadius: 2,
                                padding: '1px 6px',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {kindMeta(m.kind).label}
                            </span>
                            <span
                              style={{
                                color: C.mute,
                                fontSize: 9.5,
                                border: `1px solid ${C.hairline}`,
                                borderRadius: 2,
                                padding: '1px 6px',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              第{m.round + 1}轮
                            </span>
                            <span
                              style={{
                                marginLeft: 'auto',
                                color: C.mute,
                                fontSize: 9.5,
                                fontVariantNumeric: 'tabular-nums',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {isLiveCard ? '● ' : ''}
                              {m.pt + m.ct > 0 ? `↑${fmt(m.pt)} ↓${fmt(m.ct)}` : ''}
                            </span>
                          </div>
                          {m.content ? (
                            <MarkdownText
                              text={m.content}
                              style={{
                                color: C.body,
                                fontSize: 12,
                                lineHeight: 1.65,
                                maxHeight: 420,
                                overflowY: 'auto',
                              }}
                            />
                          ) : (
                            <div style={{ color: C.mute, fontSize: 11.5 }}>（无文本输出）</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Slide 2 — the final conclusion, on its own dark result card */}
                {conclusion && (
                  <div
                    style={{
                      width: '50%',
                      flex: '0 0 auto',
                      minWidth: 0,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      minHeight: 0,
                      background: C.surfaceDark,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 12px',
                        borderBottom: `1px solid ${C.hairlineStrong}`,
                        flex: '0 0 auto',
                      }}
                    >
                      <span
                        style={{ width: 8, height: 8, background: C.primary, flex: '0 0 auto' }}
                      />
                      <span style={{ color: C.onDark, fontSize: 12.5, fontWeight: 700 }}>
                        最终结论
                      </span>
                      <span
                        style={{
                          marginLeft: 'auto',
                          color: C.onDarkMute,
                          fontSize: 10,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        AI 生成 · 仅供临床参考
                      </span>
                    </div>
                    <div
                      className="afv-hairscroll"
                      style={{
                        flex: '1 1 auto',
                        minHeight: 0,
                        overflowY: 'auto',
                        padding: '12px 14px',
                      }}
                    >
                      <MarkdownText
                        text={conclusion}
                        style={{ color: C.onDark, fontSize: 12.5, lineHeight: 1.7 }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Floating jump pill on the record slide once the conclusion exists */}
              {conclusion && slide === 0 && (
                <div
                  onClick={() => setSlide(1)}
                  style={{
                    position: 'absolute',
                    right: 14,
                    bottom: 12,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    background: C.surfaceDark,
                    color: C.primary,
                    border: `1px solid ${C.primary}`,
                    borderRadius: 2,
                    padding: '6px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
                    fontFamily: FONT,
                  }}
                >
                  查看最终结论 →
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------ *
 * Presentational helpers
 * ------------------------------------------------------------------------ */
function carBtn(disabled: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    color: disabled ? C.ash : C.ink,
    border: `1px solid ${C.hairline}`,
    borderRadius: 2,
    width: 22,
    height: 22,
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1,
    cursor: disabled ? 'default' : 'pointer',
    fontFamily: FONT,
  };
}

function btnPrimary(): React.CSSProperties {
  return {
    background: C.primary,
    color: C.onPrimary,
    border: `1px solid ${C.primary}`,
    borderRadius: 2,
    padding: '8px 18px',
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1,
    cursor: 'pointer',
    fontFamily: FONT,
  };
}

function btnOutlineDark(): React.CSSProperties {
  return {
    background: 'transparent',
    color: C.onDark,
    border: `1px solid ${C.onDark}`,
    borderRadius: 2,
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1,
    cursor: 'pointer',
    fontFamily: FONT,
  };
}

/* ------------------------------------------------------------------------ *
 * LoadingCubes — 3D cube loader ported from `element/loading/`
 * (Uiverse.io by gsperandio). Class names are prefixed with `afv` and the
 * keyframe renamed so the injected CSS cannot collide with viewer styles.
 * Rendered inside the modal while the consultation request has not
 * produced any data yet.
 * ------------------------------------------------------------------------ */
function LoadingCubes({ size = 10 }: { size?: number }) {
  return (
    <div style={{ position: 'relative', width: '14em', height: '14em', fontSize: size }}>
      <style>{`
        .afvCubes { position: absolute; top: 50%; left: 50%; transform-style: preserve-3d; }
        .afvLoop { transform: rotateX(-35deg) rotateY(-45deg) translateZ(1.5625em); }
        @keyframes afvCubeScale { to { transform: scale3d(0.2, 0.2, 0.2); } }
        .afvItem {
          margin: -1.5625em;
          width: 3.125em;
          height: 3.125em;
          transform-origin: 50% 50% -1.5625em;
          box-shadow: 0 0 0.125em currentColor;
          background: currentColor;
          animation: afvCubeScale 0.6s cubic-bezier(0.45, 0.03, 0.51, 0.95) infinite alternate;
        }
        .afvItem:before,
        .afvItem:after {
          position: absolute;
          width: inherit;
          height: inherit;
          transform-origin: 0 100%;
          box-shadow: inherit;
          background: currentColor;
          content: "";
        }
        .afvItem:before { bottom: 100%; transform: rotateX(90deg); }
        .afvItem:after { left: 100%; transform: rotateY(90deg); }
        .afvItem:nth-child(1) { margin-top: 6.25em; color: #fe1e52; animation-delay: -1.2s; }
        .afvItem:nth-child(1):before { color: #ff6488; }
        .afvItem:nth-child(1):after { color: #ff416d; }
        .afvItem:nth-child(2) { margin-top: 3.125em; color: #fe4252; animation-delay: -1s; }
        .afvItem:nth-child(2):before { color: #ff8892; }
        .afvItem:nth-child(2):after { color: #ff6572; }
        .afvItem:nth-child(3) { margin-top: 0em; color: #fe6553; animation-delay: -0.8s; }
        .afvItem:nth-child(3):before { color: #ffa499; }
        .afvItem:nth-child(3):after { color: #ff8476; }
        .afvItem:nth-child(4) { margin-top: -3.125em; color: #fe8953; animation-delay: -0.6s; }
        .afvItem:nth-child(4):before { color: #ffb999; }
        .afvItem:nth-child(4):after { color: #ffa176; }
        .afvItem:nth-child(5) { margin-top: -6.25em; color: #feac54; animation-delay: -0.4s; }
        .afvItem:nth-child(5):before { color: #ffce9a; }
        .afvItem:nth-child(5):after { color: #ffbd77; }
        .afvItem:nth-child(6) { margin-top: -9.375em; color: #fed054; animation-delay: -0.2s; }
        .afvItem:nth-child(6):before { color: #ffe49a; }
        .afvItem:nth-child(6):after { color: #ffda77; }
      `}</style>
      <div className="afvLoop afvCubes">
        <div className="afvItem afvCubes" />
        <div className="afvItem afvCubes" />
        <div className="afvItem afvCubes" />
        <div className="afvItem afvCubes" />
        <div className="afvItem afvCubes" />
        <div className="afvItem afvCubes" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * AgentFlowVizModal — the run-time popup (弹窗) presentation.
 *
 * Opens the moment 运行 is clicked: while the consultation POST is in flight
 * (``live``) it streams the real engine events into the graph and transcript;
 * once the run settles it becomes a scrubbable replay. A fixed full-screen
 * overlay in the NVIDIA language: black backdrop, angular black frame card,
 * green corner square + green outline close control.
 * ------------------------------------------------------------------------ */
export function AgentFlowVizModal({
  trace,
  open,
  live = false,
  onClose,
}: {
  trace: MasTracePayload | null;
  open: boolean;
  /** True while the consultation POST is still in flight (live streaming view). */
  live?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    // ESC closes; the page behind the modal must not scroll.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const specName = trace?.spec?.name ?? trace?.strategy ?? '';
  const strategyLabel = trace?.strategy_label || trace?.strategy || '';

  return (
    <>
      {/* Keyframes are re-declared here because the waiting state renders
          before AgentFlowViz (which owns the other copy) is mounted. */}
      <style>{`
        @keyframes afvPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
      `}</style>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1200,
          background: 'rgba(0,0,0,0.78)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: FONT,
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background: C.surfaceDark,
            border: `1px solid ${C.hairlineStrong}`,
            borderRadius: 2,
            width: 'min(1240px, 100%)',
            // Definite height (not just max-height): the children split the card
            // 50/50 via flex-basis 0, which needs a definite container height to
            // resolve against — otherwise the whole card collapses to content.
            height: 'calc(100vh - 48px)',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 0 40px rgba(0,0,0,0.55)',
          }}
        >
          {/* ---- Modal title bar (dark chapter) ---- */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              padding: '12px 16px',
              borderBottom: `1px solid ${C.hairlineStrong}`,
              flex: '0 0 auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ width: 12, height: 12, background: C.primary, flex: '0 0 auto' }} />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    color: C.onDark,
                    fontWeight: 700,
                    fontSize: 14,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  智能体会诊数据流
                </div>
                <div
                  style={{
                    color: C.onDarkMute,
                    fontSize: 11,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {specName || '正在启动会诊…'}
                  {strategyLabel ? ` · ${strategyLabel}` : ''} ·{' '}
                  {live ? '实时数据流动' : '真实数据流动回放'}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              style={btnClose()}
              title="关闭 (Esc)"
            >
              ✕
            </button>
          </div>

          {/* ---- Body: left pane (data-flow) and right pane (consultation
              record) each scroll independently ---- */}
          <div
            style={{
              overflow: 'hidden',
              flex: '1 1 auto',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              background: C.surfaceDark,
            }}
          >
            {trace?.status === 'error' && (
              <div
                style={{
                  margin: '10px 14px 0',
                  padding: '10px 14px',
                  borderRadius: 2,
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  background: 'rgba(127, 29, 29, 0.35)',
                  color: '#fecaca',
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  flex: '0 0 auto',
                  maxHeight: 132,
                  overflowY: 'auto',
                  wordBreak: 'break-word',
                }}
              >
                <strong style={{ color: '#f87171' }}>会话失败：</strong>
                {trace.error || '上游服务返回错误，本次会话已中止。'}
              </div>
            )}
            {trace?.status === 'cancelled' && (
              <div
                style={{
                  margin: '10px 14px 0',
                  padding: '10px 14px',
                  borderRadius: 2,
                  border: '1px solid rgba(234, 179, 8, 0.4)',
                  background: 'rgba(120, 53, 15, 0.3)',
                  color: '#fde68a',
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  flex: '0 0 auto',
                }}
              >
                本次会话已取消（被新发起的会话取代）。
              </div>
            )}
            {trace ? (
              <AgentFlowViz
                trace={trace}
                live={live}
                autoPlay={!live}
              />
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 14,
                  padding: '72px 24px',
                  overflowY: 'auto',
                  flex: '1 1 auto',
                  minHeight: 0,
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    background: C.primary,
                    animation: 'afvPulse 1.1s ease-in-out infinite',
                  }}
                />
                <div style={{ color: C.onDark, fontWeight: 700, fontSize: 14 }}>
                  正在建立智能体会诊…
                </div>
                <div style={{ color: C.onDarkMute, fontSize: 12 }}>
                  各科医生接入后，这里将实时展示数据的真实流动。
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function btnClose(): React.CSSProperties {
  return {
    background: 'transparent',
    color: C.onDark,
    border: `1px solid ${C.onDark}`,
    borderRadius: 2,
    width: 32,
    height: 32,
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1,
    cursor: 'pointer',
    flex: '0 0 auto',
    fontFamily: FONT,
  };
}

export type { MasNode, MasEdge, MasTraceEvent };
