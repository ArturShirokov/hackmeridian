// 01 · Landing: the public entry at / when signed out. Terms, Field counts, accuracy and the proof link come from the API;
// the hero card is a sample from a test Document (testdata/expected/battery-01-voltaris-pack-spec.json).
import type { CSSProperties, ReactNode } from "react";
import { api, usePoll, type ApiConfig, type ApiLeaderRow } from "../api.ts";
import { ConnectAgent } from "../components/ConnectAgent.tsx";
import { ProofLink } from "../components/ui.tsx";
import { clock, usdc } from "../format.ts";
import { Link } from "../router.tsx";
import { tail } from "./ops/common.tsx";
import { windowLength } from "./brand/derive.ts";

const INK = "#141414", T2 = "#3D3A34", T3 = "#2A2723";
const wrap: CSSProperties = { maxWidth: 1280, margin: "0 auto", padding: "0 56px" };
const p15: CSSProperties = { margin: 0, font: "400 15px/1.5 var(--sans)", color: T2, textWrap: "pretty" };
const h2: CSSProperties = { margin: "0 0 36px", font: "400 36px/1.1 var(--serif)" };
const LIVE_MS = 48 * 3_600_000;

/** The header and footer of the public pages (Landing, and the Leaderboard when signed out). */
export function PublicHeader() {
  return (
    <>
      <header className="om-land-head" style={{ ...wrap, paddingTop: 22, paddingBottom: 22, display: "flex", alignItems: "center", gap: 36 }}>
        <Link to="/" style={{ font: "500 28px/1 var(--serif)", letterSpacing: "-0.01em", color: INK, textDecoration: "none" }}>doc2dpp</Link>
        <nav aria-label="Public" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 28, font: "500 15px/1 var(--sans)", flexWrap: "wrap" }}>
          <a href="/#how" style={{ color: INK, textDecoration: "none" }}>How it works</a>
          <Link to="/leaderboard" style={{ color: INK, textDecoration: "none" }}>Leaderboard</Link>
          <ConnectAgent variant="ghost" />
          <Link to="/sign-in" className="om-btn primary" style={{ height: 40, fontSize: 14, textDecoration: "none" }}>Open demo</Link>
        </nav>
      </header>
      <div style={{ borderTop: "1px solid var(--rule)" }} />
    </>
  );
}

export function Landing() {
  const { data: config } = usePoll(api.config, 60_000);
  const { data: templates } = usePoll(api.templates, 60_000);
  const { data: board } = usePoll(api.leaderboard, 30_000);
  const ours = config?.operators[0];
  const row = board?.find((r) => r.operator === ours?.operator) ?? board?.[0];
  const battery = templates?.find((t) => t.name === "battery");
  const terms = ours && <>Fee <span style={{ color: "var(--money)" }}>{usdc(ours.fee)} USDC</span> · Bond <span style={{ color: "var(--money)" }}>{usdc(ours.bond)} USDC</span></>;

  return (
    <div className="om-land" style={{ height: "100vh", overflow: "auto", background: "var(--paper)" }}>
      <PublicHeader />
      <section className="om-land-2" style={{ ...wrap, paddingTop: 72, paddingBottom: 80, display: "grid", gridTemplateColumns: "minmax(0,5fr) minmax(0,6fr)", gap: 64, alignItems: "center" }}>
        <div>
          <div style={{ display: "inline-flex", marginBottom: 22, border: `1px solid ${INK}`, padding: "7px 11px", font: "600 12px/1 var(--sans)", letterSpacing: ".07em", textTransform: "uppercase" }}>For battery and textile brands selling in the EU</div>
          <p style={{ margin: "0 0 26px", font: "500 19px/1.45 var(--sans)", maxWidth: 540, textWrap: "pretty" }}>
            From February 2027, every battery sold in the EU needs a Digital Product Passport. The data is buried in Supplier spec sheets and test reports, and today someone retypes it by hand.
          </p>
          <h1 style={{ margin: 0, font: "400 60px/1.03 var(--serif)", letterSpacing: "-0.02em", textWrap: "balance" }}>Supplier documents in. Passport data out. Money on every answer.</h1>
          <p style={{ margin: "28px 0 0", font: "400 20px/1.45 var(--sans)", color: T2, maxWidth: 520, textWrap: "pretty" }}>
            Every Document we deliver is backed by a USDC Bond. If a Field doesn't match the Document, you get paid.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 36, flexWrap: "wrap" }}>
            <Link to="/sign-in" className="om-btn primary lg" style={{ fontSize: 16, textDecoration: "none" }}>Upload a Document</Link>
            <span style={{ font: "500 14px/1.4 var(--mono)", color: T2 }}>{terms}</span>
          </div>
        </div>
        <Link to="/sign-in" title="Open the demo" aria-label="Open the demo: a sample Document and its Fields" className="om-land-card" style={{ display: "block", color: INK, textDecoration: "none" }}>
          <SampleCard bond={ours?.bond} />
        </Link>
      </section>

      <section id="how" style={{ borderTop: "1px solid var(--rule)", scrollMarginTop: 0 }}>
        <div style={{ ...wrap, paddingTop: 64, paddingBottom: 64 }}>
          <h2 style={h2}>How it works</h2>
          <div className="om-land-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 32 }}>
            <Step n="01" title="Upload" art={<UploadArt fields={battery?.fields.length} />}>
              Drop a Supplier Document and pick the Template: battery or textile.
            </Step>
            <Step n="02" title="Sieves converge" art={<SievesArt n={ours?.sieves.length ?? 5} />}>
              {ours ? `${ours.sieves.length} independent Sieves` : "Independent Sieves"} read it in different ways, on different models, until each Field converges or comes back Not stated.
            </Step>
            <Step n="03" title="Bond locks on Stellar" art={ours && (
              <span style={{ display: "inline-flex", flexDirection: "column", gap: 6, border: "1px solid var(--money)", padding: "10px 14px", color: "var(--money)" }}>
                <span style={{ font: "600 11px/1 var(--sans)", letterSpacing: ".06em", textTransform: "uppercase" }}>Bond</span>
                <span style={{ font: "600 22px/1 var(--mono)" }}>{usdc(ours.bond)} USDC</span>
                <span style={{ font: "500 12px/1 var(--mono)" }}>locked on Stellar</span>
              </span>
            )}>
              {ours ? `A ${usdc(ours.bond)} USDC Bond` : "A USDC Bond"} is locked against the delivered Fields, in public.
            </Step>
            <Step n="04" title="Challenge Window" art={<WindowArt />}>
              {windowCopy(config)}
            </Step>
          </div>
        </div>
      </section>

      <section style={{ borderTop: "1px solid var(--rule)", background: "var(--band)" }}>
        <div style={{ ...wrap, paddingTop: 64, paddingBottom: 64 }}>
          <h2 style={h2}>Why you can trust it</h2>
          <div className="om-land-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 40 }}>
            <Accuracy row={row} />
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {config?.operators.map((o) => (
                <div key={o.pipeline} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ width: 130, font: "600 14px/1.2 var(--sans)" }}>{o.label}{o.sieves.length > 1 ? " Pipeline" : ""}</span>
                  <span aria-hidden style={{ display: "flex", gap: 5, width: 130 }}>{o.sieves.map((_, i) => <span key={i} style={{ width: 22, height: 22, background: INK }} />)}</span>
                  <span style={{ font: "500 13px/1 var(--mono)" }}>{o.sieves.length} Sieve{o.sieves.length === 1 ? "" : "s"}</span>
                </div>
              ))}
              <p style={{ ...p15, fontSize: 16, color: T3 }}>Both run on the same Documents. The <Link to="/leaderboard" style={{ color: INK }}>Leaderboard</Link> shows which one pays for its mistakes.</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <span style={{ font: "400 30px/1.15 var(--serif)" }}>Every Bond and Slash is public on Stellar.</span>
              <span style={{ font: "500 13px/1 var(--mono)" }}><ProofLink href={row?.link} hash={tail(row?.link)} /></span>
            </div>
          </div>
        </div>
      </section>

      <section style={{ borderTop: `1px solid ${INK}`, borderBottom: `1px solid ${INK}` }}>
        <div style={{ ...wrap, paddingTop: 28, paddingBottom: 28, font: "400 26px/1.3 var(--serif)" }}>Built for the EU Battery Regulation (passports from Feb 2027) and textile ESPR.</div>
      </section>
      <footer style={{ ...wrap, paddingTop: 28, paddingBottom: 40, display: "flex", flexWrap: "wrap", gap: 28, font: "400 14px/1 var(--sans)", color: T2 }}>
        <span style={{ font: "500 18px/1 var(--serif)", color: INK }}>doc2dpp</span>
        <span>HackMeridian 2026</span>
        <Link to="/leaderboard" style={{ marginLeft: "auto", color: INK }}>Leaderboard</Link>
        <Link to="/sign-in" style={{ color: INK }}>Open demo</Link>
      </footer>
    </div>
  );
}

/** "For 48 h anyone can Challenge…", with the demo's shorter window when it runs one. */
export function windowCopy(c?: Pick<ApiConfig, "challengeWindowMs" | "demoWindow">) {
  const len = !c || c.demoWindow ? "48 h" : windowLength(c.challengeWindowMs);
  const demo = c?.demoWindow ? ` (${windowLength(c.challengeWindowMs)} in this demo)` : "";
  return `For ${len}${demo} anyone can Challenge a Field with the page that says otherwise. Then the Bond and the Fee settle automatically.`;
}

/** The ours row's accuracy on the hand-checked test set; without one, what it has delivered so far. */
function Accuracy({ row }: { row?: ApiLeaderRow }) {
  const big = { font: "500 72px/1 var(--mono)", letterSpacing: "-0.03em" } as const;
  const line = { ...p15, fontSize: 16, color: T3 };
  if (row?.accuracy)
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={big}>{((row.accuracy.correct / row.accuracy.fields) * 100).toFixed(1)} %</span>
        <p style={line}>Correct on {row.accuracy.correct} of {row.accuracy.fields} Fields across {row.documents} test Documents.</p>
      </div>
    );
  if (!row) return <div />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={big}>{row.fieldsDelivered}</span>
      <p style={line}>Fields delivered across {row.documents} Document{row.documents === 1 ? "" : "s"}, each Document backed by a Bond.</p>
    </div>
  );
}

function Step({ n, title, art, children }: { n: string; title: string; art: ReactNode; children: ReactNode }) {
  return (
    <div style={{ borderTop: `1px solid ${INK}`, paddingTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <span style={{ font: "500 13px/1 var(--mono)", color: T2 }}>{n}</span>
      <div style={{ height: 110, display: "flex", alignItems: "center" }}>{art}</div>
      <h3 style={{ margin: 0, font: "600 18px/1.25 var(--sans)" }}>{title}</h3>
      <p style={p15}>{children}</p>
    </div>
  );
}

const line = (w = "100%") => <div style={{ height: 2, background: "var(--grey)", width: w }} />;

function UploadArt({ fields }: { fields?: number }) {
  return (
    <div aria-hidden style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 64, height: 84, border: `1px solid ${INK}`, background: "var(--surface)", display: "flex", flexDirection: "column", gap: 6, padding: "10px 8px" }}>
        {line()}{line("70%")}{line()}{line("50%")}
      </div>
      <span style={{ font: "500 18px/1 var(--mono)" }}>→</span>
      <div style={{ font: "500 12px/1.4 var(--mono)", border: "1px solid var(--rule)", padding: "6px 8px" }}>Battery{fields !== undefined && <><br />{fields} Fields</>}</div>
    </div>
  );
}

function SievesArt({ n }: { n: number }) {
  const box = (done: boolean) => ({ width: 30, height: 30, border: `1px solid ${INK}`, display: "flex", alignItems: "center", justifyContent: "center", font: "600 13px/1 var(--mono)", background: done ? INK : "transparent", color: done ? "var(--paper)" : INK });
  return (
    <div aria-hidden style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} style={{ display: "contents" }}>
          {i > 0 && <span style={{ width: 8, height: 1, background: INK }} />}
          <span style={box(i < n - 1)}>{i < n - 1 ? "✓" : "·"}</span>
        </span>
      ))}
    </div>
  );
}

function WindowArt() {
  return (
    <div aria-hidden style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, width: "100%" }}>
      <span style={{ font: "500 24px/1 var(--mono)" }}>{clock(LIVE_MS - 2000)}</span>
      <div style={{ height: 2, background: "var(--rule)" }}><div style={{ height: 2, width: "92%", background: INK }} /></div>
      <span style={{ font: "500 12px/1 var(--mono)", color: T2 }}>then settles automatically</span>
    </div>
  );
}

/** Values from the Voltaris pack spec test Document (testdata/expected/battery-01-voltaris-pack-spec.json). */
const SAMPLE: [string, string, boolean?][] = [
  ["Battery mass", "482 kg · nominal"],
  ["Battery category", "EV"],
  ["Chemistry", "NMC811"],
  ["Carbon footprint", "41.8 kgCO2e/kWh"],
  ["Operator identifier", "—", true],
];
const PAGE: [string, string, string, boolean?][] = [
  ["Nominal mass", "482 kg", "—", true],
  ["Battery category", "Electric vehicle (EV)", "—"],
  ["Chemistry", "NMC 811", "graphite anode"],
  ["Carbon footprint", "41.8 kg CO2e/kWh", "service life"],
];

function SampleCard({ bond }: { bond?: string }) {
  const doc = { font: "400 10px/1.4 var(--doc)", color: "#222" } as const;
  return (
    <div style={{ border: `1px solid ${INK}`, background: "var(--surface)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 14px", borderBottom: "1px solid var(--rule)" }}>
        <span style={{ font: "500 12px/1 var(--mono)", color: T2 }}>Voltaris pack spec</span>
        {bond && (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline", gap: 6, border: "1px solid var(--money)", padding: "5px 9px", font: "500 12px/1 var(--mono)", color: "var(--money)" }}>
            Bond <b style={{ fontWeight: 600, fontSize: 14 }}>{usdc(bond)} USDC</b> · locked
          </span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,55fr) minmax(0,45fr)" }}>
        <div aria-hidden style={{ padding: 16, borderRight: "1px solid var(--rule)", background: "#EFEBE2" }}>
          <div style={{ background: "#FFFFFF", border: "1px solid var(--rule)", padding: "16px 16px 22px", ...doc }}>
            <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 10 }}>1 · General information</div>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: "2px 8px", borderTop: "1px solid #999", paddingTop: 6, fontWeight: 700 }}>
              <span>Parameter</span><span>Value</span><span>Note</span>
            </div>
            {PAGE.map(([a, b, c, hot]) => (
              <div key={a} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 8, padding: "5px 4px", margin: "3px -4px", ...(hot ? { outline: `2px solid ${INK}`, background: "var(--quote-bg)" } : { outline: "1px dashed var(--grey)" }) }}>
                <span>{a}</span><span>{b}</span><span>{c}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {SAMPLE.map(([name, value, ns], i) => (
            <div key={name} style={{ padding: "12px 14px", borderBottom: i < SAMPLE.length - 1 ? "1px solid var(--rule-row)" : 0, background: i === 0 ? "#F1ECDF" : "transparent" }}>
              <div style={{ font: "500 11px/1 var(--sans)", color: T2 }}>{name}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                <span style={{ font: "500 15px/1 var(--mono)", color: ns ? "var(--amber-ink)" : INK }}>{value}</span>
                {ns
                  ? <span style={{ font: "600 10px/1 var(--sans)", letterSpacing: ".05em", color: "var(--amber-ink)", border: "1px solid var(--amber-bd)", padding: "4px 6px", background: "var(--hatch)" }}>NOT STATED</span>
                  : <span style={{ font: "600 10px/1 var(--sans)", letterSpacing: ".05em" }}>✓ FINAL</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
