// Operator · Pipelines: each Pipeline's Sieves in order, what each reads, and the Worker that took its newest Job.
import { api, usePoll } from "../../api.ts";
import { workerName } from "../../components/ConnectAgent.tsx";
import { PageHeader } from "../../screens.tsx";
import { BondsCard, Loading } from "./common.tsx";
import { lastWorkers, sieveRead } from "./logic.ts";

const INK = "#141414";
const card = { border: `1px solid ${INK}`, background: "var(--surface)" } as const;

export function Pipelines() {
  const { data: config, error } = usePoll(api.config, 60_000);
  const { data: jobs } = usePoll(() => api.jobs(), 5000);
  const { data: workers } = usePoll(api.workers, 5000);
  const { data: board } = usePoll(api.leaderboard, 5000);
  const last = lastWorkers(jobs ?? []);
  const worker = (id?: string) => {
    const w = workers?.find((x) => x.name === id);
    return { name: w ? workerName(w) : id ?? "No Worker yet", live: !!w?.live };
  };
  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <PageHeader eyebrow="Operator" title="Pipelines" />
      {!config ? <Loading error={error} /> : (
        <div style={{ padding: "24px 40px 40px", display: "grid", gridTemplateColumns: "minmax(0,3fr) minmax(280px,2fr)", gap: 28, alignItems: "start" }}>
          {config.operators.map((o) => (
            <section key={o.pipeline} aria-label={o.label} style={card}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${INK}`, display: "flex", alignItems: "baseline", gap: 12 }}>
                <h2 style={{ margin: 0, font: "600 18px/1 var(--sans)" }}>{o.label}{o.sieves.length > 1 ? " Pipeline" : ""}</h2>
                <span style={{ font: "500 12.5px/1 var(--mono)", color: "#2A2723" }}>{o.sieves.length} Sieve{o.sieves.length === 1 ? "" : "s"}</span>
              </div>
              <ol style={{ listStyle: "none", margin: 0, padding: "18px 20px", display: "flex", flexDirection: "column" }}>
                {o.sieves.map((s, i) => {
                  const n = String(i + 1).padStart(2, "0"), r = sieveRead(s, o.sieves), w = worker(last.get(`${o.pipeline}/${s.label}`));
                  return (
                    <li key={i} aria-label={`${n} ${s.label}`} style={{ display: "flex", flexDirection: "column" }}>
                      {i > 0 && <span style={{ width: 1, height: 18, background: INK, marginLeft: 19 }} />}
                      <div style={{ display: "grid", gridTemplateColumns: "40px minmax(0,1fr) auto", gap: 14, alignItems: "center", border: `1px solid ${INK}`, padding: "12px 14px" }}>
                        <span style={{ font: "500 13px/1 var(--mono)" }}>{n}</span>
                        <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                          <span style={{ font: "600 15px/1.2 var(--sans)" }}>{s.label}</span>
                          <span style={{ font: "400 13px/1.35 var(--sans)", color: "#2A2723" }}>reads {r.view} · {r.note}</span>
                        </span>
                        <span title={w.live ? "Live" : "Not connected now"} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--rule)", padding: "5px 8px", font: "500 12.5px/1 var(--sans)", whiteSpace: "nowrap" }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: w.live ? "var(--live)" : "#B5AE9F" }} />{w.name}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <p style={{ margin: "0 20px 18px", paddingTop: 12, borderTop: "1px solid var(--rule)", font: "400 13.5px/1.5 var(--sans)", color: "#2A2723" }}>
                {o.sieves.some((s) => s.kind === "tiebreak")
                  ? "★ High-stake Fields need Original and Markdown extraction to agree, never a majority. When they differ the Field is Not stated; Tie-break never makes them Final."
                  : o.sieves.length === 1 ? "No cross-check and no Tie-break. Run next to ours to show what the extra Sieves buy." : null}
              </p>
              {(() => { const row = board?.find((r) => r.operator === o.operator); return row && <div style={{ margin: "0 20px 18px", paddingTop: 12, borderTop: "1px solid var(--rule)" }}><BondsCard row={row} /></div>; })()}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
