// The Document review's view tabs beside Review: JSON, Markdown, Source Markdown and Trace, for one Operator.
import { useState, type CSSProperties, type ReactNode } from "react";
import type { ApiDocument, ApiPipelineView, ApiTemplate } from "../../api.ts";
import { passport, passportMarkdown } from "./derive.ts";

const INK = "#141414", MUTED = "#3D3A34";
export const VIEWS = ["Review", "JSON", "Markdown", "Source Markdown", "Trace"] as const;
export type View = (typeof VIEWS)[number];

/** A Span as #18 reports it (ApiSpan), nested by parent into a tree: sub-agents are children. Fits SpanNode from spanTree(). */
export interface TraceSpan {
  label: string;
  /** What it looked at: original, Markdown, a script's output… */
  view?: string;
  /** The model or tool used. */
  model?: string;
  result?: string;
  start: number;
  end?: number;
  children?: TraceSpan[];
}

const base = (d: ApiDocument, v: ApiPipelineView) => `${d.name.replace(/\.pdf$/i, "")}.${v.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
const dataUrl = (type: string, text: string) => `data:${type};charset=utf-8,${encodeURIComponent(text)}`;

function Bar({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: "1px solid var(--rule)" }}>{children}</div>;
}
const Download = ({ href, name, label, style }: { href: string; name: string; label: string; style?: CSSProperties }) => (
  <a className="om-btn primary" style={{ marginLeft: "auto", height: 36, padding: "0 14px", fontSize: 13, textDecoration: "none", ...style }} href={href} download={name}>{label}</a>
);
const Empty = ({ children }: { children: ReactNode }) => (
  <div style={{ padding: "28px 20px", font: "500 15px/1.5 var(--sans)", color: MUTED }}>{children}</div>
);
/** Sieve independence: nothing to show or download until every Operator has delivered. */
const notYet = (v: ApiPipelineView) =>
  !v.escrow ? `${v.label} has not delivered this Document yet.`
  : v.fields.some((f) => "withheld" in f) ? "The values are shown once every Operator has delivered this Document." : undefined;
const preStyle = { margin: 0, padding: "16px 20px", font: "400 13px/1.6 var(--mono)", color: INK, whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;

/** JSON with keys, strings, numbers and literals coloured. */
function Highlighted({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/("(?:[^"\\]|\\.)*")(\s*:)?|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|true|false|null/g)) {
    out.push(text.slice(last, m.index));
    const color = m[2] ? INK : m[1] ? "#6B4400" : "var(--money)";
    out.push(<span key={m.index} style={{ color, fontWeight: m[2] ? 600 : 400 }}>{m[1] ?? m[0]}</span>, m[2] ?? "");
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return <pre data-testid="json" style={preStyle}>{out}</pre>;
}

export function JsonView({ d, v, template }: { d: ApiDocument; v: ApiPipelineView; template?: ApiTemplate }) {
  const wait = notYet(v);
  if (wait) return <Empty>{wait}</Empty>;
  const text = JSON.stringify(passport(d, v, template), null, 2);
  return (
    <>
      <Bar>
        <span style={{ font: "500 13px/1.3 var(--sans)", color: MUTED }}>Passport output · every Template Field, keyed by name</span>
        <Download href={dataUrl("application/json", text)} name={`${base(d, v)}.passport.json`} label="Download .json" />
      </Bar>
      <Highlighted text={text} />
    </>
  );
}

export function MarkdownView({ d, v, template }: { d: ApiDocument; v: ApiPipelineView; template?: ApiTemplate }) {
  const [raw, setRaw] = useState(false);
  const wait = notYet(v);
  if (wait) return <Empty>{wait}</Empty>;
  const text = passportMarkdown(d, v, template);
  return (
    <>
      <Bar>
        <span style={{ font: "500 13px/1.3 var(--sans)", color: MUTED }}>The Fields as tables, one per Template section</span>
        <button className="om-btn ghost" style={{ marginLeft: "auto", height: 36, padding: "0 14px", fontSize: 13 }} onClick={() => setRaw(!raw)}>{raw ? "Rendered" : "Raw"}</button>
        <Download href={dataUrl("text/markdown", text)} name={`${base(d, v)}.md`} label="Download .md" style={{ marginLeft: 0 }} />
      </Bar>
      {raw ? <pre data-testid="markdown" style={preStyle}>{text}</pre> : <RenderedMarkdown text={text} />}
    </>
  );
}

const cellStyle = { padding: "6px 10px", borderBottom: "1px solid var(--rule-row)", textAlign: "left", verticalAlign: "top", overflowWrap: "break-word" } as const;
/** Status and Page stay on one line; Field, Value and Quote wrap. */
const nowrap = (j: number) => (j === 2 || j === 3 ? { whiteSpace: "nowrap" } as const : {});

/**
 * Our own generated Markdown only (passportMarkdown): # and ## headings and pipe tables, `\|` escaped in cells.
 * ponytail: not a general Markdown renderer; anything else renders as a plain paragraph.
 */
function RenderedMarkdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  const cells = (l: string) => l.trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i]!.startsWith("|"); i++) if (!/^\|[\s|:-]+\|$/.test(lines[i]!)) rows.push(cells(lines[i]!));
      i--;
      const [head, ...body] = rows;
      out.push(
        <table key={i} style={{ width: "100%", borderCollapse: "collapse", font: "400 13px/1.4 var(--sans)", color: INK, marginBottom: 8 }}>
          <thead><tr>{head!.map((c, j) => <th key={j} style={{ ...cellStyle, font: "600 11px/1.2 var(--sans)", letterSpacing: ".07em", textTransform: "uppercase", color: "#2A2723", borderBottom: `1px solid ${INK}`, ...nowrap(j) }}>{c}</th>)}</tr></thead>
          <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} style={{ ...cellStyle, ...nowrap(j), ...(j === 1 && { fontFamily: "var(--mono)" }) }}>{c}</td>)}</tr>)}</tbody>
        </table>,
      );
    } else if (l.startsWith("## ")) out.push(<h3 key={i} style={{ margin: "18px 0 8px", font: "600 15px/1.3 var(--sans)" }}>{l.slice(3)}</h3>);
    else if (l.startsWith("# ")) out.push(<h2 key={i} style={{ margin: "4px 0 8px", font: "600 18px/1.3 var(--sans)", overflowWrap: "anywhere" }}>{l.slice(2)}</h2>);
    else if (l.trim()) out.push(<p key={i} style={{ margin: "0 0 8px" }}>{l}</p>);
  }
  return <div style={{ padding: "12px 20px 20px" }}>{out}</div>;
}

export function SourceMarkdown({ v }: { v: ApiPipelineView }) {
  if (v.markdown === undefined)
    return <Empty>Source Markdown is not available for {v.label}: it reads the original Document and hands in no checked Markdown.</Empty>;
  return (
    <>
      <Bar><span style={{ font: "500 13px/1.3 var(--sans)", color: MUTED }}>The checked Markdown {v.label} read, beside the original page</span></Bar>
      <pre data-testid="source-markdown" style={{ ...preStyle, background: "var(--band)" }}>{v.markdown}</pre>
    </>
  );
}

/** The Operator's Spans as a nested timeline, bars scaled to the whole Trace. */
export function TraceView({ spans }: { spans?: TraceSpan[] }) {
  const all: { s: TraceSpan; depth: number }[] = [];
  const walk = (xs: TraceSpan[], depth: number) => xs.forEach((s) => (all.push({ s, depth }), walk(s.children ?? [], depth + 1)));
  walk(spans ?? [], 0);
  const t0 = Math.min(...all.map(({ s }) => s.start));
  const t1 = Math.max(...all.map(({ s }) => s.end ?? s.start));
  const span = Math.max(1, t1 - t0);
  return (
    <>
      {all.length === 0 ? <Empty>No Trace reported.</Empty> : (
        <div role="list" style={{ padding: "10px 0" }}>
          {all.map(({ s, depth }, i) => (
            <div role="listitem" key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 40%", gap: 12, alignItems: "center", padding: `6px 20px 6px ${20 + depth * 18}px`, borderBottom: "1px solid var(--rule-row)" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ font: "600 14px/1.3 var(--sans)" }}>{depth > 0 && "↳ "}{s.label}</span>
                <span style={{ font: "400 12px/1.3 var(--mono)", color: MUTED }}>{[s.view, s.model, s.result].filter(Boolean).join(" · ")}</span>
              </span>
              <span style={{ position: "relative", height: 10, background: "var(--band)" }}>
                <span style={{ position: "absolute", top: 0, bottom: 0, left: `${((s.start - t0) / span) * 100}%`, width: `${Math.max(1, (((s.end ?? s.start) - s.start) / span) * 100)}%`, background: INK }} />
              </span>
            </div>
          ))}
        </div>
      )}
      <div style={{ padding: "10px 20px", font: "400 13px/1.4 var(--sans)", color: MUTED }}>Self-reported; the Bond is the guarantee.</div>
    </>
  );
}
