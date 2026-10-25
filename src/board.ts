// The Job Board: owns Documents, Jobs and Sieve results. Workers reach it through mcp.ts,
// the Brand through web.ts. It touches the outside world only through the Storage and Ledger adapters.
import { createHash, randomUUID } from "node:crypto";
import * as z from "zod";
import { Challenges } from "./challenges.js";
import type {
  ApiChallenge, ApiConfig, ApiDocument, ApiDocumentSummary, ApiEscrow, ApiExport, ApiField, ApiJob, ApiLeaderRow, ApiPipelineView, ApiQuote,
  ApiStation, ApiWorker, DocStatus,
} from "./api.js";
import type { Challenge } from "./challenges.js";
import { compositionSum, converge, formatValue, supplierRequest, valueKey, type FieldResult } from "./converge.js";
import { addUsdc, slashes, subUsdc, type EscrowRequest, type Ledger } from "./ledger.js";
import { quoteRects, readPdf, type TextItem } from "./pdf.js";
import { baseline, type Pipeline, type SieveKind, type View } from "./pipelines.js";
import type { DocumentMeta, Storage } from "./storage.js";
import { mustBe, rules, statedValue, templates, type Field, type Template } from "./templates.js";

/** A self-contained unit of work for one Sieve pass over one Document. Never carries other Sieves' values. */
export interface Job {
  id: string;
  documentId: string;
  sieve: SieveKind;
  view: View;
  instructions: string;
  template: Template;
  /** markdown: the Markdown to check (faithfulness Sieve) or the checked Markdown (Sieves that read Markdown). */
  document: { url: string; text: string[]; markdown?: string };
}

const stated = z.strictObject({ field: z.string(), ...statedValue, page: z.number().int().positive() });
const notStated = z.strictObject({ field: z.string(), notStated: z.literal(true) });
export type FieldValue = z.infer<typeof stated> | z.infer<typeof notStated>;
// Pick the entry shape by `notStated` so errors name the bad key instead of "Invalid input" from a union.
const entry = z.looseObject({}).transform((v, ctx): FieldValue => {
  const r = ("notStated" in v ? notStated : stated).safeParse(v);
  if (!r.success) for (const i of r.error.issues) ctx.addIssue(i as never);
  return r.success ? r.data : z.NEVER;
});
const extractionResult = z.strictObject(
  { fields: z.array(entry) },
  { error: "result must be { fields: [ { field, value, unit, qualifier, page, quote } or { field, notStated: true } ] }" },
);

const markdownResult = z.strictObject({ markdown: z.string().trim().min(1) }, { error: 'result must be { markdown: "..." }' });
const faithfulnessResult = z.discriminatedUnion(
  "pass",
  [z.strictObject({ pass: z.literal(true) }), z.strictObject({ pass: z.literal(false), problems: z.array(z.string().min(1)).min(1) })],
  { error: 'result must be { pass: true } or { pass: false, problems: ["..."] }' },
);

/** Every Template Field exactly once, each value shaped for its Field type. Returns one line per problem. */
function checkAgainstTemplate(values: FieldValue[], template: Template, pages: number): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const f = template.fields.find((f) => f.name === v.field);
    if (!f) problems.push(`unknown Field "${v.field}"`);
    else if (seen.has(v.field)) problems.push(`Field "${v.field}" given more than once`);
    seen.add(v.field);
    if (!f || !("value" in v)) continue;
    const at = `Field "${f.name}":`;
    const isNumber = typeof v.value === "number";
    const isRecord = typeof v.value === "object";
    if (f.type === "quantity" && !isNumber) problems.push(`${at} ${mustBe.quantity}`);
    if (f.type === "composition" && !isRecord) problems.push(`${at} ${mustBe.composition}`);
    if (f.type === "composition" && isRecord) {
      const sum = compositionSum(v.value as Record<string, number>);
      if (sum !== 100) problems.push(`${at} fibre percentages must add up to 100, these add up to ${sum}`);
    }
    if (f.type !== "quantity" && f.type !== "composition" && typeof v.value !== "string")
      problems.push(`${at} a ${f.type} value must be a string`);
    if (f.type === "quantity" && !v.unit) problems.push(`${at} a quantity needs a unit`);
    if (v.qualifier && !f.qualifiers?.includes(v.qualifier as never))
      problems.push(`${at} qualifier "${v.qualifier}" not allowed (allowed: ${f.qualifiers?.join(", ") || "none"})`);
    if (v.page > pages) problems.push(`${at} page ${v.page} but the Document has ${pages} pages`);
  }
  const missing = template.fields.filter((f) => !seen.has(f.name)).map((f) => f.name);
  if (missing.length) problems.push(`missing Fields (give each a value or notStated): ${missing.join(", ")}`);
  return problems;
}

/** Sieve kinds that extract Field values; a Worker does at most one of them per Document. */
const extracts = (k: SieveKind) => k === "extract" || k === "tiebreak";

export type SubmitOutcome = { ok: true } | { ok: false; error: string };

interface Doc {
  meta: DocumentMeta;
  template: Template;
  text: string[];
  /** Text items per page with their positions, for quote boxes. */
  items: TextItem[][];
  /** Quote boxes already computed, by page and quote. */
  rects: Map<string, ApiQuote>;
  /** Delivered Field values by Pipeline name, set once the Pipeline's last Sieve is handed in. */
  delivered: Map<string, FieldResult[]>;
  /** Field values so far by Pipeline name, while a tie-break is still out. */
  progress: Map<string, FieldResult[]>;
}

/** What an Operator puts up and is paid per Document, in USDC decimal strings. */
export interface OperatorTerms {
  operator: string;
  bond: string;
  fee: string;
}

/** One escrow per (Document, Pipeline). */
const escrowKey = (documentId: string, pipeline: string) => JSON.stringify([documentId, pipeline]);

interface Escrow extends EscrowRequest {
  pipeline: string;
  escrowId: string;
  /** Delivery, when the Challenge Window opened. */
  openedAt: number;
  /** When the Challenge Window closes, in ms since the epoch. */
  closesAt: number;
  status: "open" | "settling" | "settled";
  /** Paid to the Brand at settlement, one per upheld Challenge. */
  slashes?: string[];
  /** Stellar explorer links from the Ledger, when it has a chain behind it. */
  link?: string;
  settlementLink?: string;
}

interface JobState {
  job: Job;
  pipeline: string;
  /** Index of the Job's Sieve in its Pipeline. */
  sieve: number;
  /** Extraction Sieves: the Field values. */
  result?: FieldValue[];
  /** Markdown Sieve: the Markdown text. */
  markdown?: string;
  /** Faithfulness Sieve: whether the Markdown passed. */
  pass?: boolean;
  /** Faithfulness Sieve: how many problems a failed check named (the count only; the text can quote values). */
  problems?: number;
  postedAt: number;
  takenBy?: string;
  takenAt?: number;
  doneAt?: number;
  /** Earlier takes that ran past the Job timeout before another Worker took the Job. */
  timeouts: { worker: string; takenAt: number }[];
  done: boolean;
}

/** Who the Brand is, until Brands have identities. */
export interface Brand {
  name: string;
  reviewer: string;
}

type Entry = FieldResult | { field: string; status: "converging" };

export class JobBoard {
  private storage: Storage;
  readonly ledger: Ledger;
  private baseUrl: string;
  private pipelines: Pipeline[];
  private docs = new Map<string, Doc>();
  private jobs: JobState[] = [];
  private seen = new Set<string>();
  private lastPoll = new Date(0);
  private now: () => number;
  private jobTimeoutMs: number;
  private operators: Record<string, OperatorTerms>;
  private challengeWindowMs: number;
  /** Keyed by escrowKey(documentId, pipeline). */
  private escrows = new Map<string, Escrow>();
  readonly challenges: Challenges;
  /** When each Worker last asked for or handed in a Job. */
  private workersSeen = new Map<string, number>();
  readonly brand: Brand;

  constructor(opts: {
    storage: Storage;
    ledger: Ledger;
    baseUrl: string;
    pipelines?: Pipeline[];
    /** Milliseconds since the epoch; tests inject a fake one. */
    now?: () => number;
    /** How long a Worker may hold a Job before it goes back on the board. */
    jobTimeoutMs?: number;
    /** Bond and Fee by Pipeline name. A Pipeline not listed is run by an Operator of the same name for 10 + 1 USDC. */
    operators?: Record<string, OperatorTerms>;
    challengeWindowMs?: number;
    brand?: Brand;
  }) {
    this.now = opts.now ?? Date.now;
    this.challenges = new Challenges(this.now);
    this.brand = opts.brand ?? { name: "Voltaris", reviewer: "Inês Duarte" };
    this.jobTimeoutMs = opts.jobTimeoutMs ?? 10 * 60_000;
    this.operators = opts.operators ?? {};
    this.challengeWindowMs = opts.challengeWindowMs ?? 5 * 60_000;
    this.storage = opts.storage;
    this.ledger = opts.ledger;
    this.baseUrl = opts.baseUrl;
    this.pipelines = opts.pipelines ?? [baseline];
  }

  /** Brand upload: store the Document and put its first Jobs on the board. Throws on a bad Template or non-PDF. */
  async upload(
    bytes: Uint8Array,
    template: string,
    { name = "document.pdf", supplier = "", uploader = "brand" }: { name?: string; supplier?: string; uploader?: string } = {},
  ): Promise<DocumentMeta> {
    if (!templates[template]) throw new Error(`unknown Template "${template}"`);
    const pdf = await readPdf(bytes);
    const meta = await this.storage.put(bytes, { template, uploader, name, supplier });
    this.add(meta, pdf);
    return meta;
  }

  /** Pick up Documents stored by other uploaders (the ICP path). main.ts calls this every 5 s. */
  async poll(): Promise<void> {
    const since = new Date();
    for (const meta of await this.storage.listSince(this.lastPoll)) {
      if (this.seen.has(meta.id) || !templates[meta.template]) continue;
      const stored = await this.storage.get(meta.id);
      if (!stored) continue;
      try {
        this.add(meta, await readPdf(stored.bytes));
      } catch (e) {
        this.seen.add(meta.id);
        console.error(`Document ${meta.id} is not a readable PDF:`, e);
      }
    }
    this.lastPoll = since;
  }

  private add(meta: DocumentMeta, { text, items }: { text: string[]; items: TextItem[][] }) {
    if (this.seen.has(meta.id)) return;
    this.seen.add(meta.id);
    const template = templates[meta.template]!;
    this.docs.set(meta.id, { meta, template, text, items, rects: new Map(), delivered: new Map(), progress: new Map() });
    for (const p of this.pipelines) this.post(p, 0, meta.id);
  }

  /** Put the Job for Sieve `index` of Pipeline `p` on the board for this Document. */
  private post(p: Pipeline, index: number, documentId: string, fields?: string[]) {
    const d = this.docs.get(documentId)!;
    const sieve = p.sieves[index]!;
    const markdown = sieve.view === "original" ? undefined : this.latestMarkdown(p.name, documentId);
    this.jobs.push({
      pipeline: p.name,
      sieve: index,
      done: false,
      postedAt: this.now(),
      timeouts: [],
      job: {
        id: randomUUID(),
        documentId,
        sieve: sieve.kind,
        view: sieve.view,
        instructions: sieve.instructions,
        template: fields ? { ...d.template, fields: d.template.fields.filter((f) => fields.includes(f.name)) } : d.template,
        document: { url: `${this.baseUrl}/documents/${documentId}/file`, text: d.text, ...(markdown !== undefined && { markdown }) },
      },
    });
  }

  /** The last Markdown handed in for this Document and Pipeline; checked once a faithfulness Sieve after it passed. */
  private latestMarkdown(pipeline: string, documentId: string): string | undefined {
    return this.jobs.findLast((j) => j.pipeline === pipeline && j.job.documentId === documentId && j.markdown !== undefined)?.markdown;
  }

  /** Sieves stay independent: a Worker does at most one extraction Sieve per Document, across every Pipeline. */
  private didExtraction(worker: string, j: JobState): boolean {
    return this.jobs.some((o) => o !== j && o.takenBy === worker && o.job.documentId === j.job.documentId && extracts(o.job.sieve));
  }

  /** The next open Job for this Worker, or null when there is nothing yet. */
  nextJob(worker: string): Job | null {
    const now = this.now();
    this.workersSeen.set(worker, now);
    const s = this.jobs.find(
      (j) =>
        !j.done &&
        (!j.takenBy || this.stale(j)) &&
        !(extracts(j.job.sieve) && this.didExtraction(worker, j)),
    );
    if (!s) return null;
    if (s.takenBy) s.timeouts.push({ worker: s.takenBy, takenAt: s.takenAt! });
    s.takenBy = worker;
    s.takenAt = now;
    return s.job;
  }

  /** Taken, not handed in, and held past the Job timeout: back on the board. */
  private stale(j: JobState): boolean {
    return !!j.takenBy && !j.done && this.now() - j.takenAt! >= this.jobTimeoutMs;
  }

  async submitJob(worker: string, jobId: string, result: unknown): Promise<SubmitOutcome> {
    this.workersSeen.set(worker, this.now());
    const s = this.jobs.find((j) => j.job.id === jobId);
    if (!s) return { ok: false, error: `unknown Job "${jobId}"` };
    if (s.takenBy !== worker) return { ok: false, error: `Job "${jobId}" is not taken by Worker "${worker}"` };
    if (s.done) return { ok: false, error: `Job "${jobId}" was already submitted` };
    const doc = this.docs.get(s.job.documentId)!;
    const p = this.pipelines.find((p) => p.name === s.pipeline)!;
    if (s.job.sieve === "markdown") {
      const parsed = markdownResult.safeParse(result);
      if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
      s.markdown = parsed.data.markdown;
    } else if (s.job.sieve === "faithfulness") {
      const parsed = faithfulnessResult.safeParse(result);
      if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
      s.pass = parsed.data.pass;
      if (!parsed.data.pass) s.problems = parsed.data.problems.length;
    } else {
      const parsed = extractionResult.safeParse(result);
      if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
      const problems = checkAgainstTemplate(parsed.data.fields, s.job.template, doc.text.length);
      if (problems.length) return { ok: false, error: problems.join("\n") };
      s.result = parsed.data.fields;
    }
    s.done = true;
    s.doneAt = this.now();
    if (s.pass === false) {
      // A failed check reruns the Markdown Sieve before it, once. A second fail delivers every Field as Not stated,
      // with whatever the first extraction quoted, since no checked Markdown exists to extract from.
      const md = p.sieves.findLastIndex((v, i) => i < s.sieve && v.kind === "markdown");
      if (md >= 0 && this.jobsOf(p.name, doc.meta.id).filter((j) => j.sieve === md).length < 2) {
        this.post(p, md, doc.meta.id);
        return { ok: true };
      }
      const first = this.jobsOf(p.name, doc.meta.id).find((j) => extracts(j.job.sieve))?.result ?? [];
      const fields = doc.template.fields.map((f): FieldResult => {
        const v = first.find((v) => v.field === f.name);
        return { field: f.name, status: "not stated", quotes: v && "quote" in v ? [{ page: v.page, quote: v.quote }] : [] };
      });
      return this.deliver(s, doc, p.name, fields);
    }
    const next = s.sieve + 1;
    if (next < p.sieves.length && p.sieves[next]!.kind !== "tiebreak") {
      this.post(p, next, doc.meta.id);
      return { ok: true };
    }
    const ran = this.jobsOf(p.name, doc.meta.id).filter((j) => extracts(j.job.sieve));
    // A scan has no text layer, so quotes are checked against the checked Markdown instead.
    const scan = doc.text.every((t) => !t.trim());
    const markdown = this.latestMarkdown(p.name, doc.meta.id);
    const fields = converge(doc.template, ran.map((j) => j.result!), scan && markdown !== undefined ? [markdown] : doc.text);
    if (next < p.sieves.length) {
      const split = fields.filter((f) => f.status === "disagreeing").map((f) => f.field);
      // ponytail: tie-break assumed to be the last Sieve; no Sieve runs after it.
      if (split.length) {
        doc.progress.set(p.name, fields);
        this.post(p, next, doc.meta.id, split);
        return { ok: true };
      }
    }
    return this.deliver(s, doc, p.name, fields);
  }

  /** Deliver a Pipeline's Field values and open its escrow; if the escrow fails, the submission is undone. */
  private async deliver(s: JobState, doc: Doc, pipeline: string, fields: FieldResult[]): Promise<SubmitOutcome> {
    doc.delivered.set(pipeline, fields);
    try {
      await this.openEscrow(doc, pipeline, fields);
    } catch (e) {
      s.done = false;
      delete s.doneAt;
      delete s.result;
      delete s.pass;
      doc.delivered.delete(pipeline);
      return { ok: false, error: `could not open the escrow, try again: ${(e as Error).message}` };
    }
    return { ok: true };
  }

  /** Every Job posted so far for this Pipeline and Document, in posting order. */
  private jobsOf(pipeline: string, documentId: string): JobState[] {
    return this.jobs.filter((j) => j.pipeline === pipeline && j.job.documentId === documentId);
  }

  /** Delivery: lock the Operator's Bond and the Brand's Fee behind a hash of the delivered Field values. */
  private async openEscrow(doc: Doc, pipeline: string, fields: FieldResult[]) {
    const terms = this.terms(pipeline);
    const req: EscrowRequest = {
      documentId: doc.meta.id,
      ...terms,
      brand: doc.meta.uploader,
      outputHash: createHash("sha256").update(JSON.stringify(fields)).digest("hex"),
    };
    const { escrowId, link } = await this.ledger.openEscrow(req);
    this.escrows.set(escrowKey(doc.meta.id, pipeline), {
      ...req,
      pipeline,
      escrowId,
      ...(link && { link }),
      openedAt: this.now(),
      closesAt: this.now() + this.challengeWindowMs,
      status: "open",
    });
  }

  /** Settle every escrow whose Challenge Window has closed. main.ts calls this every 5 s. */
  async tick(): Promise<void> {
    for (const e of this.escrows.values()) {
      if (e.status !== "open" || this.now() < e.closesAt) continue;
      const { documentId, pipeline } = e;
      if (this.challenges.undecided(documentId, pipeline)) continue; // wait for the Arbiter
      const s = slashes(e.bond, this.challenges.upheld(documentId, pipeline).length);
      e.status = "settling";
      try {
        const { link } = s.length ? await this.ledger.settleWithSlashes(e.escrowId, s) : await this.ledger.settleClean(e.escrowId);
        e.status = "settled";
        if (link) e.settlementLink = link;
        if (s.length) e.slashes = s;
      } catch (err) {
        e.status = "open";
        console.error(`settling escrow ${e.escrowId} failed:`, err);
      }
    }
  }

  /** File a Challenge against a delivered Field, only while its Challenge Window is open. */
  challenge(documentId: string, raw: unknown, pipeline = this.pipelines[0]!.name) {
    const d = this.docs.get(documentId);
    const e = this.escrows.get(escrowKey(documentId, pipeline));
    const delivered = d?.delivered.get(pipeline);
    if (!d || !e || !delivered) return { ok: false as const, reason: "not found" as const, error: "no delivered Document with that id" };
    if (e.status !== "open" || this.now() >= e.closesAt)
      return { ok: false as const, reason: "closed" as const, error: "the Challenge Window has closed" };
    // The values are not shown yet, and the Arbiter's view would show them.
    if (this.withheld(d)) return { ok: false as const, reason: "closed" as const, error: "another Pipeline is still extracting this Document" };
    const r = this.challenges.fileChallenge({ documentId, pipeline, template: d.template, text: d.text, delivered }, raw);
    return r.ok ? r : { ...r, reason: "invalid" as const };
  }

  documents(): DocumentMeta[] {
    return [...this.docs.values()].map((d) => d.meta);
  }

  /** What the Brand sees: every Template Field with its status and, once final, its value. Top level is the first Pipeline's. */
  document(id: string) {
    const d = this.docs.get(id);
    if (!d) return undefined;
    const pipelines = Object.fromEntries(this.pipelines.map((p) => [p.name, this.view(d, p.name)]));
    return { id, template: d.template.name, uploadedAt: d.meta.uploadedAt, ...pipelines[this.pipelines[0]!.name]!, pipelines };
  }

  /**
   * Sieve independence: every Worker can read the Brand's API, so no value, quote or box of a Document is shown
   * until every Pipeline has delivered it (no extraction Job for it can be open or still to come).
   */
  private withheld(d: Doc): boolean {
    return this.pipelines.some((p) => !d.delivered.has(p.name));
  }

  /** Per Template Field: what the Brand sees for this Pipeline, with an upheld Challenge's correction applied. */
  private entries(d: Doc, pipeline: string): { f: Field; v: Entry; was?: string }[] {
    const values = d.delivered.get(pipeline) ?? d.progress.get(pipeline) ?? [];
    return d.template.fields.map((f) => {
      const v: Entry = values.find((v) => v.field === f.name) ?? { field: f.name, status: "converging" };
      const c = this.challenges.correction(d.meta.id, pipeline, f.name);
      if (!c) return { f, v };
      const { corrected: _, ...value } = c;
      return { f, v: { field: f.name, status: "final", ...value }, was: v.status === "final" ? formatValue(v) : "Not stated" };
    });
  }

  /** A quote with its boxes: on the page it cites, else on the page it is found on. */
  private quote(d: Doc, page: number, quote: string, value?: { value: unknown; unit?: string }): ApiQuote {
    const key = JSON.stringify([page, quote, value?.value, value?.unit]);
    const hit = d.rects.get(key);
    if (hit) return hit;
    let at = page;
    let rects = quoteRects(d.items[page - 1] ?? [], quote);
    for (let p = 1; !rects.length && p <= d.items.length; p++) if (p !== page && (rects = quoteRects(d.items[p - 1]!, quote)).length) at = p;
    const lower = quote.toLowerCase();
    const mark =
      value && typeof value.value !== "object"
        ? [value.unit && `${value.value} ${value.unit}`, String(value.value)].find((m) => m && lower.includes(m.toLowerCase()))
        : undefined;
    const q: ApiQuote = { page: at, quote, rects, ...(mark && { mark: quote.substr(lower.indexOf(mark.toLowerCase()), mark.length) }) };
    d.rects.set(key, q);
    return q;
  }

  private escrowView(e: Escrow): ApiEscrow {
    const upheld = this.challenges.upheld(e.documentId, e.pipeline).length;
    const status: DocStatus =
      e.status === "settled" ? "settled" : this.now() >= e.closesAt && this.challenges.undecided(e.documentId, e.pipeline) ? "awaiting arbiter" : "delivered";
    return {
      operator: e.operator,
      bond: e.bond,
      bondLeft: subUsdc(e.bond, addUsdc(...slashes(e.bond, upheld))),
      fee: e.fee,
      outputHash: e.outputHash,
      status,
      openedAt: e.openedAt,
      closesAt: e.closesAt,
      upheld,
      ...(e.slashes && { slashes: e.slashes }),
      ...(e.link && { link: e.link }),
      ...(e.settlementLink && { settlementLink: e.settlementLink }),
    };
  }

  private summary(d: Doc): ApiDocumentSummary {
    const pipelines = Object.fromEntries(
      this.pipelines.map((p) => {
        const e = this.escrows.get(escrowKey(d.meta.id, p.name));
        const es = this.entries(d, p.name);
        const n = (s: string) => es.filter(({ v }) => v.status === s).length;
        const counts = { final: n("final"), notStated: n("not stated"), converging: es.length - n("final") - n("not stated") };
        const status = d.delivered.has(p.name) && e ? this.escrowView(e).status : "processing";
        return [p.name, { status, ...(e && { closesAt: e.closesAt }), counts }];
      }),
    );
    const { id, name, supplier, template, uploadedAt } = d.meta;
    return { id, name, supplier, template, pages: d.text.length, uploadedAt: uploadedAt.getTime(), pipelines };
  }

  /** Every Document, newest first. */
  documentList(): ApiDocumentSummary[] {
    return [...this.docs.values()].reverse().map((d) => this.summary(d));
  }

  private stations(d: Doc, p: Pipeline): ApiStation[] {
    const jobs = this.jobsOf(p.name, d.meta.id);
    const delivered = d.delivered.has(p.name);
    const extractsBefore = (i: number) => p.sieves.slice(0, i).some((s) => s.kind === "extract");
    return p.sieves.map((s, index) => {
      const mine = jobs.filter((j) => j.sieve === index);
      const j = mine.at(-1);
      const base = { index, kind: s.kind, label: s.label, attempt: mine.length };
      if (!j) return { ...base, state: delivered ? "done" : "wait", meta: delivered ? "skipped" : "" };
      const state = j.done ? (j.pass === false ? "fail" : "done") : j.takenBy && !this.stale(j) ? "run" : "wait";
      const times = { postedAt: j.postedAt, ...(j.takenAt !== undefined && { takenAt: j.takenAt }), ...(j.doneAt !== undefined && { doneAt: j.doneAt }) };
      const worker = state === "wait" ? {} : { worker: j.takenBy! };
      let meta = mine.length > 1 && !j.done ? `re-run ${mine.length - 1} of 1` : "";
      if (j.done) {
        if (s.kind === "markdown")
          meta = `${(j.markdown!.match(/<!-- page/g) ?? []).length} pages read · ${(j.markdown!.match(/^\s*\|\s*:?-{3,}/gm) ?? []).length} tables`;
        else if (s.kind === "faithfulness") meta = j.pass ? "pass" : `failed · ${j.problems} problems`;
        else if (s.kind === "extract") {
          meta = `${j.result!.filter((v) => "value" in v).length} values`;
          const converged = d.progress.get(p.name) ?? d.delivered.get(p.name);
          if (extractsBefore(index) && converged) meta += ` · ${converged.filter((v) => v.status === "final").length} agree`;
        } else {
          const out = d.delivered.get(p.name) ?? [];
          const mineOut = out.filter((v) => j.job.template.fields.some((f) => f.name === v.field));
          meta = `${mineOut.filter((v) => v.status === "final").length} resolved · ${mineOut.filter((v) => v.status === "not stated").length} Not stated`;
        }
      }
      return { ...base, state, ...worker, ...times, meta };
    });
  }

  private challengeSummary(c: Challenge) {
    return { id: c.id, status: c.decision ?? ("filed" as const), value: formatValue(c), page: c.page, quote: c.quote };
  }

  private apiField(d: Doc, pipeline: string, { f, v, was }: { f: Field; v: Entry; was?: string }, withheld: boolean): ApiField {
    const tie = this.jobsOf(pipeline, d.meta.id).find((j) => j.job.sieve === "tiebreak");
    const c = this.challenges.of(d.meta.id, pipeline).findLast((c) => c.field === f.name);
    const base = { name: f.name, label: f.label, tieBreak: !!tie?.job.template.fields.some((t) => t.name === f.name), ...(c && { challenge: this.challengeSummary(c) }) };
    if (v.status === "converging" || v.status === "disagreeing") return { ...base, status: "converging" };
    if (withheld) return { ...base, status: v.status, withheld: true };
    if (v.status === "not stated")
      return { ...base, status: v.status, quotes: v.quotes.map((q) => this.quote(d, q.page, q.quote)), supplierRequest: supplierRequest(f, d.meta, v.quotes) };
    return {
      ...base,
      status: "final",
      value: v.value,
      ...(v.unit && { unit: v.unit }),
      ...(v.qualifier && { qualifier: v.qualifier }),
      display: formatValue(v),
      evidence: this.quote(d, v.page, v.quote, v),
      ...(was !== undefined && { corrected: { was } }),
    };
  }

  /** Field names whose values differ between the Pipelines, once all have delivered. */
  private differs(d: Doc): string[] {
    if (this.withheld(d) || this.pipelines.length < 2) return [];
    const keyed = this.pipelines.map((p) => this.entries(d, p.name));
    return d.template.fields.flatMap((f, i) => {
      const keys = keyed.map((es) => {
        const v = es[i]!.v;
        return v.status === "final" ? (valueKey(f, v) ?? JSON.stringify([v.value, v.unit, v.qualifier])) : v.status;
      });
      return new Set(keys).size > 1 ? [f.name] : [];
    });
  }

  /** The Brand's view of one Document: every Pipeline's stations, escrow and Fields. */
  apiDocument(id: string): ApiDocument | undefined {
    const d = this.docs.get(id);
    if (!d) return undefined;
    const withheld = this.withheld(d);
    const views = this.pipelines.map((p): ApiPipelineView => {
      const e = this.escrows.get(escrowKey(id, p.name));
      return {
        pipeline: p.name,
        label: p.label ?? p.name,
        operator: this.terms(p.name).operator,
        stations: this.stations(d, p),
        ...(e && { deliveredAt: e.openedAt, escrow: this.escrowView(e) }),
        fields: this.entries(d, p.name).map((x) => this.apiField(d, p.name, x, withheld)),
      };
    });
    return { ...this.summary(d), fileUrl: `/documents/${id}/file`, views, differs: this.differs(d) };
  }

  /** The delivered Field values in the testdata/expected shape, corrections applied; undefined until shown. */
  exportOf(id: string, pipeline = this.pipelines[0]!.name): ApiExport | undefined {
    const d = this.docs.get(id);
    const e = this.escrows.get(escrowKey(id, pipeline));
    if (!d || !e || !d.delivered.has(pipeline) || this.withheld(d)) return undefined;
    const fields = Object.fromEntries(
      this.entries(d, pipeline).map(({ f, v }) => {
        if (v.status !== "final") return [f.name, "Not stated" as const];
        const { value, unit, qualifier, page, quote } = v;
        return [f.name, { value, ...(unit && { unit }), ...(qualifier && { qualifier }), page, quote }];
      }),
    );
    return { template: d.template.name, documentId: id, pipeline, operator: e.operator, outputHash: e.outputHash, fields };
  }

  config(): ApiConfig {
    return {
      now: this.now(),
      baseUrl: this.baseUrl,
      challengeWindowMs: this.challengeWindowMs,
      brand: this.brand,
      operators: this.pipelines.map((p) => ({
        pipeline: p.name,
        label: p.label ?? p.name,
        ...this.terms(p.name),
        sieves: p.sieves.map((s) => ({ kind: s.kind, label: s.label })),
      })),
    };
  }

  private apiChallenge(c: Challenge): ApiChallenge {
    const d = this.docs.get(c.documentId)!;
    const e = this.escrows.get(escrowKey(c.documentId, c.pipeline))!;
    const f = d.template.fields.find((f) => f.name === c.field)!;
    const p = this.pipelines.find((p) => p.name === c.pipeline)!;
    const was = c.challenged;
    return {
      ...this.challengeSummary(c),
      documentId: c.documentId,
      documentName: d.meta.name,
      supplier: d.meta.supplier,
      brand: this.brand.name,
      pipeline: c.pipeline,
      operatorLabel: p.label ?? p.name,
      field: f.name,
      fieldLabel: f.label,
      rule: rules[f.type],
      filedAt: c.filedAt,
      ...(c.decidedAt !== undefined && { decidedAt: c.decidedAt }),
      ...(c.note && { note: c.note }),
      closesAt: e.closesAt,
      delivered:
        was.status === "final"
          ? { display: formatValue(was), evidence: this.quote(d, was.page, was.quote, was) }
          : { display: was.status === "not stated" ? "Not stated" : "Sieves disagree" },
      claim: { display: formatValue(c), evidence: this.quote(d, c.page, c.quote, c) },
      slash: slashes(e.bond, 1)[0]!,
    };
  }

  /** The Arbiter's desk: open Challenges oldest first, decided ones newest first. */
  arbiter() {
    const all = this.challenges.all();
    const decided = all.filter((c) => c.decision).sort((a, b) => b.decidedAt! - a.decidedAt!);
    return {
      open: all.filter((c) => !c.decision).map((c) => this.apiChallenge(c)),
      decided: decided.map((c) => this.apiChallenge(c)),
      record: { decided: decided.length, upheld: decided.filter((c) => c.decision === "upheld").length, rejected: decided.filter((c) => c.decision === "rejected").length },
    };
  }

  /** Jobs newest first, metadata only (never instructions, Document text or results). A timed-out take is its own row. */
  jobList(limit = 50): ApiJob[] {
    const rows: ApiJob[] = [];
    for (const j of this.jobs) {
      const d = this.docs.get(j.job.documentId)!;
      const base = { documentId: d.meta.id, documentName: d.meta.name, pipeline: j.pipeline, sieve: this.sieveOf(j).label, postedAt: j.postedAt };
      const timeouts = this.stale(j) ? [...j.timeouts, { worker: j.takenBy!, takenAt: j.takenAt! }] : j.timeouts;
      timeouts.forEach((t, i) => rows.push({ ...base, id: `${j.job.id}~${i + 1}`, worker: t.worker, status: "timed out", takenAt: t.takenAt }));
      if (this.stale(j)) rows.push({ ...base, id: j.job.id, status: "open" });
      else
        rows.push({
          ...base,
          id: j.job.id,
          status: j.done ? "done" : j.takenBy ? "taken" : "open",
          ...(j.takenBy && { worker: j.takenBy, takenAt: j.takenAt }),
          ...(j.doneAt !== undefined && { doneAt: j.doneAt }),
        });
    }
    return rows.reverse().slice(0, limit);
  }

  private sieveOf(j: JobState) {
    return this.pipelines.find((p) => p.name === j.pipeline)!.sieves[j.sieve]!;
  }

  /** Every Worker seen so far, most recently seen first. Live: seen within the last minute. */
  workerList(): ApiWorker[] {
    const now = this.now();
    const today = new Date(now).setUTCHours(0, 0, 0, 0);
    return [...this.workersSeen]
      .sort(([, a], [, b]) => b - a)
      .map(([name, lastSeen]) => {
        const cur = this.jobs.find((j) => j.takenBy === name && !j.done && !this.stale(j));
        return {
          name,
          lastSeen,
          live: now - lastSeen < 60_000,
          ...(cur && { current: { jobId: cur.job.id, sieve: this.sieveOf(cur).label, documentName: this.docs.get(cur.job.documentId)!.meta.name } }),
          doneToday: this.jobs.filter((j) => j.takenBy === name && j.doneAt !== undefined && j.doneAt >= today).length,
        };
      });
  }

  /** Per Operator, in Pipeline order: the Ledger's record plus what the board knows. accuracy is added by web.ts. */
  async leaderboard(): Promise<ApiLeaderRow[]> {
    const ops = [...new Set(this.pipelines.map((p) => this.terms(p.name).operator))];
    return Promise.all(
      ops.map(async (operator) => {
        const ps = this.pipelines.filter((p) => this.terms(p.name).operator === operator);
        const mine = [...this.docs.values()].flatMap((d) =>
          ps.flatMap((p) => {
            const e = this.escrows.get(escrowKey(d.meta.id, p.name));
            return e && d.delivered.has(p.name) ? [{ d, p, e }] : [];
          }),
        );
        const link = this.ledger.operatorLink?.(operator);
        return {
          operator,
          label: ps[0]!.label ?? ps[0]!.name,
          sieves: ps[0]!.sieves.length,
          ...(await this.ledger.operatorRecord(operator)),
          fieldsDelivered: mine.reduce((n, { d, p }) => n + d.delivered.get(p.name)!.filter((v) => v.status !== "disagreeing").length, 0),
          bondsLocked: addUsdc(...mine.filter(({ e }) => e.status !== "settled").map(({ e }) => e.bond)),
          ...(link && { link }),
          series: mine.map(({ d, e }) => ({
            documentId: d.meta.id,
            short: d.meta.supplier || d.meta.name.replace(/\.pdf$/i, "").slice(0, 12),
            balance: this.escrowView(e).bondLeft,
          })),
        };
      }),
    );
  }

  private terms(pipeline: string): OperatorTerms {
    return this.operators[pipeline] ?? { operator: pipeline, bond: "10", fee: "1" };
  }

  /** The Operator that runs this Pipeline. */
  operatorOf(pipeline: string): string {
    return this.terms(pipeline).operator;
  }

  private view(d: Doc, pipeline: string) {
    const id = d.meta.id;
    const values = d.delivered.get(pipeline) ?? d.progress.get(pipeline) ?? [];
    const e = this.escrows.get(escrowKey(id, pipeline));
    return {
      operator: this.terms(pipeline).operator,
      escrow: e && {
        operator: e.operator,
        bond: e.bond,
        fee: e.fee,
        outputHash: e.outputHash,
        status: e.status === "settled" ? ("settled" as const) : ("open" as const),
        msLeft: Math.max(0, e.closesAt - this.now()),
        ...(e.slashes && { slashes: e.slashes }),
        ...(e.link && { link: e.link }),
        ...(e.settlementLink && { settlementLink: e.settlementLink }),
      },
      fields: d.template.fields.map((f) => {
        if (this.withheld(d)) {
          const v = values.find((v) => v.field === f.name);
          return { name: f.name, label: f.label, status: v?.status ?? ("converging" as const) };
        }
        const corrected = this.challenges.correction(id, pipeline, f.name);
        if (corrected) return { name: f.name, label: f.label, status: "final" as const, ...corrected };
        const { field: _, ...v } = values.find((v) => v.field === f.name) ?? { field: f.name, status: "converging" as const };
        if (v.status !== "not stated") return { name: f.name, label: f.label, ...v };
        return { name: f.name, label: f.label, ...v, supplierRequest: supplierRequest(f, d.meta, v.quotes) };
      }),
    };
  }

  async documentBytes(id: string): Promise<Uint8Array | undefined> {
    return (await this.storage.get(id))?.bytes;
  }

  /** The Field values a Pipeline delivered for a Document, before any Challenge; undefined until delivered. */
  delivered(id: string, pipeline: string): FieldResult[] | undefined {
    return this.docs.get(id)?.delivered.get(pipeline);
  }
}
