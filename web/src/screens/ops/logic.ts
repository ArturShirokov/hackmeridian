// Pure display logic for the Operator and Arbiter screens (Arbiter desk, Leaderboard, Job Board).
import type { ApiChallenge, ApiJob, ApiLeaderRow } from "../../api.ts";
import type { ViewerBox } from "../../components/DocumentViewer.tsx";

/** "just now", "2 min ago", "3 h ago". */
export function ago(ms: number) {
  const m = Math.floor(ms / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
}

const norm = (q: string) => q.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The Arbiter's page boxes, one per quote (one when both quote the same line). Both are neutral until the decision,
 * so nothing hints at a side; then the side that lost turns red ("wrong") and the other "right".
 */
export function evidenceBoxes(c: Pick<ApiChallenge, "operatorLabel" | "fieldLabel" | "delivered" | "claim">, status: ApiChallenge["status"] = "filed"): ViewerBox[] {
  const d = c.delivered.evidence, q = c.claim.evidence;
  const side = (won: boolean, neutral: ViewerBox["kind"]): ViewerBox["kind"] => (status === "filed" ? neutral : won ? "right" : "wrong");
  const challenger = (tag: string, kind: ViewerBox["kind"]): ViewerBox => ({ id: "challenger", page: q.page, rects: q.rects, kind, tag, title: `Challenger quote: ${q.quote}` });
  if (!d) return [challenger("Challenger", side(status === "upheld", "challenger"))];
  if (d.page === q.page && norm(d.quote) === norm(q.quote)) return [challenger("Delivered + challenger quote", "challenger")];
  return [
    { id: "delivered", page: d.page, rects: d.rects, kind: side(status === "rejected", "delivered"), tag: `Delivered · ${c.operatorLabel}`, title: `Delivered quote: ${d.quote}` },
    challenger("Challenger", side(status === "upheld", "challenger")),
  ];
}

/** Milliseconds as mm:ss (minutes may pass 60). */
export function mmss(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** A Job board row: status label, its style key, and the time the Worker took (done) or has spent so far (taken). */
export function jobView(j: ApiJob, now: number) {
  const tone = j.status === "timed out" ? ("timeout" as const) : j.status;
  const label = j.status === "timed out" ? "timed out · back on board" : j.status;
  const end = j.status === "done" ? j.doneAt : j.status === "taken" ? now : undefined;
  return { tone, label, duration: j.takenAt !== undefined && end !== undefined ? mmss(end - j.takenAt) : "—" };
}

type SeriesRow = Pick<ApiLeaderRow, "operator" | "series">;

/**
 * Each Operator's Bond balance over the Documents: it starts at the Operator's Bond and drops by every
 * Document's Slash (bond − bondLeft), so a careless Pipeline steps down and a careful one stays flat.
 * x = the Documents any Operator delivered, in upload order; an Operator that skipped one keeps its balance.
 */
export function bondChart(rows: SeriesRow[], bondOf: Record<string, string>) {
  const ids: string[] = [], short = new Map<string, string>();
  for (const r of rows) {
    let prev = -1;
    for (const s of r.series) {
      short.set(s.documentId, s.short);
      let i = ids.indexOf(s.documentId);
      if (i < 0) ids.splice((i = prev + 1), 0, s.documentId);
      prev = i;
    }
  }
  const lines = rows.map((r) => {
    const bond = Number(bondOf[r.operator] ?? r.series[0]?.balance ?? 0);
    const left = new Map(r.series.map((s) => [s.documentId, Number(s.balance)]));
    let balance = bond;
    const steps: { at: number; drop: number }[] = [];
    const balances = ids.map((id, at) => {
      const drop = left.has(id) ? bond - left.get(id)! : 0;
      if (drop > 0) steps.push({ at, drop });
      return (balance -= drop);
    });
    return { operator: r.operator, bond, balances, steps };
  });
  return { docs: ids.map((id) => short.get(id)!), lines };
}
