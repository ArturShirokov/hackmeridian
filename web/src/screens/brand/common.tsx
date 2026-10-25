// Bits the Brand screens share: loading line, the polled Document, the mobile read-only view.
import { api, usePoll, type ApiConfig, type ApiDocument, type ApiPipelineView } from "../../api.ts";
import { Countdown, Spinner, StatusBadge, type BadgeStatus } from "../../components/ui.tsx";
import { badgeFor, pageOf } from "../../components/FieldRow.tsx";
import { usdc } from "../../format.ts";
import { pipelineRows, pipelineState, reviewGroups, shown } from "./derive.ts";

export function Loading({ error }: { error?: Error }) {
  return (
    <div style={{ padding: "28px 40px", display: "flex", alignItems: "center", gap: 12, font: "500 15px/1 var(--sans)", color: error ? "#A3221B" : "var(--ink)" }}>
      {error ? error.message : <><Spinner />Loading…</>}
    </div>
  );
}

/** Polled every second: the Pipeline and Review screens animate from it. */
export const useDocument = (id: string) => usePoll(() => api.document(id), 1000, [id]);

export const templateLabel = (t: string) => `${t.charAt(0).toUpperCase()}${t.slice(1)} passport`;

/** Below 760px, Pipeline and Review show this instead: status, Bond, Field rows (Not stated first). */
export function MobileView({ d, view, live, config, offset }: { d: ApiDocument; view: ApiPipelineView; live: boolean; config?: ApiConfig; offset: number }) {
  const state = pipelineState(d);
  const e = view.escrow;
  const settled = e?.status === "settled";
  let rows: { name: string; page?: number; value: string; badge: BadgeStatus; ns: boolean }[];
  let status: string;
  if (live && !state.delivered) {
    const p = pipelineRows(view);
    rows = p.rows.map(({ field, badge }) => ({ name: field.label, page: pageOf(field), value: shown(field), badge, ns: field.status === "not stated" }));
    status = `${p.counts.final} Final · ${p.counts.converging} Converging · ${p.counts.notStated} Not stated`;
  } else {
    const g = reviewGroups(view.fields);
    rows = [...g.notStated, ...g.rows].map((f) => ({ name: f.label, page: pageOf(f), value: f.status === "not stated" ? "—" : shown(f), badge: badgeFor(f, f.challenge), ns: f.status === "not stated" }));
    status = live ? "Delivered" : `${view.label} · ${g.rows.length} Final · ${g.notStated.length} Not stated`;
  }
  return (
    <div className="om-mobile-only" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <div style={{ padding: "16px 16px 16px", borderBottom: "1px solid var(--rule)" }}>
        <div style={{ font: "500 22px/1 var(--serif)" }}>doc2dpp</div>
        <div style={{ marginTop: 14, font: "600 17px/1.25 var(--sans)", overflowWrap: "anywhere" }}>{d.name.replace(/\.pdf$/i, "")}</div>
        <div style={{ marginTop: 4, font: "400 14px/1.3 var(--sans)", color: "#3D3A34" }}>{d.supplier || "—"} · {templateLabel(d.template)}</div>
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", font: "500 13px/1.3 var(--mono)" }}>{status}</div>
        {state.delivered && e && (
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ border: "1px solid #0B4A57", color: "#0B4A57", padding: "6px 9px", font: "500 13px/1 var(--mono)" }}>
              Bond <b style={{ fontWeight: 600 }}>{usdc(e.bondLeft)} USDC</b> · {settled ? "released" : e.upheld ? "slashed" : "locked"}
            </span>
            {config && <span style={{ font: "500 15px/1 var(--mono)" }}><Countdown bare closesAt={e.closesAt} msLeft={e.msLeft} paused={e.paused} windowMs={config.challengeWindowMs} serverOffsetMs={offset} settled={settled} /></span>}
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {rows.map((x) => (
          <div key={x.name} style={{ padding: "12px 16px", borderBottom: "1px solid var(--rule-row)", display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, font: "500 13px/1.2 var(--sans)", color: "#3D3A34" }}>
              <span>{x.name}</span><span style={{ font: "500 12px/1 var(--mono)" }}>{x.page ? `p. ${x.page}` : ""}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span style={{ font: "500 16px/1.25 var(--mono)", color: x.ns ? "#6B4400" : x.value === "· · ·" ? "#3D3A34" : "var(--ink)", minWidth: 0, overflowWrap: "anywhere" }}>{x.value}</span>
              <StatusBadge status={x.badge} />
            </div>
          </div>
        ))}
        <div style={{ padding: "16px 16px 28px", font: "400 13px/1.45 var(--sans)", color: "#3D3A34" }}>Open this Document on desktop to see the evidence or file a Challenge.</div>
      </div>
    </div>
  );
}
