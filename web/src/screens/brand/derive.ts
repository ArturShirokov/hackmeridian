// What the Brand screens derive from the API: Pipeline status, counters, row order, Compare, Challenge values.
import type { ApiDocument, ApiEscrow, ApiField, ApiPipelineView, DocStatus } from "../../api.ts";
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

/** The Compare tab: the first two Pipelines side by side; `diff` is the server's canonical comparison. */
export function compare(d: ApiDocument) {
  const [a, b] = d.views;
  const rows = a!.fields.map((f, i) => ({ name: f.name, label: f.label, values: [shown(f), b ? shown(b.fields[i]!) : "—"], diff: d.differs.includes(f.name) }));
  const n = rows.filter((r) => r.diff).length;
  return { rows, summary: `${n} difference${n === 1 ? "" : "s"} in ${rows.length} Fields. Click a row to see its quote.` };
}

/** Review: Not stated Fields get their own group on top; `order` is the keyboard order. */
export function reviewGroups(fields: ApiField[]) {
  const notStated = fields.filter((f) => f.status === "not stated");
  const rows = fields.filter((f) => f.status !== "not stated");
  return { notStated, rows, order: [...notStated, ...rows].map((f) => f.name) };
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

const STATUS: Record<DocStatus, string> = { processing: "Processing", delivered: "Delivered", "awaiting arbiter": "Awaiting Arbiter", settled: "Settled" };
export function listStatus(pipelines: Record<string, { status: DocStatus }>, labels: Record<string, string>) {
  return Object.entries(pipelines).map(([p, { status }]) => `${labels[p] ?? p} ${STATUS[status]}`).join(" · ");
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
