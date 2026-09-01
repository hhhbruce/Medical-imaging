import React from 'react';

/* Lightweight zero-dependency Markdown renderer for agent/LLM output.
 *
 * Supports the constructs the consultation agents actually emit: headings,
 * bold / italic / strike / inline code, fenced code blocks, bullet and
 * ordered lists, blockquotes, pipe tables, horizontal rules and paragraphs
 * (single newlines are kept as line breaks, as LLMs intend them).
 *
 * Everything renders as React elements - no dangerouslySetInnerHTML - so
 * model output cannot inject HTML. Colors are inherited from the container,
 * so the same component works on light transcript boxes and dark surfaces.
 */

const H_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UL_RE = /^(\s*)[-*•]\s+(.*)$/;
const OL_RE = /^(\s*)\d+[.)]\s+(.*)$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const FENCE_RE = /^\s*```/;
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
// Separator row may contain column pipes and alignment colons, e.g.
// ``| --- | :---: |``. Pipes must be allowed here or every multi-column
// table fails this check and its rows fall through to the paragraph
// parser below (which used to spin forever on them).
const TABLE_SEP_RE = /^\s*\|?[\s:|-]+\|?\s*$/;

const INLINE_RE =
  /(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(`[^`]+`)|(~~[^~]+~~)|(\[[^\]]+\]\([^)\s]+\))/g;

const inlineCodeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '0.92em',
  background: 'rgba(128,128,128,0.18)',
  borderRadius: 3,
  padding: '1px 4px',
};

const codeBlockStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '0.9em',
  background: 'rgba(128,128,128,0.15)',
  borderRadius: 4,
  padding: '8px 10px',
  overflowX: 'auto',
  whiteSpace: 'pre',
  margin: '6px 0',
};

const linkStyle: React.CSSProperties = {
  color: 'inherit',
  textDecoration: 'underline',
};

const hrStyle: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid rgba(128,128,128,0.4)',
  margin: '8px 0',
};

const listStyle: React.CSSProperties = {
  margin: '2px 0',
  paddingLeft: 18,
};

const quoteStyle: React.CSSProperties = {
  margin: '4px 0',
  padding: '2px 10px',
  borderLeft: '3px solid rgba(128,128,128,0.5)',
};

const cellStyle: React.CSSProperties = {
  border: '1px solid rgba(128,128,128,0.35)',
  padding: '3px 8px',
  textAlign: 'left',
  verticalAlign: 'top',
};

/** Render one line's inline markdown (bold / italic / code / strike / links). */
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) {
      out.push(text.slice(last, m.index));
    }
    const tok = m[0];
    const key = `${keyBase}i${k++}`;
    if (tok.startsWith('**') || tok.startsWith('__')) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('`')) {
      out.push(
        <code key={key} style={inlineCodeStyle}>
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith('~~')) {
      out.push(
        <span key={key} style={{ textDecoration: 'line-through' }}>
          {tok.slice(2, -2)}
        </span>
      );
    } else if (tok.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      if (link) {
        out.push(
          <a key={key} href={link[2]} target="_blank" rel="noreferrer" style={linkStyle}>
            {link[1]}
          </a>
        );
      } else {
        out.push(tok);
      }
    } else {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) {
    out.push(text.slice(last));
  }
  return out;
}

/** True when the line starts a new block construct (ends a paragraph). */
function startsBlock(line: string): boolean {
  return (
    H_RE.test(line) ||
    UL_RE.test(line) ||
    OL_RE.test(line) ||
    QUOTE_RE.test(line) ||
    TABLE_ROW_RE.test(line) ||
    HR_RE.test(line) ||
    FENCE_RE.test(line)
  );
}

/** True when the line at ``idx`` opens a real pipe table (separator row below). */
function isTableStart(line: string, lines: string[], idx: number): boolean {
  return (
    TABLE_ROW_RE.test(line) &&
    idx + 1 < lines.length &&
    TABLE_SEP_RE.test(lines[idx + 1]) &&
    /-/.test(lines[idx + 1])
  );
}

/**
 * True when the line at ``idx`` starts a new block construct and will be
 * consumed by a dedicated branch. A pipe-row only interrupts a paragraph
 * when it actually opens a table; otherwise it is plain paragraph text.
 * Keeping this consistent with the branches below guarantees the block
 * parser always advances - a mismatch here used to freeze the viewer.
 */
function isBlockStart(line: string, lines: string[], idx: number): boolean {
  if (TABLE_ROW_RE.test(line)) {
    return isTableStart(line, lines, idx);
  }
  return startsBlock(line);
}

/** Render markdown source into a list of React block elements. */
function renderBlocks(src: string, keyBase: string): React.ReactNode[] {
  // ``\ufffd`` replacement characters arrive from relays that corrupt
  // multi-byte UTF-8 (truncated emoji / chunk-boundary splits). They are
  // unrecoverable, so strip them here too: this also cleans traces that
  // were already stored in the viewer state before the backend sanitizer.
  const lines = src
    .replace(/\ufffd/g, '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  const nextKey = () => `${keyBase}b${k++}`;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (FENCE_RE.test(line)) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // skip the closing fence
      blocks.push(
        <pre key={nextKey()} style={codeBlockStyle}>
          {buf.join('\n')}
        </pre>
      );
      continue;
    }

    // Heading
    const h = H_RE.exec(line);
    if (h) {
      const level = h[1].length;
      const kb = nextKey();
      blocks.push(
        <div
          key={kb}
          style={{ fontWeight: 700, fontSize: Math.max(11.5, 15.5 - level), margin: '8px 0 3px' }}
        >
          {renderInline(h[2], kb)}
        </div>
      );
      i += 1;
      continue;
    }

    // Horizontal rule
    if (HR_RE.test(line)) {
      blocks.push(<hr key={nextKey()} style={hrStyle} />);
      i += 1;
      continue;
    }

    // Pipe table (header + separator row required)
    if (isTableStart(line, lines, i)) {
      const splitRow = (r: string) =>
        r
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map(c => c.trim());
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      const kb = nextKey();
      blocks.push(
        <table key={kb} style={{ borderCollapse: 'collapse', margin: '6px 0', width: '100%' }}>
          <thead>
            <tr>
              {header.map((c, ci) => (
                <th key={ci} style={{ ...cellStyle, fontWeight: 700 }}>
                  {renderInline(c, `${kb}h${ci}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {header.map((_, ci) => (
                  <td key={ci} style={cellStyle}>
                    {renderInline(r[ci] ?? '', `${kb}r${ri}c${ci}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }

    // Blockquote
    const q = QUOTE_RE.exec(line);
    if (q) {
      const buf: string[] = [q[1]];
      i += 1;
      while (i < lines.length) {
        const qm = QUOTE_RE.exec(lines[i]);
        if (!qm) {
          break;
        }
        buf.push(qm[1]);
        i += 1;
      }
      const kb = nextKey();
      blocks.push(
        <blockquote key={kb} style={quoteStyle}>
          {renderBlocks(buf.join('\n'), kb)}
        </blockquote>
      );
      continue;
    }

    // Unordered list (one nesting level via indentation)
    if (UL_RE.test(line)) {
      const items: { text: string; depth: number }[] = [];
      while (i < lines.length && UL_RE.test(lines[i])) {
        const um = UL_RE.exec(lines[i])!;
        items.push({ text: um[2], depth: um[1].length >= 2 ? 1 : 0 });
        i += 1;
        // Fold indented continuation lines into the current item.
        while (
          i < lines.length &&
          lines[i].trim() !== '' &&
          !startsBlock(lines[i]) &&
          /^\s{2,}\S/.test(lines[i])
        ) {
          items[items.length - 1].text += ` ${lines[i].trim()}`;
          i += 1;
        }
      }
      const kb = nextKey();
      blocks.push(
        <ul key={kb} style={listStyle}>
          {items.map((it, idx) => (
            <li key={idx} style={{ marginBottom: 2, marginLeft: it.depth ? 14 : 0 }}>
              {renderInline(it.text, `${kb}${idx}`)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (OL_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && OL_RE.test(lines[i])) {
        const om = OL_RE.exec(lines[i])!;
        items.push(om[2]);
        i += 1;
        while (
          i < lines.length &&
          lines[i].trim() !== '' &&
          !startsBlock(lines[i]) &&
          /^\s{2,}\S/.test(lines[i])
        ) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i += 1;
        }
      }
      const kb = nextKey();
      blocks.push(
        <ol key={kb} style={listStyle}>
          {items.map((it, idx) => (
            <li key={idx} style={{ marginBottom: 2 }}>
              {renderInline(it, `${kb}${idx}`)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Paragraph: gather lines until a blank line or a new block construct;
    // each source line becomes its own row (single \n kept as a line break).
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i], lines, i)) {
      buf.push(lines[i]);
      i += 1;
    }
    if (buf.length === 0) {
      // Safety net: always consume at least one line so the main parser
      // loop can never spin. A spin here freezes the whole viewer (the
      // popup goes black) and only a hard reload recovers it.
      buf.push(lines[i]);
      i += 1;
    }
    const kb = nextKey();
    blocks.push(
      <div key={kb} style={{ margin: '3px 0' }}>
        {buf.map((l, idx) => (
          <div key={idx}>{renderInline(l, `${kb}p${idx}`)}</div>
        ))}
      </div>
    );
  }

  return blocks;
}

export function MarkdownText({
  text,
  style,
  className,
}: {
  text: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  const blocks = React.useMemo(() => renderBlocks(text ?? '', 'md'), [text]);
  return (
    <div className={className} style={{ color: 'inherit', wordBreak: 'break-word', ...style }}>
      {blocks}
    </div>
  );
}
