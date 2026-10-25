// A Pipeline's Sieves as stations on a track, with a fill bar for the share done.
import type { ApiStation } from "../api.ts";
import { Spinner, WorkerChip } from "./ui.tsx";

const RED = "#A3221B";
/** Stations sit on a five-column grid so a one-Sieve Baseline lines up under the first Origyn station. */
const COLUMNS = 5;

export function SieveStation({ n, label, state, worker, meta, first }: {
  n: number; label: string; state: ApiStation["state"]; worker?: string; meta: string; first: boolean;
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
    </div>
  );
}

export function SieveTrack({ label, sub, stations }: { label: string; sub: string; stations: ApiStation[] }) {
  const cols = Math.max(COLUMNS, stations.length);
  const done = stations.filter((s) => s.state === "done").length;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "170px minmax(0,1fr)", gap: 20, alignItems: "stretch" }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
        <span style={{ font: "600 16px/1.2 var(--sans)" }}>{label}</span>
        <span style={{ font: "500 13px/1 var(--mono)", color: "#3D3A34" }}>{sub}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, gap: 22 }}>
          {stations.map((s, i) => (
            <SieveStation key={s.index} n={s.index + 1} label={s.label} state={s.state} worker={s.worker} meta={s.meta} first={i === 0} />
          ))}
        </div>
        <div style={{ height: 3, background: "var(--track)", position: "relative" }}>
          <div className="om-motion" style={{ position: "absolute", left: 0, top: 0, height: 3, background: "var(--ink)", width: `${(done / cols) * 100}%`, transition: "width .35s linear" }} />
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
