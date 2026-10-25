// The Job Board: owns Documents, Jobs and Sieve results. Workers reach it through mcp.ts,
// the Brand through web.ts. It touches the outside world only through the Storage and Ledger adapters.
import { createHash, randomUUID } from "node:crypto";
import * as z from "zod";
import type { EscrowRequest, Ledger } from "./ledger.js";
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
  document: { url: string; text: string[] };
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

export type SubmitOutcome = { ok: true } | { ok: false; error: string };

interface Doc {
  meta: DocumentMeta;
  template: Template;
  text: string[];
  /** Delivered Field values by Pipeline name. */
  delivered: Map<string, FieldValue[]>;
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
}

interface JobState {
  job: Job;
  pipeline: string;
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
    this.docs.set(meta.id, { meta, template, text, delivered: new Map() });
    for (const p of this.pipelines) {
      const sieve = p.sieves[0]!;
      this.jobs.push({
        pipeline: p.name,
        done: false,
        job: {
          id: randomUUID(),
          documentId: meta.id,
          sieve: sieve.kind,
          view: sieve.view,
          instructions: sieve.instructions,
          template,
          document: { url: `${this.baseUrl}/documents/${meta.id}/file`, text },
        },
      });
    }
  }

  /** The next open Job for this Worker, or null when there is nothing yet. */
  nextJob(worker: string): Job | null {
    const now = this.now();
    const s = this.jobs.find((j) => !j.done && (!j.takenBy || now - j.takenAt! >= this.jobTimeoutMs));
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
    const parsed = extractionResult.safeParse(result);
    if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
    const doc = this.docs.get(s.job.documentId)!;
    const problems = checkAgainstTemplate(parsed.data.fields, doc.template, doc.text.length);
    if (problems.length) return { ok: false, error: problems.join("\n") };
    s.done = true;
    doc.delivered.set(s.pipeline, parsed.data.fields);
    try {
      await this.openEscrow(doc, s.pipeline, parsed.data.fields);
    } catch (e) {
      s.done = false;
      doc.delivered.delete(s.pipeline);
      return { ok: false, error: `could not open the escrow, try again: ${(e as Error).message}` };
    }
    return { ok: true };
  }

  /** Delivery: lock the Operator's Bond and the Brand's Fee behind a hash of the delivered Field values. */
  private async openEscrow(doc: Doc, pipeline: string, fields: FieldValue[]) {
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
    for (const e of this.escrows.values()) {
      if (e.status !== "open" || this.now() < e.closesAt) continue;
      // ponytail: no Challenges exist yet, so every closed window settles clean; slashes come with Challenges.
      e.status = "settling";
      try {
        await this.ledger.settleClean(e.escrowId);
        e.status = "settled";
      } catch (err) {
        e.status = "open";
        console.error(`settling escrow ${e.escrowId} failed:`, err);
      }
    }
  }

  documents(): DocumentMeta[] {
    return [...this.docs.values()].map((d) => d.meta);
  }

  /** What the Brand sees: every Template Field with its delivered value, if any. */
  document(id: string) {
    const d = this.docs.get(id);
    if (!d) return undefined;
    const values = d.delivered.get(this.pipelines[0]!.name) ?? [];
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
      },
      fields: d.template.fields.map((f) => {
        const { field: _, ...v } = values.find((v) => v.field === f.name) ?? { field: f.name };
        return { name: f.name, label: f.label, ...v };
      }),
    };
  }

  async file(id: string): Promise<Uint8Array | undefined> {
    return (await this.storage.get(id))?.bytes;
  }
}
