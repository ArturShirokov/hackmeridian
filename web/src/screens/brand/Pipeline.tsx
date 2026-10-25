// Brand: one Document going through both Pipelines, live (polled every second).
import { useEffect, useState } from "react";
import type { ApiDocument } from "../../api.ts";
import { Link } from "../../router.tsx";
import { clock, usdc } from "../../format.ts";
import { FieldRow } from "../../components/FieldRow.tsx";
import { SieveTrack } from "../../components/SieveTrack.tsx";
import { Countdown, ProofLink, Spinner, StatusBadge, TieBreakTag } from "../../components/ui.tsx";
import { useServerClock } from "../../screens.tsx";
import { Loading, MobileView, templateLabel, useDocument } from "./common.tsx";
import { pipelineRows, pipelineState, withShown } from "./derive.ts";

const cols = "260px minmax(0,1fr) 170px 70px 110px";

/** Upload to the last delivery (or now): "00:32", hours only when needed. */
function useElapsed(d: ApiDocument, offset: number) {
  const done = pipelineState(d).delivered;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [done]);
  const end = done ? Math.max(...d.views.map((v) => v.deliveredAt ?? 0)) : now + offset;
  const c = clock(end - d.uploadedAt);
  return c.startsWith("00:") ? c.slice(3) : c;
}

export function BrandPipeline({ id }: { id: string }) {
  const { data: d, error } = useDocument(id);
  const { config, offset } = useServerClock();
  if (!d) return <Loading error={error} />;
  return (
    <>
      <PipelineDesktop d={d} offset={offset} windowMs={config?.challengeWindowMs} />
      <MobileView d={d} view={d.views[0]!} live config={config} offset={offset} />
    </>
  );
}

function PipelineDesktop({ d, offset, windowMs }: { d: ApiDocument; offset: number; windowMs?: number }) {
  const ours = d.views[0]!;
  const state = pipelineState(d);
  const { rows, counts } = pipelineRows(ours);
  const elapsed = useElapsed(d, offset);
  const e = ours.escrow;
  return (
    <div className="om-desktop-only" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "18px 32px", borderBottom: "1px solid var(--rule)", display: "flex", alignItems: "center", gap: 28 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: "600 22px/1.2 var(--sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
          <div style={{ marginTop: 5, font: "400 14px/1.3 var(--sans)", color: "#3D3A34" }}>
            {d.supplier || "—"} · {templateLabel(d.template)} · {ours.fields.length} Fields · {d.pages} page{d.pages === 1 ? "" : "s"}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, font: "600 14px/1 var(--sans)" }}>
          {state.delivered
            ? <><span style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--ink)", color: "var(--paper)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "700 10px/1 var(--mono)" }}>✓</span>Delivered</>
            : <><Spinner />{state.word}</>}
        </div>
        <div style={{ font: "500 22px/1 var(--mono)" }}>{elapsed}</div>
      </div>
      <div style={{ padding: "18px 32px 20px", borderBottom: "1px solid var(--rule)", background: "var(--band)", display: "flex", flexDirection: "column", gap: 16 }}>
        {state.banner && (
          <div role="status" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", border: `1px solid ${state.banner.kind === "rerun" ? "#A3221B" : "#8E877A"}`, background: "var(--surface)", font: "500 14px/1.3 var(--sans)", color: state.banner.kind === "rerun" ? "#A3221B" : "var(--ink)" }}>
            <span style={{ font: "700 13px/1 var(--mono)" }}>{state.banner.kind === "rerun" ? "×" : "…"}</span>{state.banner.text}
          </div>
        )}
        {d.views.map((v) => <SieveTrack key={v.pipeline} label={v.label} sub={`${v.stations.length} Sieve${v.stations.length === 1 ? "" : "s"}`} trace={v.trace}
          stations={v.stations.map((s) => ({ ...s, meta: s.meta || (s.state === "run" ? "working…" : "—"), ...(s.meta === "skipped" && { worker: "Not needed" }) }))} />)}
        <div style={{ font: "500 12.5px/1.3 var(--mono)", color: "#3D3A34" }}>Trace is self-reported; the Bond is the guarantee.</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 16, padding: "10px 32px", borderBottom: "1px solid var(--rule)", font: "600 11px/1 var(--sans)", letterSpacing: ".07em", textTransform: "uppercase", color: "#3D3A34", position: "sticky", top: 0, background: "var(--paper)", zIndex: 1 }}>
          <span>Field</span><span>Value</span><span>Status</span><span>Page</span><span></span>
        </div>
        {rows.map(({ field, badge }) => badge === "queued"
          ? (
            <div key={field.name} style={{ display: "grid", gridTemplateColumns: cols, gap: 16, alignItems: "center", padding: "0 32px", height: 48, borderBottom: "1px solid var(--rule-row)" }}>
              <span style={{ font: "500 15px/1.2 var(--sans)" }}>{field.label}</span>
              <span style={{ font: "500 15px/1.2 var(--mono)", color: "#8E877A" }}>· · ·</span>
              <StatusBadge status="queued" size="md" />
              <span /><span>{field.tieBreak && <TieBreakTag />}</span>
            </div>
          )
          : <FieldRow key={field.name} dense field={withShown(field)} selected={false} expanded={false} tieBreak={field.tieBreak} canChallenge={false} onSelect={noop} onToggle={noop} onChallenge={noop} />)}
      </div>
      <div style={{ flex: "none", borderTop: "1px solid var(--ink)", padding: "0 32px", height: 76, display: "flex", alignItems: "center", gap: 28, background: "var(--surface)" }}>
        {!state.delivered ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 28, font: "500 22px/1 var(--mono)" }}>
            <span>{counts.final} <span style={{ font: "500 15px/1 var(--sans)" }}>Final</span></span>
            <span style={{ color: "#3D3A34" }}>·</span>
            <span>{counts.converging} <span style={{ font: "500 15px/1 var(--sans)" }}>Converging</span></span>
            <span style={{ color: "#3D3A34" }}>·</span>
            <span style={{ color: "#6B4400" }}>{counts.notStated} <span style={{ font: "500 15px/1 var(--sans)" }}>Not stated</span></span>
          </div>
        ) : (
          <div className="om-motion" style={{ display: "flex", alignItems: "center", gap: 22, animation: "om-in .4s ease-out", flex: 1, minWidth: 0 }}>
            <span style={{ font: "600 20px/1 var(--sans)" }}>Delivered.</span>
            {e && <span style={{ font: "500 20px/1 var(--mono)", color: "var(--money)" }}>Bond {usdc(e.bond)} USDC {e.status === "settled" ? "released" : "locked"}.</span>}
            {e && windowMs !== undefined && (
              <span style={{ font: "500 20px/1 var(--mono)", display: "flex", gap: 10, alignItems: "baseline" }}>
                Challenge Window <Countdown bare closesAt={e.closesAt} windowMs={windowMs} serverOffsetMs={offset} settled={e.status === "settled"} />
              </span>
            )}
            {e && <ProofLink href={e.link} hash={e.outputHash} />}
            <Link to={`/documents/${d.id}`} style={{ marginLeft: "auto" }}>
              <button className="om-btn primary" style={{ height: 48, padding: "0 22px", fontSize: 16 }}>Review Document</button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

const noop = () => {};
