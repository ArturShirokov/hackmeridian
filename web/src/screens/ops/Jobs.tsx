// 08 · Job Board (Operator): connected Workers, the Jobs list (a timed-out take is its own red row), the Pipelines panel
// and "Connect a Worker" with the real MCP URL from /api/config.
import { useEffect, useState } from "react";
import { api, usePoll, type ApiConfig } from "../../api.ts";
import { useLocation } from "../../router.tsx";
import { useServerClock } from "../../screens.tsx";
import { Loading, th, useNow } from "./common.tsx";
import { jobView } from "./logic.ts";

const INK = "#141414", RED = "#A3221B";
const cols = "minmax(0,1.7fr) minmax(0,1.2fr) minmax(0,0.9fr) 150px 70px";
const TONE = {
  done: { bd: INK, fg: INK, bs: "solid", bg: "transparent", row: "transparent" },
  taken: { bd: "#0B4A57", fg: "#0B4A57", bs: "solid", bg: "transparent", row: "transparent" },
  open: { bd: "#8E877A", fg: "#2A2723", bs: "dashed", bg: "transparent", row: "transparent" },
  timeout: { bd: RED, fg: RED, bs: "solid", bg: "#FFFDF9", row: "#FBEDEA" },
};
const card = { border: `1px solid ${INK}`, background: "var(--surface)" } as const;

export const connectCommand = (baseUrl: string) => `claude mcp add --transport http origyn-jobs ${baseUrl.replace(/\/$/, "")}/mcp`;

export function Jobs() {
  const { data: workers } = usePoll(api.workers, 1000);
  const { data: jobs, error } = usePoll(() => api.jobs(), 1000);
  const { config, offset } = useServerClock();
  const now = useNow(offset);
  const url = useLocation();
  useEffect(() => {
    if (url.hash === "#pipelines") document.getElementById("pipelines")?.scrollIntoView({ behavior: "smooth" });
  }, [url.hash, !!config]);
  const live = workers?.filter((w) => w.live) ?? [];

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{ padding: "28px 40px 20px", borderBottom: "1px solid var(--rule)", display: "flex", alignItems: "flex-end", gap: 20 }}>
        <div>
          <div style={{ font: "600 12px/1 var(--sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "#2A2723" }}>Operator</div>
          <h1 style={{ margin: "8px 0 0", font: "600 30px/1.1 var(--sans)" }}>Job Board</h1>
        </div>
        {config && <span style={{ marginLeft: "auto", font: "500 13px/1 var(--mono)", color: "#2A2723" }}>board {config.baseUrl.replace(/\/$/, "")}/mcp</span>}
      </div>
      <div style={{ padding: "24px 40px 40px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div>
          <div style={{ font: "600 15px/1 var(--sans)", marginBottom: 12 }}>Connected Workers · {live.length}</div>
          {workers && live.length === 0 && (
            <div style={{ border: "1.5px dashed #8E877A", padding: 20, font: "400 15px/1.45 var(--sans)", color: "#2A2723" }}>
              No Workers connected. Jobs wait on the Job Board until a Worker connects and takes them.
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 16 }}>
            {live.map((w) => (
              <div key={w.name} style={{ ...card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="om-motion" style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--live)", animation: "om-pulse 1.4s ease-in-out infinite" }} />
                  <span style={{ font: "600 18px/1 var(--sans)" }}>{w.name}</span>
                  <span style={{ marginLeft: "auto", font: "500 12px/1 var(--mono)", color: "#2A2723" }}>live</span>
                </div>
                <div style={{ font: "500 13px/1.4 var(--mono)" }}>{w.current ? `${w.current.sieve} · ${w.current.documentName}` : "idle · waiting for a Job"}</div>
                <div style={{ font: "400 13px/1 var(--sans)", color: "#2A2723" }}>
                  <span style={{ font: "600 15px/1 var(--mono)", color: INK }}>{w.doneToday}</span> Job{w.doneToday === 1 ? "" : "s"} done today
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(300px,1fr)", gap: 28, alignItems: "start" }}>
          <div style={card}>
            <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "11px 18px", borderBottom: `1px solid ${INK}`, ...th }}>
              <span>Document</span><span>Sieve</span><span>Worker</span><span>Status</span><span>Duration</span>
            </div>
            {!jobs ? <Loading error={error} pad="18px" /> : jobs.length === 0 ? (
              <div style={{ padding: 18, font: "400 15px/1.4 var(--sans)", color: "#2A2723" }}>No Jobs yet. Uploading a Document posts its first Jobs here.</div>
            ) : jobs.map((j) => {
              const v = jobView(j, now), t = TONE[v.tone];
              return (
                <div key={j.id} data-status={j.status} style={{ display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "center", padding: "0 18px", minHeight: 44, borderBottom: "1px solid var(--rule-row)", background: t.row }}>
                  <span style={{ font: "400 14px/1.25 var(--sans)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.documentName}</span>
                  <span style={{ font: "500 14px/1.25 var(--sans)" }}>{j.sieve}</span>
                  <span style={{ font: "400 14px/1.25 var(--sans)" }}>{j.worker ?? "—"}</span>
                  <span style={{ justifySelf: "start", border: `1.5px ${t.bs} ${t.bd}`, color: t.fg, background: t.bg, padding: "4px 7px", font: "600 11px/1 var(--sans)", letterSpacing: ".05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{v.label}</span>
                  <span style={{ font: "500 13px/1 var(--mono)" }}>{v.duration}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {config && <Pipelines operators={config.operators} />}
            {config && <Connect cmd={connectCommand(config.baseUrl)} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Pipelines({ operators }: { operators: ApiConfig["operators"] }) {
  const sieve = { border: `1px solid ${INK}`, padding: "7px 9px", font: "500 12.5px/1.2 var(--sans)", display: "flex", gap: 6 } as const;
  return (
    <div id="pipelines" style={{ ...card, padding: "16px 18px", scrollMarginTop: 24 }}>
      <div style={{ font: "600 15px/1 var(--sans)", marginBottom: 16 }}>Pipelines</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${operators.length},minmax(0,1fr))`, gap: 18 }}>
        {operators.map((o) => (
          <div key={o.pipeline} style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ font: "600 13px/1.2 var(--sans)", marginBottom: 10 }}>{o.label}</span>
            {o.sieves.map((s, k) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                {k > 0 && <span style={{ width: 1, height: 12, background: INK, marginLeft: 14 }} />}
                <span style={sieve}><span style={{ font: "500 11px/1.2 var(--mono)", color: "#2A2723" }}>{String(k + 1).padStart(2, "0")}</span>{s.label}</span>
              </div>
            ))}
            {o.sieves.length === 1 && <span style={{ marginTop: 10, font: "400 12.5px/1.4 var(--sans)", color: "#2A2723" }}>No cross-check, no tie-break.</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Connect({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(cmd).then(() => setCopied(true), () => setCopied(false));
  return (
    <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ font: "600 15px/1 var(--sans)" }}>Connect a Worker</span>
      <span style={{ font: "400 13.5px/1.45 var(--sans)", color: "#2A2723" }}>Add the Job Board as an MCP server in any harness. The Worker takes open Jobs and returns results.</span>
      <pre style={{ margin: 0, padding: 12, background: INK, color: "var(--paper)", font: "400 12.5px/1.55 var(--mono)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{cmd}</pre>
      <button onClick={copy} className="om-btn ghost sm" style={{ alignSelf: "flex-start", fontWeight: 600 }}>{copied ? "Copied" : "Copy command"}</button>
    </div>
  );
}
