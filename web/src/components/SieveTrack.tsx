// A Pipeline's Trace as stations on a track, with a fill bar for the share done.
import type { ReactNode } from "react";
import type { ApiSpan, ApiStation } from "../api.ts";
import { Spinner, WorkerChip } from "./ui.tsx";

const RED = "#A3221B";
/** Stations sit on a five-column grid so a one-Sieve Baseline lines up under the first Origyn station. */
const COLUMNS = 5;

export function SieveStation({ n, label, state, worker, meta, first, view, children }: {
  n: number; label: string; state: ApiStation["state"]; worker?: string; meta: string; first: boolean; view?: string; children?: ReactNode;
}) {
  const bd = state === "fail" ? RED : state === "wait" ? "var(--page-border)" : "var(--ink)";
  return (
    <div data-state={state} className="om-motion"
      style={{
        position: "relative", border: `${state === "run" || state === "fail" ? 1.5 : 1}px solid ${bd}`, background: state === "wait" ? "transparent" : "var(--surface)",
        padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, minHeight: 92, transition: "border-color .3s, background .3s",
      }}>
      {!first && <span style={{ position: "absolute", left: -18, top: 34, font: "500 14px/1 var(--mono)", color: "var(--grey)" }}>→</span>}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ font: "500 11px/1.35 var(--mono)", color: "#3D3A34" }}>{String(n).padStart(2, "0")}</span>
        <span style={{ flex: 1, font: "600 13.5px/1.25 var(--sans)" }}>{label}</span>
        {state === "done" && <Disc>✓</Disc>}
        {state === "run" && <Spinner />}
        {state === "fail" && (
          <span style={{ width: 18, height: 18, flex: "none", borderRadius: "50%", border: `1.5px solid ${RED}`, color: RED, display: "inline-flex", alignItems: "center", justifyContent: "center", font: "700 11px/1 var(--mono)" }}>×</span>
        )}
        {state === "wait" && <span style={{ width: 16, height: 16, flex: "none", borderRadius: "50%", border: "1.5px dashed var(--grey)" }} />}
      </div>
      <WorkerChip name={worker ?? "No Worker yet"} live={!!worker} running={state === "run"} />
      <span style={{ font: "500 12px/1.3 var(--mono)", color: state === "fail" ? RED : "#2A2723" }}>{meta}</span>
      {view && <span style={{ font: "500 11px/1.3 var(--mono)", color: "#3D3A34" }}>looked at: {view}</span>}
      {children}
    </div>
  );
}

/** A Span with the Spans inside it. */
export interface SpanNode extends ApiSpan {
  children: SpanNode[];
}

/** A Trace's flat Span list as a tree; a Span whose parent is missing sits at the top. */
export function spanTree(spans: ApiSpan[]): SpanNode[] {
  const nodes = new Map(spans.map((s) => [s.id, { ...s, children: [] as SpanNode[] }]));
  const roots: SpanNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parent === undefined || n.parent === n.id ? undefined : nodes.get(n.parent);
    (parent ? parent.children : roots).push(n);
  }
  return roots;
}

const spanState = (s: ApiSpan): ApiStation["state"] => (s.end === undefined ? "run" : "done");

/** Sub-agent Spans as an indented list: label, model and one-line result, nested as deep as reported. */
export function TraceTree({ spans, depth = 0 }: { spans: SpanNode[]; depth?: number }) {
  if (!spans.length) return null;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: depth ? "0 0 0 12px" : 0, display: "flex", flexDirection: "column", gap: 6, borderLeft: depth ? "1px solid var(--rule)" : "none" }}>
      {spans.map((s) => (
        <li key={s.id} data-span={s.id} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, font: "600 12.5px/1.25 var(--sans)" }}>
            {spanState(s) === "run" ? <Spinner /> : <Disc size={14}>✓</Disc>}{s.label}
          </span>
          <span style={{ font: "500 11.5px/1.3 var(--mono)", color: "#2A2723" }}>{s.model} · {s.view}{s.result ? ` · ${s.result}` : ""}</span>
          <TraceTree spans={s.children} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One Pipeline's track. With a Trace: one station per top-level Span (sub-agents nested inside it), then the
 * `stations` no Worker holds (still waiting, or skipped). Without one: `stations` as they are (an outside Operator's "Black box").
 */
export function SieveTrack({ label, sub, stations, trace }: { label: string; sub: string; stations: ApiStation[]; trace?: ApiSpan[] }) {
  type Item = { key: string; label: string; state: ApiStation["state"]; worker?: string; meta: string; view?: string; children?: SpanNode[] };
  const items: Item[] = trace
    ? [
        ...spanTree(trace).map((s) => ({ key: s.id, label: s.label, state: spanState(s), worker: s.model, view: s.view, meta: s.result ?? (s.end === undefined ? "working…" : "—"), children: s.children })),
        ...stations.filter((s) => s.takenAt === undefined || !s.worker).map((s) => ({ key: `station-${s.index}`, ...s })),
      ]
    : stations.map((s) => ({ key: `station-${s.index}`, ...s }));
  const cols = Math.max(COLUMNS, items.length);
  const done = items.filter((s) => s.state === "done").length;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "170px minmax(0,1fr)", gap: 20, alignItems: "stretch" }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
        <span style={{ font: "600 16px/1.2 var(--sans)" }}>{label}</span>
        <span style={{ font: "500 13px/1 var(--mono)", color: "#3D3A34" }}>{sub}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, gap: 22 }}>
          {items.map((s, i) => (
            <SieveStation key={s.key} n={i + 1} label={s.label} state={s.state} worker={s.worker} meta={s.meta} view={s.view} first={i === 0}>
              {s.children && <TraceTree spans={s.children} />}
            </SieveStation>
          ))}
        </div>
        <div style={{ height: 3, background: "var(--track)", position: "relative" }}>
          <div data-progress className="om-motion" style={{ position: "absolute", left: 0, top: 0, height: 3, background: "var(--ink)", width: `${items.length ? (done / items.length) * 100 : 0}%`, transition: "width .35s linear" }} />
        </div>
      </div>
    </div>
  );
}

export function Disc({ children, size = 18 }: { children: string; size?: number }) {
  return (
    <span style={{ width: size, height: size, flex: "none", borderRadius: "50%", background: "var(--ink)", color: "var(--paper)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "700 10px/1 var(--mono)" }}>
      {children}
    </span>
  );
}
