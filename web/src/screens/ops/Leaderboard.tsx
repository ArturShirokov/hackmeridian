// 07 · Leaderboard: the Operator table, each Operator's Bond balance over the Documents, and the stage line.
// One account link per Operator row (a link under every cell would be theatre: they all point at the same account).
import { api, usePoll, type ApiLeaderRow } from "../../api.ts";
import { usdc } from "../../format.ts";
import { ProofLink, Spinner } from "../../components/ui.tsx";
import { useServerClock } from "../../screens.tsx";
import { tail } from "./common.tsx";
import { bondChart, ranked } from "./logic.ts";

const INK = "#141414", RED = "#A3221B", MONEY = "#0B4A57";
const cols = "minmax(200px,1.6fr) repeat(6,minmax(0,1fr))";
/** Series styles in fixed order: ours solid teal, the Baseline dashed red; further Operators dotted grey. */
const LINE = [{ stroke: MONEY, dash: undefined }, { stroke: RED, dash: "8 5" }, { stroke: "#6E685D", dash: "2 4" }];
const lineOf = (i: number) => LINE[Math.min(i, LINE.length - 1)]!;

export function Leaderboard() {
  const { data, error } = usePoll(api.leaderboard, 5000);
  const { config } = useServerClock();
  const acc = data?.find((r) => r.accuracy);
  const onStellar = data?.some((r) => r.link);
  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{ padding: "28px 40px 20px", borderBottom: "1px solid var(--rule)", display: "flex", alignItems: "flex-end", gap: 20 }}>
        <div>
          <div style={{ font: "600 12px/1 var(--sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "#2A2723" }}>Public</div>
          <h1 style={{ margin: "8px 0 0", font: "600 30px/1.1 var(--sans)" }}>Leaderboard</h1>
        </div>
        <span style={{ marginLeft: "auto", font: "400 14px/1.4 var(--sans)", color: "#2A2723" }}>
          {[onStellar && "Read from Stellar", acc?.accuracy && `test set of ${acc.documents} Documents, ${acc.accuracy.fields} Fields`].filter(Boolean).join(" · ")}
        </span>
      </div>
      <div style={{ padding: "24px 40px 40px", display: "flex", flexDirection: "column", gap: 36 }}>
        <div style={{ border: `1px solid ${INK}`, background: "var(--surface)" }}>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "12px 20px", borderBottom: `1px solid ${INK}`, font: "600 11px/1.3 var(--sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "#2A2723" }}>
            <span>Operator</span><span>Documents delivered</span><span>Fields delivered</span><span>Times slashed</span><span>USDC slashed to Brands</span><span>Bonds locked</span><span>Accuracy · test set</span>
          </div>
          {!data ? (
            <>
              <div style={{ padding: "28px 20px", display: "flex", alignItems: "center", gap: 12, font: "500 15px/1 var(--sans)", color: error ? RED : INK }}>
                {error ? error.message : <><Spinner />Loading from Stellar…</>}
              </div>
              {!error && <div style={{ height: 56, margin: "0 20px 12px", background: "repeating-linear-gradient(90deg,#ECE7DB 0 120px,transparent 120px 150px)" }} />}
            </>
          ) : (
            <>
              {ranked(data).map((r, i) => <Row key={r.operator} rank={i + 1} r={r} bond={config?.operators.find((o) => o.operator === r.operator)?.bond} />)}
              {data.length === 1 && (
                <div style={{ padding: "18px 20px", font: "400 15px/1.4 var(--sans)", color: "#2A2723", borderTop: "1px dashed #B5AE9F" }}>
                  Only one Operator so far. Any Pipeline can join by posting a Bond on the same Documents.
                </div>
              )}
            </>
          )}
        </div>
        {data && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,3fr) minmax(260px,1fr)", gap: 40, alignItems: "end" }}>
            <BondChart rows={data} bondOf={Object.fromEntries((config?.operators ?? []).map((o) => [o.operator, o.bond]))} />
            <p style={{ margin: "0 0 40px", font: "400 26px/1.3 var(--serif)", textWrap: "pretty" }}>
              The Bond doesn't make the model careful. It makes careless Pipelines expensive, and their error rate public.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Each number links its Stellar proof: the Operator's account, or the latest settlement that Slashed it. A zero, or a number not on chain, has none. */
function Row({ r, rank, bond }: { r: ApiLeaderRow; rank: number; bond?: string }) {
  const slashed = r.series.filter((s) => s.settlementLink && (bond === undefined || Number(s.balance) < Number(bond))).at(-1)?.settlementLink ?? r.link;
  const cells: [string, string, string?, string?][] = [
    ["Documents delivered", String(r.documents), undefined, r.documents ? r.link : undefined],
    ["Fields delivered", String(r.fieldsDelivered)],
    ["Times slashed", String(r.challengesUpheld), r.challengesUpheld ? RED : undefined, r.challengesUpheld ? slashed : undefined],
    ["USDC slashed to Brands", usdc(r.totalSlashed), MONEY, Number(r.totalSlashed) ? slashed : undefined],
    ["Bonds locked", usdc(r.bondsLocked), MONEY, Number(r.bondsLocked) ? r.link : undefined],
    ["Accuracy", r.accuracy ? `${((r.accuracy.correct / r.accuracy.fields) * 100).toFixed(1)} %` : "—"],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "center", padding: "18px 20px", borderBottom: "1px solid var(--rule-row)" }}>
      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ font: "600 18px/1.2 var(--sans)" }}><span data-rank style={{ font: "500 15px/1 var(--mono)", color: "#2A2723", marginRight: 10 }}>{rank}</span>{r.label}</span>
        <span style={{ font: "500 12px/1 var(--mono)", color: "#2A2723" }}>{r.sieves} Sieve{r.sieves === 1 ? "" : "s"}</span>
        <span style={{ marginTop: 4 }}><ProofLink href={r.link} hash={tail(r.link)} label="Account on Stellar" /></span>
      </span>
      {cells.map(([name, v, fg, href], i) => (
        <span key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {href ? (
            <a href={href} target="_blank" rel="noopener" aria-label={`${name}: ${v}${fg === MONEY ? " USDC" : ""}`} title="View on Stellar ↗"
              style={{ font: "500 24px/1 var(--mono)", color: fg ?? INK, textDecorationThickness: 1, textUnderlineOffset: 4 }}>{v}</a>
          ) : <span style={{ font: "500 24px/1 var(--mono)", color: fg ?? INK }}>{v}</span>}
          {i === 5 && r.accuracy && <span style={{ font: "500 11px/1 var(--mono)", color: "#2A2723" }}>{r.accuracy.correct} of {r.accuracy.fields} Fields</span>}
        </span>
      ))}
    </div>
  );
}

/** The smallest 1, 2, 2.5 or 5 × 10^k at or above `raw`. */
function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw - 1e-9)!;
}

/** A step line per Operator: SVG 800×260 stretched to the box; balances top at y=40, bottom at y=200. */
export function BondChart({ rows, bondOf }: { rows: ApiLeaderRow[]; bondOf: Record<string, string> }) {
  const { docs, lines } = bondChart(rows, bondOf);
  const n = docs.length;
  const all = lines.flatMap((l) => [l.bond, ...l.balances]);
  const hi = Math.max(...all, 0), lo = Math.min(...all, hi);
  const range = 3 * niceStep((hi - lo || hi * 0.3 || 1) / 3);
  const X = (k: number) => ((k + 0.5) * 800) / Math.max(n, 1);
  const Y = (v: number) => 40 + ((hi - v) / range) * 160;
  const ticks = [0, 1, 2, 3].map((i) => hi - (range * i) / 3);
  const points = (l: (typeof lines)[number]) => {
    const p = [`0,${Y(l.bond)}`];
    let prev = l.bond;
    l.balances.forEach((v, k) => {
      if (v !== prev) p.push(`${X(k)},${Y(prev)}`);
      p.push(`${X(k)},${Y(v)}`);
      prev = v;
    });
    p.push(`800,${Y(prev)}`);
    return p.join(" ");
  };
  return (
    <div style={{ paddingLeft: 56 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginBottom: 14 }}>
        <span style={{ font: "600 17px/1 var(--sans)" }}>Bond balance over the demo's Documents</span>
        <span style={{ display: "flex", gap: 18, font: "500 13px/1 var(--sans)" }}>
          {rows.map((r, i) => (
            <span key={r.operator} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 18, height: 0, borderTop: `3px ${lineOf(i).dash ? "dashed" : "solid"} ${lineOf(i).stroke}` }} />{r.label}
            </span>
          ))}
        </span>
      </div>
      <div role="img" aria-label={lines.map((l, i) => `${rows[i]!.label}: ${l.balances.map((v) => usdc(String(v))).join(", ") || usdc(String(l.bond))} USDC`).join("; ")}
        style={{ position: "relative", borderLeft: `1px solid ${INK}`, borderBottom: `1px solid ${INK}`, height: 260 }}>
        {ticks.map((t, i) => (
          <span key={i} style={{ position: "absolute", left: -52, top: Y(t) - 8, font: "500 12px/1 var(--mono)", color: i ? "#2A2723" : INK }}>{usdc(String(t))}</span>
        ))}
        <svg viewBox="0 0 800 260" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          {ticks.slice(1).map((t, i) => <line key={i} x1="0" y1={Y(t)} x2="800" y2={Y(t)} stroke="#E2DCCE" strokeWidth="1" />)}
          {lines.map((l, i) => (
            <polyline key={l.operator} points={points(l)} fill="none" stroke={lineOf(i).stroke} strokeWidth="3" strokeDasharray={lineOf(i).dash} vectorEffect="non-scaling-stroke" />
          ))}
          {docs.map((d, k) => (
            <rect key={k} x={X(k) - 400 / n} y="0" width={800 / n} height="260" fill="transparent">
              <title>{`${d}\n${lines.map((l, i) => `${rows[i]!.label}: ${usdc(String(l.balances[k]))} USDC`).join("\n")}`}</title>
            </rect>
          ))}
        </svg>
        {lines.flatMap((l) => l.steps.map((s) => (
          <span key={`${l.operator}-${s.at}`} style={{ position: "absolute", left: `${X(s.at) / 8}%`, top: Y(l.balances[s.at]!), transform: "translate(-50%,6px)", font: "600 11px/1 var(--mono)", color: RED, background: "var(--paper)", padding: "2px 3px", pointerEvents: "none" }}>
            −{usdc(String(s.drop))}
          </span>
        )))}
        {n === 0 && (
          <span style={{ position: "absolute", left: 20, top: 110, font: "400 15px/1.4 var(--sans)", color: "#2A2723" }}>No Documents delivered yet. The lines start with the first delivery.</span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(n, 1)},minmax(0,1fr))`, marginTop: 8 }}>
        {docs.map((d, k) => <span key={k} style={{ font: "500 11.5px/1.3 var(--mono)", color: "#2A2723", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d}</span>)}
      </div>
    </div>
  );
}
