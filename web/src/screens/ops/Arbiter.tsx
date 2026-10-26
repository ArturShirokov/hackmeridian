// 06 · Arbiter desk: the queue, a three-column evidence view (page with both quotes, values + Template rule, decision), the record.
// The Slash is paid at settlement, not at Uphold, so the result says so and shows the settlement link once it exists.
import { useEffect, useState } from "react";
import { api, usePoll, type ApiChallenge } from "../../api.ts";
import { Link } from "../../router.tsx";
import { clock, usdc } from "../../format.ts";
import { DocumentViewer } from "../../components/DocumentViewer.tsx";
import { ProofLink } from "../../components/ui.tsx";
import { useServerClock } from "../../screens.tsx";
import { Loading, tail, th, useNow } from "./common.tsx";
import { ago, evidenceBoxes } from "./logic.ts";
import { arbiterCopy, possessive } from "../../money.ts";

const INK = "#141414", RED = "#A3221B";
type Decision = "upheld" | "rejected";
const cols = "minmax(0,2fr) minmax(0,1.2fr) minmax(0,1.1fr) 110px 120px 130px";
const label = { font: "600 10.5px/1 var(--sans)", letterSpacing: ".07em", textTransform: "uppercase", color: "#2A2723" } as const;

export function Arbiter() {
  const { data, error } = usePoll(api.arbiter, 2000);
  const { offset } = useServerClock();
  const now = useNow(offset);
  const [sel, setSel] = useState<string>();
  /** Decisions made here, shown before the next poll confirms them. */
  const [mine, setMine] = useState<Partial<Record<string, Decision>>>({});

  const all = data ? [...data.open, ...data.decided] : [];
  const c = all.find((x) => x.id === sel) ?? data?.open[0];
  const statusOf = (x: ApiChallenge) => mine[x.id] ?? x.status;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "none", padding: "20px 28px", borderBottom: "1px solid var(--rule)", display: "flex", alignItems: "flex-end", gap: 24 }}>
        <div>
          <div style={{ font: "600 12px/1 var(--sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "#2A2723" }}>Arbiter desk</div>
          <h1 style={{ margin: "8px 0 0", font: "600 28px/1.1 var(--sans)" }}>Challenges</h1>
        </div>
        {data && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 28, alignItems: "baseline" }}>
            {([["Decided", data.record.decided, INK], ["Upheld", data.record.upheld, RED], ["Rejected", data.record.rejected, INK], ["Earned · USDC", usdc(data.record.earned), "var(--money)"]] as const).map(([k, v, fg]) => (
              <span key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={label}>{k}</span>
                <span style={{ font: "500 26px/1 var(--mono)", color: fg }}>{v}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      {!data ? <Loading error={error} pad="20px 28px" /> : (
        <>
          {all.length > 0 && (
            <div style={{ flex: "none", borderBottom: `1px solid ${INK}`, maxHeight: 46 * 4 + 30, overflow: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: cols, gap: 14, padding: "9px 28px", borderBottom: "1px solid var(--rule)", ...th }}>
                <span>Document</span><span>Field</span><span>Operator</span><span>Filed</span><span>Window left</span><span></span>
              </div>
              {all.map((x) => {
                const s = statusOf(x);
                return (
                  <div key={x.id} role="button" tabIndex={0} aria-pressed={x === c} className="om-qrow"
                    onClick={() => setSel(x.id)} onKeyDown={(e) => e.key === "Enter" && setSel(x.id)}
                    style={{ display: "grid", gridTemplateColumns: cols, gap: 14, alignItems: "center", padding: "0 28px", height: 46, borderBottom: "1px solid var(--rule-row)", background: x === c ? "#E4DED0" : undefined, cursor: "pointer" }}>
                    <span style={{ font: "500 14px/1.2 var(--sans)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {x.documentName} <span style={{ color: "#2A2723", fontWeight: 400 }}>· {x.brand}</span>
                    </span>
                    <span style={{ font: "500 14px/1.2 var(--sans)" }}>{x.fieldLabel}</span>
                    <span style={{ font: "400 14px/1.2 var(--sans)" }}>{x.operatorLabel}</span>
                    <span style={{ font: "500 13px/1 var(--mono)", color: "#2A2723" }}>{ago(now - x.filedAt)}</span>
                    <span style={{ font: "500 14px/1 var(--mono)" }}>{clock(x.paused ? x.msLeft : x.closesAt - now)}{x.paused && <span style={{ font: "500 11px/1 var(--sans)", color: "#3D3A34" }}> paused</span>}</span>
                    <span style={{ font: "600 11px/1 var(--sans)", letterSpacing: ".05em", textTransform: "uppercase", color: s === "upheld" ? RED : s === "rejected" ? "#5E594F" : INK }}>
                      {s === "filed" ? "Open" : s}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {c ? (
            <Evidence key={c.id} c={c} status={statusOf(c)} onDecided={(d) => { setSel(c.id); setMine((m) => ({ ...m, [c.id]: d })); }} />
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center" }}>
              <span style={{ font: "400 34px/1.2 var(--serif)" }}>No open Challenges.</span>
              <span style={{ font: "400 17px/1.4 var(--sans)", color: "#2A2723" }}>Bonds are settling automatically.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Evidence({ c, status, onDecided }: { c: ApiChallenge; status: ApiChallenge["status"]; onDecided(d: Decision): void }) {
  const [page, setPage] = useState(c.claim.evidence.page);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  /** Slash token: 1 shown on the Bond, 2 falling to the Brand, 3 landed (the result shows). */
  const [phase, setPhase] = useState(status === "filed" ? 0 : 3);
  const { data: doc } = usePoll(() => api.document(c.documentId), 2000, [c.documentId]);
  const { config } = useServerClock();
  const escrow = doc?.views.find((v) => v.pipeline === c.pipeline)?.escrow;
  const bond = escrow?.bondLeft ?? config?.operators.find((o) => o.pipeline === c.pipeline)?.bond ?? "0";

  useEffect(() => {
    if (phase !== 1) return;
    const a = setTimeout(() => setPhase(2), 60), b = setTimeout(() => setPhase(3), 1300);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [phase]);

  const decide = async (d: Decision) => {
    setBusy(true);
    setErr(undefined);
    try {
      await api.decide(c.id, d, note.trim() || undefined);
      onDecided(d);
      setPhase(d === "upheld" ? 1 : 3);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const upheld = status === "upheld", landed = upheld && phase === 3;
  const settled = escrow?.status === "settled";
  const copy = arbiterCopy(c);
  const fileUrl = doc?.fileUrl ?? `/documents/${c.documentId}/file`;
  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0,5fr) minmax(0,4fr) minmax(320px,3fr)" }}>
      <div style={{ minHeight: 0, display: "flex", borderRight: `1px solid ${INK}` }}>
        <DocumentViewer pdfUrl={fileUrl} page={page} onPage={setPage} onBoxClick={() => {}} boxes={evidenceBoxes(c, status)} caption={c.documentName} />
      </div>

      <div style={{ minHeight: 0, overflow: "auto", padding: "22px 26px", display: "flex", flexDirection: "column", gap: 20, borderRight: "1px solid var(--rule)" }}>
        <div data-testid="challenge-title" style={{ font: "600 18px/1.3 var(--sans)" }}>{copy.title}</div>
        {/* Neutral until the decision: no colour hints at a side. Then the losing value turns red. */}
        <ValueBox title={copy.delivered} value={c.delivered.display} quote={c.delivered.evidence} onPage={setPage} {...tone(status, "rejected")} />
        <ValueBox title={copy.claim} value={c.claim.display} quote={c.claim.evidence} onPage={setPage} {...tone(status, "upheld")} />
        <div style={{ borderTop: `1px solid ${INK}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ ...label, fontSize: 11 }}>Template rule for this Field</span>
          <span style={{ font: "500 15px/1.5 var(--mono)" }}>{c.rule}</span>
        </div>
      </div>

      <div style={{ minHeight: 0, overflow: "auto", padding: "22px 24px", display: "flex", flexDirection: "column", gap: 18, background: "var(--surface)" }}>
        <span style={{ font: "600 18px/1 var(--sans)" }}>Decision</span>
        <div style={{ position: "relative", flex: "none", height: 270, border: "1px solid var(--rule)", padding: 14, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ border: `1px solid ${landed ? RED : "var(--money)"}`, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 5, color: "var(--money)", background: "var(--surface)" }}>
            <span style={label}>{possessive(c.operatorLabel)} Bond</span>
            <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <b style={{ font: "600 26px/1 var(--mono)" }}>{usdc(bond)}</b>
              <span style={{ font: "500 12px/1 var(--mono)" }}>USDC · {settled ? "released" : landed || (escrow?.upheld ?? 0) > 0 ? "slashed" : "locked"}</span>
            </span>
          </div>
          <div aria-hidden className="om-motion"
            style={{ position: "absolute", left: 28, top: 84, zIndex: 2, transform: `translateY(${phase >= 2 && upheld ? 150 : 0}px)`, opacity: upheld && (phase === 1 || phase === 2) ? 1 : 0,
              transition: "transform 1.1s cubic-bezier(.6,0,.3,1),opacity .25s", background: "var(--money)", color: "#FFFFFF", padding: "7px 10px", font: "600 15px/1 var(--mono)" }}>
            Slash {usdc(c.slash)} USDC ↓
          </div>
          <div style={{ position: "absolute", left: 44, top: 72, bottom: 72, borderLeft: "1px dashed var(--money-soft)" }} />
          <div style={{ border: `1px solid ${INK}`, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ font: "600 15px/1 var(--sans)" }}>{c.brand}</span>
            <span style={{ font: "600 22px/1 var(--mono)", color: "var(--money)" }}>{landed ? `+${usdc(c.slash)}` : "0.00"} USDC</span>
          </div>
        </div>

        {status === "filed" ? (
          <>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" rows={3} aria-label="Note"
              style={{ resize: "none", border: "1px solid #8E877A", background: "#FFFFFF", padding: "10px 12px", font: "400 14px/1.45 var(--sans)", color: INK, outline: "none" }} />
            {/* Neutral: the same ink under both, so nothing hints which side is right before the decision. */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
              {([["upheld", "uphold", "Uphold", copy.uphold], ["rejected", "reject", "Reject", copy.reject]] as const).map(([d, cls, name, what]) => (
                <span key={d} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button className={`om-decide ${cls}`} disabled={busy} onClick={() => decide(d)} aria-describedby={`why-${d}`}>{name}</button>
                  <span id={`why-${d}`} style={{ font: "400 13px/1.4 var(--sans)", color: INK }}>{what}</span>
                </span>
              ))}
            </div>
            {err && <span role="alert" style={{ font: "500 14px/1.4 var(--sans)", color: RED }}>{err}</span>}
          </>
        ) : phase === 3 && (
          <>
            <div className="om-motion" style={{ border: `1.5px solid ${upheld ? RED : INK}`, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, animation: "om-in .3s ease-out" }}>
              <span style={{ font: "600 17px/1.25 var(--sans)", color: upheld ? RED : INK }}>
                {upheld ? `Upheld. Slash ${usdc(c.slash)} USDC to ${c.brand}.` : "Rejected. The delivered value stands."}
              </span>
              <span style={{ font: "400 14px/1.5 var(--sans)" }}>
                {upheld
                  ? `The corrected value ${c.claim.display} replaces ${c.delivered.display} in the Document. The Slash is paid to ${c.brand} when the Challenge Window closes; the rest of the Bond stays locked until then.`
                  : "No Slash. The Bond stays locked until the Challenge Window closes, then settles automatically."}
              </span>
              {c.note && <span style={{ font: "400 14px/1.5 var(--sans)", color: "#2A2723" }}>Note: {c.note}</span>}
              <ProofLink href={escrow?.settlementLink} hash={tail(escrow?.settlementLink)} />
            </div>
            <Link to={`/documents/${c.documentId}?pipeline=${encodeURIComponent(c.pipeline)}&field=${encodeURIComponent(c.field)}`}
              className="om-btn primary" style={{ height: 46, fontSize: 15, textDecoration: "none" }}>
              See it in {c.brand}{c.brand.endsWith("s") ? "’" : "’s"} Document
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

/** A value box's look: neutral while filed; after the decision, the side it won on gets teal, the other red. */
function tone(status: ApiChallenge["status"], wins: Decision) {
  if (status === "filed") return { border: `1.5px solid ${INK}` };
  return status === wins ? { border: "1.5px solid #0B4A57", bg: "#E3ECEE", color: "#0B4A57" } : { border: `1.5px solid ${RED}`, color: RED };
}

function ValueBox({ title, value, quote, border, bg, color, onPage }: {
  title: string; value: string; quote?: { page: number; quote: string }; border: string; bg?: string; color?: string; onPage(n: number): void;
}) {
  return (
    <div style={{ border, background: bg, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ ...label, fontSize: 11, color: color ?? INK }}>{title}</span>
      <span style={{ font: "500 28px/1.1 var(--mono)" }}>{value}</span>
      {quote && (
        <button onClick={() => onPage(quote.page)} title={`Show p. ${quote.page}`}
          style={{ all: "unset", cursor: "pointer", font: "400 13.5px/1.45 var(--doc)", color: "#2A2723" }}>
          <span style={{ font: "500 12px/1 var(--mono)", marginRight: 8 }}>p. {quote.page}</span>“{quote.quote}”
        </button>
      )}
    </div>
  );
}
