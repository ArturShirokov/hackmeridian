// Bits shared by the Arbiter desk, Leaderboard and Job Board.
import { useEffect, useState } from "react";
import { api, usePoll, type ApiLeaderRow } from "../../api.ts";
import { ProofLink, Spinner } from "../../components/ui.tsx";
import { operatorBonds } from "../../money.ts";

/** The server's clock (Date.now() + offset), ticking every second. */
export function useNow(offset: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now + offset;
}

export function Loading({ error, text = "Loading…", pad = "28px 40px" }: { error?: Error; text?: string; pad?: string }) {
  return (
    <div style={{ padding: pad, display: "flex", alignItems: "center", gap: 12, font: "500 15px/1 var(--sans)", color: error ? "#A3221B" : "var(--ink)" }}>
      {error ? error.message : <><Spinner />{text}</>}
    </div>
  );
}

export const th = { font: "600 11px/1 var(--sans)", letterSpacing: ".07em", textTransform: "uppercase", color: "#2A2723" } as const;

/** The last path segment of an explorer link, for ProofLink's short hash. */
export const tail = (href?: string) => href?.split(/[/?#]/).filter(Boolean).pop() ?? "";

/** "Origyn's Bonds": Documents with a Bond locked, locked now, Slashed, Fees earned, and the Operator's Stellar account. */
export function BondsCard({ row, compact }: { row: ApiLeaderRow; compact?: boolean }) {
  const b = operatorBonds(row);
  return (
    <div data-testid="operator-bonds" style={{ display: "flex", flexDirection: "column", gap: 6, color: "var(--money)" }}>
      <span style={{ font: `600 ${compact ? 12 : 14}px/1.3 var(--sans)`, color: "var(--ink)" }}>{b.title}</span>
      {b.rows.map(([k, v]) => (
        <span key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, font: `400 ${compact ? 12 : 13.5}px/1.3 var(--sans)` }}>
          <span style={{ color: "#2A2723" }}>{k}</span><b style={{ font: `600 ${compact ? 12 : 13.5}px/1.3 var(--mono)`, whiteSpace: "nowrap" }}>{v}</b>
        </span>
      ))}
      <ProofLink href={row.link} hash="" label="Account on Stellar" />
    </div>
  );
}

/** The signed-in Operator's Bonds, by Pipeline name (ApiUser.operator), for the sidebar. */
export function MyBonds({ pipeline }: { pipeline: string }) {
  const { data: config } = usePoll(api.config, 60_000);
  const { data: rows } = usePoll(api.leaderboard, 5000);
  const id = config?.operators.find((o) => o.pipeline === pipeline)?.operator;
  const row = rows?.find((r) => r.operator === id);
  return row ? <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--rule)" }}><BondsCard row={row} compact /></div> : null;
}
