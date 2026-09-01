import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  MasTracePayload,
  MasNode,
  MasEdge,
  MasTraceEvent,
} from '../stores/toolboxState';
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
const PAD = 16;

interface LayoutPos {
  x: number;
  y: number;
  level: number;
}

function computeLayout(spec: MasTracePayload['spec']): Map<string, LayoutPos> {
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
      pos.set(id, { x: i * (NODE_W + GAP_X), y: lv * (NODE_H + GAP_Y), level: lv });
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

  const pos = useMemo(() => computeLayout(spec), [spec]);

  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<number | null>(null);
  const msgsScrollRef = useRef<HTMLDivElement | null>(null);
  const wasLiveRef = useRef(live);

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

  const visibleMessages = useMemo(
    () => messages.filter(m => m.eventIdx <= step),
    [messages, step]
  );

  const shownEvents = useMemo(() => events.slice(0, step + 1), [events, step]);
  const currentEvent = step >= 0 && step < events.length ? events[step] : null;

  const liveNode = currentEvent?.node ?? null;
  // Node currently awaiting its LLM response: the engine emits node_start
  // right before the model call and node_end when the response arrives, so
  // the cube loader renders on this node for exactly the waiting window.
  const waitingNodeId =
    currentEvent?.type === 'node_start' ? currentEvent.node ?? null : null;
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
      if (ev.node) set.add(ev.node);
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

  const tokenTotal =
    (runTrace?.prompt_tokens ?? 0) + (runTrace?.completion_tokens ?? 0);
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
           Narrow viewports stack the two panes vertically. */
        .afv-split { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
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
                  <button onClick={onTogglePlay} style={btnPrimary()}>
                    {playing ? '暂停' : done ? '重播' : '播放'}
                  </button>
                  <button onClick={onReset} style={btnOutlineDark()}>
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
        <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: 12, background: C.canvas }}>
          <div style={{ position: 'relative', width: svgWidth, margin: '0 auto' }}>
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            width={svgWidth}
            height={svgHeight}
            style={{ display: 'block' }}
          >
            <defs>
              <marker id="afvArrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M0,0 L8,3 L0,6 Z" fill={C.hairline} />
              </marker>
              <marker id="afvArrowOn" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M0,0 L8,3 L0,6 Z" fill={C.primary} />
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
            {liveEdgeKey &&
              edgeDefs.some(e => `${e.src}>${e.dst}` === liveEdgeKey) && (
                <circle r="3" fill={C.primary}>
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
              const live = liveNode === n.id;
              const visited = visitedNodes.has(n.id);
              const dimmed = !visited && step >= 0;
              const title = `${n.name} (${meta.label})`;
              return (
                <g key={n.id} style={{ cursor: 'pointer' }}>
                  <title>{title}</title>
                  <rect
                    x={p.x}
                    y={p.y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={2}
                    fill={live ? 'rgba(118,185,0,0.10)' : C.canvas}
                    stroke={live ? C.primary : C.hairline}
                    strokeWidth={live ? 2 : 1}
                    strokeDasharray={n.kind === 'blackboard' ? '4 4' : undefined}
                    className={live ? 'afv-pulse' : undefined}
                    style={{ transition: 'fill 0.2s, stroke 0.2s', opacity: dimmed ? 0.5 : 1 }}
                  />
                  <rect
                    x={p.x}
                    y={p.y}
                    width={3}
                    height={NODE_H}
                    fill={meta.color}
                    opacity={visited || live ? 1 : 0.3}
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
                    fill={n.kind === 'io' || n.kind === 'blackboard' ? C.mute : meta.color}
                  >
                    {meta.label}
                  </text>
                </g>
              );
            })}
          </svg>
            {/* Cube loader pinned to the node that is waiting for its LLM
                response; it disappears the moment node_end arrives. */}
            {waitingNodeId && pos.get(waitingNodeId) && (
              <div
                style={{
                  position: 'absolute',
                  left: pos.get(waitingNodeId)!.x + NODE_W - 21,
                  top: pos.get(waitingNodeId)!.y - 21,
                  width: 42,
                  height: 42,
                  pointerEvents: 'none',
                }}
              >
                <LoadingCubes size={3} />
              </div>
            )}
          </div>
        </div>
          </div>

          {/* Right pane: consultation record (会诊记录) — one scrollable card
              per agent output. */}
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
                <span style={{ color: C.ink, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  会诊记录
                </span>
                <span style={{ color: C.mute, fontSize: 11, whiteSpace: 'nowrap' }}>
                  {visibleMessages.length}/{messages.length} 条意见
                </span>
              </div>
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
            </div>

            <div
              ref={msgsScrollRef}
              className="afv-cards"
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
                      <span style={{ color: C.ink, fontSize: 13, fontWeight: 700 }}>{m.name}</span>
                      <span
                        style={{
                          color: m.kind === 'io' ? C.mute : m.color,
                          fontSize: 9.5,
                          fontWeight: 700,
                          letterSpacing: 0.4,
                          border: `1px solid ${C.hairline}`,
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
                          maxHeight: 320,
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
        </div>

        {/* ---- Final conclusion (dark chapter) ---- */}
        <div style={{ background: C.surfaceDark, padding: '14px 16px', flex: '0 0 auto' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ width: 10, height: 10, background: C.primary, flex: '0 0 auto', marginTop: 3 }} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  color: C.primary,
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  marginBottom: 4,
                }}
              >
                最终结论
              </div>
              {step >= 0 && runTrace?.final_answer ? (
                <MarkdownText
                  text={runTrace.final_answer}
                  style={{ color: C.onDark, fontSize: 12.5, lineHeight: 1.65 }}
                />
              ) : (
                <div style={{ color: C.onDarkMute, fontSize: 12.5 }}>
                  {live ? '会诊进行中…' : step >= 0 ? '—' : '尚未完成会诊'}
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
          maxHeight: 'calc(100vh - 48px)',
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
          <button onClick={onClose} style={btnClose()} title="关闭 (Esc)">
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
          {trace ? (
            <AgentFlowViz trace={trace} live={live} autoPlay={!live} />
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
