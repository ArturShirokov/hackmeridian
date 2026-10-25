// The Job Board: owns Documents, Jobs and Sieve results. Workers reach it through mcp.ts,
// the Brand through web.ts. It touches the outside world only through the Storage and Ledger adapters.
import { createHash, randomUUID } from "node:crypto";
import * as z from "zod";
import { Challenges } from "./challenges.js";
import { compositionSum, converge, type FieldResult } from "./converge.js";
import { slashes, type EscrowRequest, type Ledger } from "./ledger.js";
import { pageTexts } from "./pdf.js";
import { baseline, type Pipeline, type SieveKind, type View } from "./pipelines.js";
import type { DocumentMeta, Storage } from "./storage.js";
import { templates, type Template } from "./templates.js";

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

const stated = z.strictObject({
  field: z.string(),
  value: z.union([z.string().min(1), z.number(), z.record(z.string(), z.number())]),
  unit: z.string().min(1).optional(),
  qualifier: z.string().min(1).optional(),
  page: z.number().int().positive(),
  quote: z.string().min(1),
});
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
    if (f.type === "quantity" && !isNumber) problems.push(`${at} a quantity value must be a number`);
    if (f.type === "composition" && !isRecord) problems.push(`${at} a composition value must be { fibre: percent }`);
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

interface Escrow extends EscrowRequest {
  escrowId: string;
  /** When the Challenge Window closes, in ms since the epoch. */
  closesAt: number;
  status: "open" | "settling" | "settled";
  /** Paid to the Brand at settlement, one per upheld Challenge. */
  slashes?: string[];
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
  takenBy?: string;
  takenAt?: number;
  done: boolean;
}

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
  /** Keyed by `${documentId} ${pipeline}`. */
  private escrows = new Map<string, Escrow>();
  readonly challenges = new Challenges();

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
  }) {
    this.now = opts.now ?? Date.now;
    this.jobTimeoutMs = opts.jobTimeoutMs ?? 10 * 60_000;
    this.operators = opts.operators ?? {};
    this.challengeWindowMs = opts.challengeWindowMs ?? 5 * 60_000;
    this.storage = opts.storage;
    this.ledger = opts.ledger;
    this.baseUrl = opts.baseUrl;
    this.pipelines = opts.pipelines ?? [baseline];
  }

  /** Brand upload: store the Document and put its first Jobs on the board. Throws on a bad Template or non-PDF. */
  async upload(bytes: Uint8Array, template: string, uploader = "brand"): Promise<DocumentMeta> {
    if (!templates[template]) throw new Error(`unknown Template "${template}"`);
    const text = await pageTexts(bytes);
    const meta = await this.storage.put(bytes, { template, uploader });
    this.add(meta, text);
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
        this.add(meta, await pageTexts(stored.bytes));
      } catch (e) {
        this.seen.add(meta.id);
        console.error(`Document ${meta.id} is not a readable PDF:`, e);
      }
    }
    this.lastPoll = since;
  }

  private add(meta: DocumentMeta, text: string[]) {
    if (this.seen.has(meta.id)) return;
    this.seen.add(meta.id);
    const template = templates[meta.template]!;
    this.docs.set(meta.id, { meta, template, text, delivered: new Map(), progress: new Map() });
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

  /** Sieves stay independent: a Worker does at most one extraction Sieve per Document and Pipeline. */
  private didExtraction(worker: string, j: JobState): boolean {
    return this.jobs.some(
      (o) => o !== j && o.takenBy === worker && o.pipeline === j.pipeline && o.job.documentId === j.job.documentId && extracts(o.job.sieve),
    );
  }

  /** The next open Job for this Worker, or null when there is nothing yet. */
  nextJob(worker: string): Job | null {
    const now = this.now();
    const s = this.jobs.find(
      (j) =>
        !j.done &&
        (!j.takenBy || now - j.takenAt! >= this.jobTimeoutMs) &&
        !(extracts(j.job.sieve) && this.didExtraction(worker, j)),
    );
    if (!s) return null;
    s.takenBy = worker;
    s.takenAt = now;
    return s.job;
  }

  async submitJob(worker: string, jobId: string, result: unknown): Promise<SubmitOutcome> {
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
    } else {
      const parsed = extractionResult.safeParse(result);
      if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
      const problems = checkAgainstTemplate(parsed.data.fields, s.job.template, doc.text.length);
      if (problems.length) return { ok: false, error: problems.join("\n") };
      s.result = parsed.data.fields;
    }
    s.done = true;
    if (s.pass === false) {
      // A failed check reruns the Markdown Sieve before it, once. A second fail stops this Pipeline for the Document.
      // ponytail: the Document then stays converging with no delivery; add a fallback (all Not stated) if demos hit it.
      const md = p.sieves.findLastIndex((v, i) => i < s.sieve && v.kind === "markdown");
      const runs = this.jobs.filter((j) => j.pipeline === p.name && j.job.documentId === doc.meta.id && j.sieve === md).length;
      if (md >= 0 && runs < 2) this.post(p, md, doc.meta.id);
      return { ok: true };
    }
    const next = s.sieve + 1;
    if (next < p.sieves.length && p.sieves[next]!.kind !== "tiebreak") {
      this.post(p, next, doc.meta.id);
      return { ok: true };
    }
    const ran = this.jobs.filter((j) => j.pipeline === p.name && j.job.documentId === doc.meta.id && extracts(j.job.sieve));
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
    doc.delivered.set(p.name, fields);
    try {
      await this.openEscrow(doc, p.name, fields);
    } catch (e) {
      s.done = false;
      delete s.result;
      doc.delivered.delete(p.name);
      return { ok: false, error: `could not open the escrow, try again: ${(e as Error).message}` };
    }
    return { ok: true };
  }

  /** Delivery: lock the Operator's Bond and the Brand's Fee behind a hash of the delivered Field values. */
  private async openEscrow(doc: Doc, pipeline: string, fields: FieldResult[]) {
    const terms = this.operators[pipeline] ?? { operator: pipeline, bond: "10", fee: "1" };
    const req: EscrowRequest = {
      documentId: doc.meta.id,
      ...terms,
      brand: doc.meta.uploader,
      outputHash: createHash("sha256").update(JSON.stringify(fields)).digest("hex"),
    };
    const { escrowId } = await this.ledger.openEscrow(req);
    this.escrows.set(`${doc.meta.id} ${pipeline}`, { ...req, escrowId, closesAt: this.now() + this.challengeWindowMs, status: "open" });
  }

  /** Settle every escrow whose Challenge Window has closed. main.ts calls this every 5 s. */
  async tick(): Promise<void> {
    for (const [key, e] of this.escrows) {
      if (e.status !== "open" || this.now() < e.closesAt) continue;
      const [documentId, pipeline] = key.split(" ") as [string, string];
      if (this.challenges.undecided(documentId, pipeline)) continue; // wait for the Arbiter
      const s = slashes(e.bond, this.challenges.upheld(documentId, pipeline).length);
      e.status = "settling";
      try {
        if (s.length) await this.ledger.settleWithSlashes(e.escrowId, s);
        else await this.ledger.settleClean(e.escrowId);
        e.status = "settled";
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
    const e = this.escrows.get(`${documentId} ${pipeline}`);
    const delivered = d?.delivered.get(pipeline);
    if (!d || !e || !delivered) return { ok: false as const, reason: "not found" as const, error: "no delivered Document with that id" };
    if (e.status !== "open" || this.now() >= e.closesAt)
      return { ok: false as const, reason: "closed" as const, error: "the Challenge Window has closed" };
    const r = this.challenges.file({ documentId, pipeline, template: d.template, pages: d.text.length, delivered }, raw);
    return r.ok ? r : { ...r, reason: "invalid" as const };
  }

  documents(): DocumentMeta[] {
    return [...this.docs.values()].map((d) => d.meta);
  }

  /** What the Brand sees: every Template Field with its status and, once final, its value. */
  document(id: string) {
    const d = this.docs.get(id);
    if (!d) return undefined;
    const p = this.pipelines[0]!.name;
    const values = d.delivered.get(p) ?? d.progress.get(p) ?? [];
    const e = this.escrows.get(`${id} ${this.pipelines[0]!.name}`);
    return {
      id,
      template: d.template.name,
      uploadedAt: d.meta.uploadedAt,
      escrow: e && {
        operator: e.operator,
        bond: e.bond,
        fee: e.fee,
        outputHash: e.outputHash,
        status: e.status === "settled" ? ("settled" as const) : ("open" as const),
        msLeft: Math.max(0, e.closesAt - this.now()),
        ...(e.slashes && { slashes: e.slashes }),
      },
      fields: d.template.fields.map((f) => {
        const corrected = this.challenges.correction(id, this.pipelines[0]!.name, f.name);
        if (corrected) return { name: f.name, label: f.label, status: "final" as const, ...corrected };
        const { field: _, ...v } = values.find((v) => v.field === f.name) ?? { field: f.name, status: "converging" as const };
        if (v.status !== "not stated") return { name: f.name, label: f.label, ...v };
        const quoted = v.quotes.map((q) => `- page ${q.page}: "${q.quote}"`).join("\n");
        const supplierRequest =
          `Please confirm "${f.label}" for Document ${id} (${d.meta.template}).` +
          ` The Document does not state it clearly${quoted ? `; it says:\n${quoted}` : "."}\nPlease send the value, its unit and the page that states it, or a corrected Document.`;
        return { name: f.name, label: f.label, ...v, supplierRequest };
      }),
    };
  }

  async file(id: string): Promise<Uint8Array | undefined> {
    return (await this.storage.get(id))?.bytes;
  }
}
