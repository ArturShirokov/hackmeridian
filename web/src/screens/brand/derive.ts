// What the Brand screens derive from the API: Pipeline status, counters, row order, Compare, Challenge values.
import type { ApiDocument, ApiDocumentSummary, ApiEscrow, ApiField, ApiPipelineView } from "../../api.ts";
import { usdc } from "../../format.ts";
import type { BadgeStatus } from "../../components/ui.tsx";
import type { ViewerBox } from "../../components/DocumentViewer.tsx";

export interface PipelineState {
  delivered: boolean;
  word: "Processing" | "Waiting for a Worker" | "Delivered";
  banner?: { kind: "waiting" | "rerun"; text: string };
}

/** Delivered once every Pipeline has delivered (values are withheld until then). */
export function pipelineState(d: ApiDocument): PipelineState {
  if (d.views.every((v) => v.escrow)) return { delivered: true, word: "Delivered" };
  const stations = d.views.flatMap((v) => v.stations);
  const rerun = stations.some((s) => s.state === "fail" || (s.attempt > 1 && s.state !== "done"));
  const running = stations.some((s) => s.state === "run");
  const word = running ? "Processing" : "Waiting for a Worker";
  if (rerun) return { delivered: false, word, banner: { kind: "rerun", text: "The faithfulness check failed, so the Markdown is being redone once." } };
  if (!running) return { delivered: false, word, banner: { kind: "waiting", text: "Job on the Job Board, waiting for a Worker." } };
  return { delivered: false, word };
}

/** The live Pipeline's rows: a Field is Queued until the Pipeline's first extraction is in. */
export function pipelineRows(v: ApiPipelineView) {
  const started = v.stations.some((s) => s.kind === "extract" && s.state === "done");
  const rows = v.fields.map((field) => ({
    field,
    badge: (field.status === "converging" && !started ? "queued" : field.status) as BadgeStatus,
  }));
  const n = (b: BadgeStatus) => rows.filter((r) => r.badge === b).length;
  return { rows, counts: { final: n("final"), converging: n("converging"), notStated: n("not stated") } };
}

/** "220 Ah · rated", "95 % cotton · 5 % elastane"; never a value while converging or withheld. */
export function shown(f: ApiField): string {
  if (!("value" in f)) return "withheld" in f || f.status === "converging" ? "· · ·" : "Not stated";
  if (typeof f.value === "object") return Object.entries(f.value).map(([k, n]) => `${n} ${f.unit ?? "%"} ${k}`).join(" · ");
  return `${f.value}${f.unit ? ` ${f.unit}` : ""}${f.qualifier ? ` · ${f.qualifier}` : ""}`;
}

/** FieldRow shows `display`; give it shown() so rows read "220 Ah · rated" like the prototype. */
export const withShown = (f: ApiField): ApiField => ("display" in f ? { ...f, display: shown(f) } : f);

/** The Compare tab: every Pipeline side by side, ours, the Baseline's and any outside Operator's; `diff` is the server's canonical comparison. */
export function compare(d: ApiDocument) {
  const rows = d.views[0]!.fields.map((f, i) => ({ name: f.name, label: f.label, values: d.views.map((v) => shown(v.fields[i]!)), diff: d.differs.includes(f.name) }));
  const n = rows.filter((r) => r.diff).length;
  return { rows, summary: `${n} difference${n === 1 ? "" : "s"} in ${rows.length} Fields. Click a row to see its quote.` };
}

/**
 * Review: Not stated Fields on top, the Supplier's (one Supplier Request) before the Brand's ("Brand to provide");
 * the other rows grouped by Template section. `order` is the keyboard order.
 */
export function reviewGroups(fields: ApiField[]) {
  const notStated = fields.filter((f) => f.status === "not stated");
  const supplier = notStated.filter((f) => f.author !== "Brand");
  const brand = notStated.filter((f) => f.author === "Brand");
  const rows = fields.filter((f) => f.status !== "not stated");
  const bySection = new Map<string, ApiField[]>();
  for (const f of rows) bySection.set(f.section, [...(bySection.get(f.section) ?? []), f]);
  const sections = [...bySection].map(([section, fields]) => ({ section, fields }));
  return { notStated, supplier, brand, rows, sections, order: [...supplier, ...brand, ...sections.flatMap((s) => s.fields)].map((f) => f.name) };
}

type Claim = { value: number | string | Record<string, number>; unit?: string } | { error: string };

/** The Challenge form's typed value as the API wants it: "80.0 Ah" → 80 + "Ah"; "55 % linen · 45 % cotton" → shares. */
export function parseClaim(text: string, f: { type: string; unit?: string; label: string }): Claim {
  const t = text.trim();
  if (!t) return { error: "Enter the value the Document states." };
  const num = (s: string) => Number(s.replace(/(\d)[\s  ](?=\d{3}\b)/g, "$1").replace(",", "."));
  if (f.type === "quantity") {
    const m = t.match(/^([-−]?[\d\s  ]*[\d][.,]?\d*)\s*(.*)$/);
    if (!m || Number.isNaN(num(m[1]!.replace("−", "-")))) return { error: `Enter a number for ${f.label}, e.g. 80${f.unit ? ` ${f.unit}` : ""}.` };
    return { value: num(m[1]!.replace("−", "-")), ...((m[2]!.trim() || f.unit) && { unit: m[2]!.trim() || f.unit }) };
  }
  if (f.type === "composition") {
    const shares: Record<string, number> = {};
    for (const part of t.split(/[·,;/+]|\band\b/)) {
      const p = part.trim();
      const first = p.match(/^(\d+(?:[.,]\d+)?)\s*%?\s+(.+)$/); // "55 % linen"
      const last = p.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*%?$/); // "cotton 95%"
      if (first) shares[first[2]!] = num(first[1]!);
      else if (last) shares[last[1]!] = num(last[2]!);
    }
    if (!Object.keys(shares).length) return { error: "Enter the shares, e.g. 95 % cotton · 5 % elastane." };
    return { value: shares, unit: f.unit ?? "%" };
  }
  return { value: t };
}

/** "From past uploads": Suppliers with their Document count, matching what is typed. */
export function suggestions(docs: { supplier: string }[], typed: string) {
  const count = new Map<string, number>();
  for (const d of docs) if (d.supplier) count.set(d.supplier, (count.get(d.supplier) ?? 0) + 1);
  const q = typed.trim().toLowerCase();
  return [...count]
    .filter(([name]) => name.toLowerCase().includes(q) && name !== typed.trim())
    .map(([name, n]) => ({ name, meta: `${n} Document${n === 1 ? "" : "s"}` }));
}

export const windowLength = (ms: number) => (ms >= 3600_000 ? `${Math.round(ms / 3600_000)} h` : `${Math.round(ms / 60_000)} min`);

export type ListStatus = "Processing" | "Delivered" | "Settled";

/** A Documents list row. Final and Not stated are the lead (first) Pipeline's; Challenged counts every Pipeline. */
export function docRow(d: ApiDocumentSummary) {
  const ps = Object.values(d.pipelines);
  const status: ListStatus = ps.some((p) => p.status === "processing") ? "Processing" : ps.every((p) => p.status === "settled") ? "Settled" : "Delivered";
  const bonds = ps.map((p) => p.bond);
  const bond = (["locked", "slashed", "released"] as const).find((b) => bonds.includes(b));
  const open = ps.filter((p) => p.closesAt !== undefined && p.status !== "settled").map((p) => p.closesAt!);
  const lead = ps[0]?.counts;
  return {
    status,
    bond,
    closesAt: open.length ? Math.max(...open) : undefined,
    counts: { final: lead?.final ?? 0, notStated: lead?.notStated ?? 0, challenged: ps.reduce((n, p) => n + p.counts.challenged, 0) },
    href: status === "Processing" ? `/documents/${d.id}/pipeline` : `/documents/${d.id}`,
  };
}

/** The totals strip. Fields and Supplier Requests count the lead Pipeline once it has delivered. */
export function listTotals(docs: ApiDocumentSummary[], now: number) {
  const month = (t: number) => { const d = new Date(t); return d.getFullYear() * 12 + d.getMonth(); };
  const leads = docs.map((d) => Object.values(d.pipelines)[0]).filter((p) => p && p.status !== "processing");
  const received = docs.flatMap((d) => Object.values(d.pipelines)).reduce((n, p) => n + Number(p.received ?? 0), 0);
  return {
    thisMonth: docs.filter((d) => month(d.uploadedAt) === month(now)).length,
    fieldsDelivered: leads.reduce((n, p) => n + p!.counts.final + p!.counts.notStated, 0),
    supplierRequests: leads.reduce((n, p) => n + p!.counts.notStated, 0),
    received: usdc(String(received)),
  };
}

export interface ListFilter { template?: string; supplier?: string; status?: ListStatus; q?: string }
export function filterDocs(docs: ApiDocumentSummary[], f: ListFilter) {
  const q = f.q?.trim().toLowerCase();
  return docs.filter((d) =>
    (!f.template || d.template === f.template) &&
    (!f.supplier || d.supplier === f.supplier) &&
    (!f.status || docRow(d).status === f.status) &&
    (!q || `${d.name} ${d.supplier}`.toLowerCase().includes(q)));
}

/** The settled banner's sentence. */
export function settledText(e: Pick<ApiEscrow, "bond" | "bondLeft" | "fee" | "upheld">, label: string) {
  if (!e.upheld) return `Bond ${usdc(e.bond)} USDC released. Fee ${usdc(e.fee)} USDC paid.`;
  return `${label} Bond ${usdc(e.bondLeft)} USDC released after a ${usdc(String(Number(e.bond) - Number(e.bondLeft)))} USDC Slash. Fee paid.`;
}

/** Viewer boxes for one Pipeline's Fields: selected = solid + tag, Challenged = red, Not stated = hatch, others dashed. */
export function boxes(fields: ApiField[], selected?: string): ViewerBox[] {
  return fields.flatMap((f): ViewerBox[] => {
    const tag = f.name === selected ? f.label : undefined;
    if ("evidence" in f) {
      const challenged = f.challenge?.status === "filed";
      const kind = tag ? "selected" : challenged ? "challenged" : "quoted";
      return [{ id: f.name, page: f.evidence.page, rects: f.evidence.rects, kind, tag: tag ?? (challenged ? "Challenged" : undefined), title: f.label }];
    }
    if ("quotes" in f) return f.quotes.map((q, i) => ({ id: f.name, page: q.page, rects: q.rects, kind: "notStated" as const, tag: i === 0 ? tag : undefined, title: f.label }));
    return [];
  });
}
