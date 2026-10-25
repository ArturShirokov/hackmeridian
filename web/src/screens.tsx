// Screen stubs: each renders the shared components on live (or fixture) data. Tickets 3 and 4 build them out.
import { useMemo, useState, type ReactNode } from "react";
import { api, usePoll, type ApiField } from "./api.ts";
import { Link } from "./router.tsx";
import { usdc } from "./format.ts";
import { FieldRow, badgeFor } from "./components/FieldRow.tsx";
import { SieveTrack } from "./components/SieveTrack.tsx";
import { DocumentViewer, type ViewerBox } from "./components/DocumentViewer.tsx";
import { Button, Countdown, MoneyChip, ProofLink, SectionLabel, SidePanel, Spinner, StatusBadge, WorkerChip } from "./components/ui.tsx";

export function PageHeader({ eyebrow, title, pad = "28px 40px 20px", right }: { eyebrow: string; title: string; pad?: string; right?: ReactNode }) {
  return (
    <div style={{ padding: pad, borderBottom: "1px solid var(--rule)", display: "flex", alignItems: "flex-end", gap: 20 }}>
      <div>
        <div style={{ font: "600 12px/1 var(--sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "#2A2723" }}>{eyebrow}</div>
        <h1 style={{ margin: "8px 0 0", font: "600 30px/1.1 var(--sans)", letterSpacing: "-0.01em" }}>{title}</h1>
      </div>
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}

function Loading({ error }: { error?: Error }) {
  return (
    <div style={{ padding: "28px 40px", display: "flex", alignItems: "center", gap: 12, font: "500 15px/1 var(--sans)", color: error ? "#A3221B" : "var(--ink)" }}>
      {error ? error.message : <><Spinner />Loading…</>}
    </div>
  );
}

/** config.now − Date.now(), taken when the config arrives. */
export function useServerClock() {
  const { data } = usePoll(api.config, 60_000);
  const offset = useMemo(() => (data ? data.now - Date.now() : 0), [data]);
  return { config: data, offset };
}

const scroll = { flex: 1, overflow: "auto" } as const;
const th = { font: "600 11px/1 var(--sans)", letterSpacing: ".07em", textTransform: "uppercase", color: "#2A2723" } as const;

export function DocumentsList() {
  const { data, error } = usePoll(api.documents, 5000);
  const { config, offset } = useServerClock();
  const cols = "minmax(0,2fr) minmax(0,1.2fr) 110px minmax(0,1.6fr) 120px";
  return (
    <div style={scroll}>
      <PageHeader eyebrow="Voltaris" title="Documents" right={<Link to="/upload"><Button>Upload a Document</Button></Link>} />
      {!data ? <Loading error={error} /> : (
        <div style={{ padding: "24px 40px 40px" }}>
          <div style={{ border: "1px solid var(--ink)", background: "var(--surface)" }}>
            <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "12px 20px", borderBottom: "1px solid var(--ink)", ...th }}>
              <span>Document</span><span>Supplier</span><span>Template</span><span>Status</span><span>Window left</span>
            </div>
            {data.length === 0 && <div style={{ padding: "18px 20px", font: "400 15px/1.4 var(--sans)", color: "#2A2723" }}>No Documents yet. Upload a Supplier Document to start.</div>}
            {data.map((d) => {
              const ps = Object.entries(d.pipelines);
              const processing = ps.some(([, p]) => p.status === "processing");
              const closesAt = ps.map(([, p]) => p.closesAt).find((c) => c);
              return (
                <Link key={d.id} to={processing ? `/documents/${d.id}/pipeline` : `/documents/${d.id}`}
                  style={{ display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "center", padding: "0 20px", minHeight: 52, borderBottom: "1px solid var(--rule-row)", color: "var(--ink)", textDecoration: "none" }}>
                  <span style={{ font: "500 14.5px/1.25 var(--sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                  <span style={{ font: "400 14px/1.25 var(--sans)" }}>{d.supplier}</span>
                  <span style={{ font: "400 14px/1.25 var(--sans)", textTransform: "capitalize" }}>{d.template}</span>
                  <span style={{ font: "500 12.5px/1.4 var(--mono)", color: "#2A2723" }}>
                    {ps.map(([name, p]) => `${config?.operators.find((o) => o.pipeline === name)?.label ?? name} ${p.status}`).join(" · ")}
                  </span>
                  <span>{closesAt && config ? <Countdown bare closesAt={closesAt} windowMs={config.challengeWindowMs} serverOffsetMs={offset} settled={ps.every(([, p]) => p.status === "settled")} /> : "—"}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function Upload() {
  return (
    <div style={scroll}>
      <PageHeader eyebrow="Upload" title="New Supplier Document" pad="36px 48px 20px" />
      <div style={{ padding: "32px 48px", font: "400 15px/1.5 var(--sans)", color: "#2A2723" }}>Drop zone, Templates, Supplier and Summary come in ticket 3.</div>
    </div>
  );
}

function useDocument(id: string) {
  return usePoll(() => api.document(id), 1000, [id]);
}

export function Pipeline({ id }: { id: string }) {
  const { data: d, error } = useDocument(id);
  if (!d) return <Loading error={error} />;
  const ours = d.views[0]!;
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "18px 32px", borderBottom: "1px solid var(--rule)" }}>
        <div style={{ font: "600 22px/1.2 var(--sans)" }}>{d.name}</div>
        <div style={{ marginTop: 5, font: "400 14px/1.3 var(--sans)", color: "#3D3A34" }}>{d.supplier} · {d.template} passport · {ours.fields.length} Fields · {d.pages} pages</div>
      </div>
      <div style={{ padding: "18px 32px 20px", borderBottom: "1px solid var(--rule)", background: "var(--band)", display: "flex", flexDirection: "column", gap: 16 }}>
        {d.views.map((v) => <SieveTrack key={v.pipeline} label={v.label} sub={`${v.stations.length} Sieve${v.stations.length === 1 ? "" : "s"}`} stations={v.stations} />)}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {ours.fields.map((f) => (
          <FieldRow key={f.name} dense field={f} selected={false} expanded={false} tieBreak={f.tieBreak} canChallenge={false} onSelect={() => {}} onToggle={() => {}} onChallenge={() => {}} />
        ))}
      </div>
    </div>
  );
}

/** Viewer boxes for one Pipeline's Fields; `selected` gets the solid box and its label as the tag. */
export function boxesFor(fields: ApiField[], selected?: string): ViewerBox[] {
  return fields.flatMap((f): ViewerBox[] => {
    const tag = f.name === selected ? f.label : undefined;
    if ("evidence" in f) {
      const challenged = badgeFor(f) === "challenged";
      const kind = tag ? "selected" : challenged ? "challenged" : "quoted";
      return [{ id: f.name, page: f.evidence.page, rects: f.evidence.rects, kind, tag: tag ?? (challenged ? "Challenged" : undefined), title: f.label }];
    }
    if ("quotes" in f) return f.quotes.map((q, i) => ({ id: f.name, page: q.page, rects: q.rects, kind: "notStated" as const, tag: i === 0 ? tag : undefined, title: f.label }));
    return [];
  });
}

export function Review({ id }: { id: string }) {
  const { data: d, error } = useDocument(id);
  const { config, offset } = useServerClock();
  const [pipeline, setPipeline] = useState<string>();
  const [sel, setSel] = useState<string>();
  const [exp, setExp] = useState<string>();
  const [page, setPage] = useState(1);
  const [panel, setPanel] = useState<{ field: string; pick?: { page: number; quote: string } }>();
  if (!d) return <Loading error={error} />;
  const view = d.views.find((v) => v.pipeline === pipeline) ?? d.views[0]!;
  const select = (name: string) => {
    setSel(name);
    const f = view.fields.find((x) => x.name === name);
    const p = f && ("evidence" in f ? f.evidence.page : "quotes" in f ? f.quotes[0]?.page : undefined);
    if (p) setPage(p);
  };
  const e = view.escrow;
  const settled = e?.status === "settled";
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
      <div style={{ flex: "none", padding: "12px 24px", borderBottom: "1px solid var(--ink)", display: "flex", alignItems: "center", gap: 20, background: "var(--surface)" }}>
        <div style={{ minWidth: 0, flex: "0 1 260px" }}>
          <div style={{ font: "600 15px/1.25 var(--sans)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</div>
          <div style={{ marginTop: 3, font: "400 13px/1.2 var(--sans)", color: "#3D3A34" }}>{d.supplier} · {d.template} passport</div>
        </div>
        {e && (
          <>
            <MoneyChip tone="bond" label={`Bond · ${view.label}`} amount={e.bondLeft} state={settled ? "released" : e.upheld ? "slashed" : "locked"}
              split={e.upheld ? `${usdc(String(Number(e.bond) - Number(e.bondLeft)))} USDC slashed to ${config?.brand.name ?? "the Brand"}` : undefined} />
            <MoneyChip tone="fee" label="Fee" amount={e.fee} state={settled ? "paid" : "held"} />
            {config && <Countdown closesAt={e.closesAt} windowMs={config.challengeWindowMs} serverOffsetMs={offset} settled={settled} />}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <SectionLabel size={10.5}>Output hash</SectionLabel>
              <span style={{ font: "500 13px/1 var(--mono)" }}>sha256 {e.outputHash.slice(0, 4)}…{e.outputHash.slice(-4)}</span>
              <ProofLink href={e.link} hash={e.outputHash} />
            </div>
          </>
        )}
        <a href={api.exportUrl(d.id, view.pipeline)} style={{ marginLeft: "auto" }}><Button>Export to passport</Button></a>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0,55fr) minmax(0,45fr)" }}>
        <div style={{ minHeight: 0, display: "flex", borderRight: "1px solid var(--ink)" }}>
          <DocumentViewer pdfUrl={d.fileUrl} page={page} onPage={setPage} onBoxClick={select}
            boxes={boxesFor(view.fields, sel)}
            caption={sel ? `Highlighted: ${view.fields.find((f) => f.name === sel)?.label}` : undefined}
            pick={panel && !panel.pick ? { onPick: (p) => setPanel({ ...panel, pick: p }) } : undefined} />
        </div>
        <div style={{ minHeight: 0, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
          <div role="tablist" style={{ flex: "none", display: "flex", borderBottom: "1px solid var(--ink)", padding: "0 20px", gap: 4 }}>
            {d.views.map((v) => (
              <button key={v.pipeline} role="tab" aria-selected={v === view} onClick={() => { setPipeline(v.pipeline); setPanel(undefined); }}
                style={{ height: 50, padding: "0 14px", background: "transparent", border: 0, borderBottom: `3px solid ${v === view ? "var(--ink)" : "transparent"}`, marginBottom: -1, font: `${v === view ? 600 : 500} 15px/1 var(--sans)`, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                {v.label}<span style={{ font: "500 12px/1 var(--mono)", color: "#3D3A34" }}>{v.stations.length} Sieve{v.stations.length === 1 ? "" : "s"}</span>
              </button>
            ))}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {view.fields.map((f) => (
              <FieldRow key={f.name} field={f} selected={sel === f.name} expanded={exp === f.name} tieBreak={f.tieBreak}
                canChallenge={!settled && !!e && !f.challenge && f.status === "final" && !("withheld" in f)}
                onSelect={() => { select(f.name); setExp(f.name); }} onToggle={() => setExp(exp === f.name ? undefined : f.name)}
                onChallenge={() => { select(f.name); setPanel({ field: f.name }); }} />
            ))}
          </div>
          <SidePanel open={!!panel} onClose={() => setPanel(undefined)} title="Challenge a Field">
            <div style={{ padding: "20px 22px", font: "400 15px/1.5 var(--sans)" }}>
              {panel?.pick ? <>Picked p. {panel.pick.page}: “{panel.pick.quote}”</> : "Click the line on the Document that states the value."} The form comes in ticket 3.
              {config && (
                <p style={{ margin: "14px 0 0", font: "400 14px/1.45 var(--sans)" }}>
                  Filing locks a Challenge Deposit of <b style={{ fontFamily: "var(--mono)" }}>{usdc(config.challengeDeposit)} USDC</b>.
                  It comes back if the Arbiter upholds the Challenge, and pays the Arbiter if it is rejected.
                </p>
              )}
            </div>
          </SidePanel>
        </div>
      </div>
    </div>
  );
}

export function Arbiter() {
  const { data, error } = usePoll(api.arbiter, 5000);
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <PageHeader eyebrow="Arbiter desk" title="Challenges" pad="20px 28px" />
      {!data ? <Loading error={error} /> : data.open.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center" }}>
          <span style={{ font: "400 34px/1.2 var(--serif)" }}>No open Challenges.</span>
          <span style={{ font: "400 17px/1.4 var(--sans)", color: "#2A2723" }}>Bonds are settling automatically.</span>
        </div>
      ) : data.open.map((c) => (
        <div key={c.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1.2fr) minmax(0,1.1fr) 130px", gap: 14, alignItems: "center", padding: "0 28px", height: 46, borderBottom: "1px solid var(--rule-row)" }}>
          <span style={{ font: "500 14px/1.2 var(--sans)" }}>{c.documentName} <span style={{ color: "#2A2723", fontWeight: 400 }}>· {c.brand}</span></span>
          <span style={{ font: "500 14px/1.2 var(--sans)" }}>{c.fieldLabel}</span>
          <span style={{ font: "400 14px/1.2 var(--sans)" }}>{c.operatorLabel}</span>
          <StatusBadge status="challenged" />
        </div>
      ))}
    </div>
  );
}

export function Leaderboard() {
  const { data, error } = usePoll(api.leaderboard, 5000);
  return (
    <div style={scroll}>
      <PageHeader eyebrow="Public" title="Leaderboard" />
      {!data ? <Loading error={error} /> : (
        <div style={{ padding: "24px 40px 40px" }}>
          {data.map((r) => (
            <div key={r.operator} style={{ display: "grid", gridTemplateColumns: "minmax(200px,1.6fr) repeat(4,minmax(0,1fr))", gap: 12, alignItems: "center", padding: "18px 20px", borderBottom: "1px solid var(--rule-row)" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ font: "600 18px/1.2 var(--sans)" }}>{r.label}</span>
                <span style={{ font: "500 12px/1 var(--mono)", color: "#2A2723" }}>{r.sieves} Sieve{r.sieves === 1 ? "" : "s"}</span>
              </span>
              <span style={{ font: "500 24px/1 var(--mono)" }}>{r.documents}</span>
              <span style={{ font: "500 24px/1 var(--mono)", color: r.challengesUpheld ? "#A3221B" : "var(--ink)" }}>{r.challengesUpheld}</span>
              <span style={{ font: "500 24px/1 var(--mono)", color: "var(--money)" }}>{usdc(r.totalSlashed)}</span>
              <ProofLink href={r.link} hash={r.operator} label="Account" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Jobs() {
  const { data: workers } = usePoll(api.workers, 1000);
  const { data: jobs, error } = usePoll(() => api.jobs(), 1000);
  return (
    <div style={scroll}>
      <PageHeader eyebrow="Operator" title="Job Board" />
      <div style={{ padding: "24px 40px 40px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {workers?.map((w) => <WorkerChip key={w.name} name={w.name} live={w.live} running={!!w.current} job={w.current && `${w.current.sieve} · ${w.current.documentName}`} />)}
        </div>
        {!jobs ? <Loading error={error} /> : jobs.map((j) => (
          <div key={j.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1.2fr) minmax(0,0.9fr) 150px", gap: 12, alignItems: "center", minHeight: 44, borderBottom: "1px solid var(--rule-row)", background: j.status === "timed out" ? "var(--timeout-row)" : "transparent" }}>
            <span style={{ font: "400 14px/1.25 var(--sans)" }}>{j.documentName}</span>
            <span style={{ font: "500 14px/1.25 var(--sans)" }}>{j.sieve}</span>
            <span style={{ font: "400 14px/1.25 var(--sans)" }}>{j.worker ?? "—"}</span>
            <span style={{ font: "600 11px/1 var(--sans)", letterSpacing: ".05em", textTransform: "uppercase" }}>{j.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NotFound() {
  return <div style={scroll}><PageHeader eyebrow="Origyn" title="Page not found" /></div>;
}
