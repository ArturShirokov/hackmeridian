// 02b · Documents: the Brand's landing. Every uploaded Document, newest first, with filters, search and a totals strip.
import { useEffect, useState, type CSSProperties } from "react";
import { api, usePoll, type ApiDocumentSummary } from "../../api.ts";
import { Link } from "../../router.tsx";
import { Button } from "../../components/ui.tsx";
import { clock } from "../../format.ts";
import { PageHeader, useServerClock } from "../../screens.tsx";
import { Loading, templateLabel } from "./common.tsx";
import { docRow, filterDocs, listTotals, type ListFilter, type ListStatus } from "./derive.ts";

const th = { font: "600 11px/1.2 var(--sans)", letterSpacing: ".07em", textTransform: "uppercase", color: "#2A2723" } as const;
const cols = "minmax(0,2fr) minmax(0,1.1fr) 104px minmax(0,1.3fr) 104px 112px 76px 92px 60px";
const STATUSES: ListStatus[] = ["Processing", "Delivered", "Settled"];
const PILL: Record<ListStatus, CSSProperties> = {
  Processing: { border: "1px dotted #3D3A34", color: "#3D3A34" },
  Delivered: { border: "1px solid var(--ink)", color: "var(--ink)" },
  Settled: { border: "1px solid var(--settled-ink)", color: "var(--settled-ink)", background: "var(--settled-bg)" },
};
const BOND = { locked: ["Locked", "var(--money)"], released: ["Released", "#5E594F"], slashed: ["Slashed", "var(--red)"] } as const;

export function BrandDocuments() {
  const { data, error } = usePoll(api.documents, 5000);
  const { config, offset } = useServerClock();
  const labels = Object.fromEntries((config?.operators ?? []).map((o) => [o.pipeline, o.label]));
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <PageHeader eyebrow={config?.brand.name ?? "Brand"} title="Documents" pad="36px 40px 20px" right={<Link to="/upload"><Button>Upload a Document</Button></Link>} />
      {!data ? <Loading error={error} /> : <DocumentsView docs={data} labels={labels} now={Date.now() + offset} />}
    </div>
  );
}

export function DocumentsView({ docs, labels, now }: { docs: ApiDocumentSummary[]; labels: Record<string, string>; now: number }) {
  const [f, setF] = useState<ListFilter>({});
  if (!docs.length)
    return (
      <div style={{ padding: "56px 40px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 18 }}>
        <p style={{ margin: 0, font: "400 26px/1.3 var(--serif)" }}>Upload your first Supplier Document.</p>
        <Link to="/upload"><Button>Upload a Document</Button></Link>
      </div>
    );
  const t = listTotals(docs, now);
  const shown = filterDocs(docs, f);
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();
  const set = (k: keyof ListFilter) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value || undefined });
  return (
    <div style={{ padding: "24px 40px 48px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", border: "1px solid var(--ink)", background: "var(--surface)" }}>
        {([["Documents this month", String(t.thisMonth)], ["Fields delivered", String(t.fieldsDelivered)], ["Open Supplier Requests", String(t.supplierRequests)], ["USDC received from Slashes", t.received]] as const).map(([label, v], i) => (
          <div key={label} style={{ padding: "14px 18px", borderLeft: i ? "1px solid var(--rule)" : 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={th}>{label}</span>
            <span aria-label={label} style={{ font: "600 24px/1 var(--mono)", color: i === 3 ? "var(--money)" : "var(--ink)" }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input aria-label="Search" placeholder="Search name or Supplier" value={f.q ?? ""} onChange={set("q")} style={{ ...control, width: 260 }} />
        <Select label="Template" value={f.template} onChange={set("template")} options={uniq(docs.map((d) => d.template)).map((x) => [x, templateLabel(x)])} />
        <Select label="Supplier" value={f.supplier} onChange={set("supplier")} options={uniq(docs.map((d) => d.supplier)).map((x) => [x, x])} />
        <Select label="Status" value={f.status} onChange={set("status")} options={STATUSES.map((x) => [x, x])} />
        <span style={{ marginLeft: "auto", font: "500 13px/1 var(--mono)", color: "#5E594F" }}>{shown.length} of {docs.length}</span>
      </div>
      <div style={{ border: "1px solid var(--ink)", background: "var(--surface)" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "12px 20px", borderBottom: "1px solid var(--ink)", ...th }}>
          <span>Document</span><span>Supplier</span><span>Template</span><span>Operators</span><span>Status</span>
          <span title="Final · Not stated · Challenged">Fields</span><span>Bond</span><span>Window left</span><span>Uploaded</span>
        </div>
        {!shown.length && <div style={{ padding: "18px 20px", font: "400 15px/1.4 var(--sans)", color: "#2A2723" }}>No Documents match these filters.</div>}
        {shown.map((d) => <Row key={d.id} d={d} labels={labels} now={now} />)}
      </div>
    </div>
  );
}

const control: CSSProperties = { height: 36, border: "1px solid var(--ink)", background: "var(--surface)", padding: "0 10px", font: "400 14px/1 var(--sans)", color: "var(--ink)" };

function Select({ label, value, onChange, options }: { label: string; value?: string; onChange(e: { target: { value: string } }): void; options: [string, string][] }) {
  return (
    <select aria-label={label} value={value ?? ""} onChange={onChange} style={control}>
      <option value="">{label}: all</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function Row({ d, labels, now }: { d: ApiDocumentSummary; labels: Record<string, string>; now: number }) {
  const r = docRow(d);
  const dash = <span style={{ font: "500 14px/1 var(--mono)", color: "#5E594F" }}>—</span>;
  const n = (v: number, color: string, title: string) => <span title={title} style={{ color: v ? color : "#B5AE9F" }}>{v}</span>;
  return (
    <Link to={r.href} style={{ display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "center", padding: "10px 20px", minHeight: 52, borderBottom: "1px solid var(--rule-row)", color: "var(--ink)", textDecoration: "none" }}>
      <span style={{ font: "500 14.5px/1.25 var(--sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
      <span style={{ font: "400 14px/1.25 var(--sans)" }}>{d.supplier || "—"}</span>
      <span style={{ font: "400 14px/1.25 var(--sans)" }}>{templateLabel(d.template)}</span>
      <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {Object.keys(d.pipelines).map((p) => (
          <span key={p} style={{ border: "1px solid var(--rule)", background: "var(--paper)", padding: "3px 6px", font: "500 11.5px/1 var(--sans)", whiteSpace: "nowrap" }}>{labels[p] ?? p}</span>
        ))}
      </span>
      <span style={{ ...PILL[r.status], justifySelf: "start", padding: "4px 7px", font: "600 10.5px/1 var(--sans)", letterSpacing: ".05em", textTransform: "uppercase" }}>{r.status}</span>
      <span style={{ display: "flex", gap: 10, font: "600 13px/1 var(--mono)" }}>
        {n(r.counts.final, "var(--ink)", "Final")}{n(r.counts.notStated, "var(--amber-ink)", "Not stated")}{n(r.counts.challenged, "var(--red)", "Challenged")}
      </span>
      {r.bond ? <span style={{ font: "600 12.5px/1 var(--mono)", color: BOND[r.bond][1] }}>{BOND[r.bond][0]}</span> : dash}
      <span>{r.closesAt && r.status === "Delivered" ? (
        <span style={{ font: "500 13.5px/1 var(--mono)" }} title={r.paused === "until opened" ? "Starts when you open the Document" : r.paused ? "Paused while a Challenge is open" : undefined}>
          {clock(r.paused ? r.msLeft! : r.closesAt - now)}{r.paused && <span style={{ font: "500 11px/1 var(--sans)", color: "#5E594F" }}> {r.paused === "until opened" ? "not started" : "paused"}</span>}
        </span>
      ) : dash}</span>
      <span style={{ font: "500 12.5px/1 var(--mono)", color: "#3D3A34" }}>{new Date(d.uploadedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
    </Link>
  );
}
