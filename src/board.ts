// The Job Board: owns Documents, Jobs and Sieve results. Workers reach it through mcp.ts,
// the Brand through web.ts. It touches the outside world only through the Storage and Ledger adapters.
import { createHash, randomUUID } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";
import * as z from "zod";
import { Challenges } from "./challenges.js";
import type {
  ApiChallenge, ApiConfig, ApiDocument, ApiDocumentSummary, ApiEscrow, ApiExport, ApiField, ApiJob, ApiLeaderRow, ApiPipelineView, ApiQuote,
  ApiSpan, ApiStation, ApiWorker, DocStatus,
} from "./api.js";
import type { Challenge } from "./challenges.js";
import { combinedSupplierRequest, compositionSum, converge, fold, formatValue, supplierRequest, valueKey, type FieldResult } from "./converge.js";
import { addUsdc, minUsdc, settlement, slashes, subUsdc, type EscrowRequest, type Ledger } from "./ledger.js";
import { quoteRects, readPdf, type TextItem } from "./pdf.js";
import { baseline, type Pipeline, type SieveKind, type View } from "./pipelines.js";
import type { DocumentMeta, Storage } from "./storage.js";
import { mustBe, rules, statedValue, templates, type Field, type Template } from "./templates.js";

/** A self-contained unit of work for one Sieve pass over one Document. Never carries other Sieves' values. */
export interface Job {
  id: string;
  documentId: string;
  sieve: SieveKind;
  /** The Sieve's label, e.g. "Markdown extraction". */
  label: string;
  view: View;
  instructions: string;
  template: Template;
  /** name: the uploaded file name. markdown: the Markdown to check (faithfulness Sieve) or the checked Markdown (Sieves that read Markdown). */
  document: { url: string; name: string; text: string[]; markdown?: string };
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

const short = z.string().trim().min(1).max(120);
const span = z
  .strictObject({
    id: short,
    parent: short.optional(),
    label: short,
    view: short,
    model: short,
    result: z.string().max(200).regex(/^[^\r\n]*$/, "result must be one line"),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative().optional(),
  })
  .refine((s) => s.end === undefined || s.end >= s.start, "end must not be before start");
type Span = z.infer<typeof span>;
const trace = z.array(span).max(200);

/** A Span's parent must come before it, so a Trace is always a tree. Returns one line per problem. */
function checkTrace(spans: Span[], done: boolean): string[] {
  const problems: string[] = [];
  spans.forEach((s, i) => {
    if (spans.findIndex((o) => o.id === s.id) !== i) problems.push(`Span "${s.id}" given more than once`);
    if (s.parent !== undefined && !spans.slice(0, i).some((o) => o.id === s.parent))
      problems.push(`Span "${s.id}": parent "${s.parent}" must be a Span reported before it`);
    if (done && s.end === undefined) problems.push(`Span "${s.id}": a delivered Trace needs an end on every Span`);
  });
  return problems;
}

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
  /** Outside Operators' claims, by their Stellar address (which is also their Pipeline's name). */
  claims: Map<string, Claim>;
}

/**
 * An outside Operator's claim on a whole Document. Its Pipeline is a black box named by its address.
 * step: what the transaction waiting for its signature does (bond, delivery), or where the claim is (claimed, delivered).
 */
interface Claim {
  operator: string;
  label: string;
  escrowId: string;
  step: "bond" | "claimed" | "delivery" | "delivered";
  /** The transaction waiting for the Operator's signature. */
  xdr?: string;
  claimedAt?: number;
  /** The validated Fields waiting for the Operator to sign their output hash. */
  fields?: FieldResult[];
  link?: string;
  /** Its self-reported Trace: Spans from report_span, replaced by the one it delivers with. */
  trace?: Span[];
}

/** The one station shown for an outside Operator's Pipeline: how it works inside is its own business. */
const blackBox: Pipeline["sieves"] = [{ kind: "extract", label: "Black box", view: "original", instructions: "" }];

/** What an outside Operator delivers: the extraction result shape our Sieves hand in. */
const outsideInstructions = baseline.sieves[0]!.instructions.replace(/result\.fields/, "deliver's `fields`");

/** What an Operator puts up and is paid per Document, in USDC decimal strings. */
export interface OperatorTerms {
  operator: string;
  bond: string;
  fee: string;
}

/** sha256 of what one Pipeline delivered for one Document, so every Operator's escrow records its own hash, even for equal values. */
const outputHash = (documentId: string, pipeline: string, fields: FieldResult[]) =>
  createHash("sha256").update(JSON.stringify({ documentId, pipeline, fields })).digest("hex");

/** One escrow per (Document, Pipeline). */
const escrowKey = (documentId: string, pipeline: string) => JSON.stringify([documentId, pipeline]);

interface Escrow extends EscrowRequest {
  pipeline: string;
  escrowId: string;
  /** Delivery. */
  openedAt: number;
  /** When the Challenge Window started running: at delivery, or (demo window) when the Brand first opened the Document. */
  startedAt?: number;
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
  private demoWindow: boolean;
  private challengeDeposit: string;
  private arbiterFee: string;
  /** Keyed by escrowKey(documentId, pipeline). */
  private escrows = new Map<string, Escrow>();
  readonly challenges: Challenges;
  /** When each Worker last asked for or handed in a Job. */
  private workersSeen = new Map<string, number>();
  /** What each Worker said about itself in register_worker. In memory: after a restart, ids are accepted unregistered. */
  private registered = new Map<string, { harness?: string; label?: string }>();
  private lastWorkerNo = 0;
  readonly brand: Brand;
  /** Long-polls waiting for work; notify() wakes them all to try again. */
  private wakers = new Set<() => void>();
  private setTimer: (ms: number, fn: () => void) => () => void;

  constructor(opts: {
    storage: Storage;
    ledger: Ledger;
    baseUrl: string;
    pipelines?: Pipeline[];
    /** Milliseconds since the epoch; tests inject a fake one. */
    now?: () => number;
    /** Start a timer, returning its cancel; tests run it on the fake clock. Default: setTimeout. */
    setTimer?: (ms: number, fn: () => void) => () => void;
    /** How long a Worker may hold a Job before it goes back on the board. */
    jobTimeoutMs?: number;
    /** Bond and Fee by Pipeline name. A Pipeline not listed is run by an Operator of the same name for 10 + 1 USDC. */
    operators?: Record<string, OperatorTerms>;
    challengeWindowMs?: number;
    /** Demo: the Challenge Window starts when the Brand opens the Document and pauses while a Challenge is undecided. */
    demoWindow?: boolean;
    /** What a challenger locks to file a Challenge, USDC. Default 1. */
    challengeDeposit?: string;
    /** What the Arbiter earns per decision, out of the Slash when upheld (at most the Slash), USDC. Default 0.1. */
    arbiterFee?: string;
    brand?: Brand;
  }) {
    this.now = opts.now ?? Date.now;
    this.setTimer = opts.setTimer ?? ((ms, fn) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    });
    this.challenges = new Challenges(this.now);
    this.brand = opts.brand ?? { name: "Voltaris", reviewer: "Inês Duarte" };
    this.jobTimeoutMs = opts.jobTimeoutMs ?? 10 * 60_000;
    this.operators = opts.operators ?? {};
    this.challengeWindowMs = opts.challengeWindowMs ?? 5 * 60_000;
    this.demoWindow = opts.demoWindow ?? false;
    this.challengeDeposit = addUsdc(opts.challengeDeposit ?? "1");
    this.arbiterFee = addUsdc(opts.arbiterFee ?? "0.1");
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
    this.docs.set(meta.id, { meta, template, text, items, rects: new Map(), delivered: new Map(), progress: new Map(), claims: new Map() });
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
        label: sieve.label,
        view: sieve.view,
        instructions: sieve.instructions,
        template: fields ? { ...d.template, fields: d.template.fields.filter((f) => fields.includes(f.name)) } : d.template,
        document: { url: d.meta.link ?? `${this.baseUrl}/documents/${documentId}/file`, name: d.meta.name, text: d.text, ...(markdown !== undefined && { markdown }) },
      },
    });
    this.notify();
  }

  private notify() {
    for (const wake of [...this.wakers]) wake();
  }

  /**
   * Long-poll: try `take` now, then again each time work may have appeared (a Job posted, a Job or claim timing out),
   * until it gives something or `waitSec` (capped at 25) runs out. An aborted wait returns empty without trying again.
   */
  private async waitFor<T>(take: () => T, empty: (t: T) => boolean, waitSec = 0, signal?: AbortSignal): Promise<T> {
    const until = this.now() + Math.min(Math.max(waitSec, 0), 25) * 1000;
    for (;;) {
      const t = take();
      if (!empty(t) || this.now() >= until) return t;
      await this.changed(Math.min(until, this.nextExpiry()) - this.now(), signal);
      if (signal?.aborted) return t;
    }
  }

  /** Resolves on notify(), after `ms`, or on abort, whichever comes first. */
  private changed(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => {
        this.wakers.delete(wake);
        cancel();
        signal?.removeEventListener("abort", wake);
        resolve();
      };
      this.wakers.add(wake);
      const cancel = this.setTimer(Math.max(ms, 0), wake);
      signal?.addEventListener("abort", wake);
      if (signal?.aborted) wake();
    });
  }

  /** When the next taken Job or claim runs past the Job timeout and frees up work (past ones already have). */
  private nextExpiry(): number {
    const now = this.now();
    const ats = [
      ...this.jobs.filter((j) => j.takenBy && !j.done).map((j) => j.takenAt!),
      ...[...this.docs.values()].flatMap((d) => [...d.claims.values()].filter((c) => c.step === "claimed").map((c) => c.claimedAt!)),
    ].map((t) => t + this.jobTimeoutMs);
    return Math.min(Infinity, ...ats.filter((t) => t > now));
  }

  /** next_job with `wait`: the next Job, waiting up to `waitSec` (max 25) for one; null when none came. */
  waitJob(worker: string, waitSec?: number, signal?: AbortSignal): Promise<Job | null> {
    return this.waitFor(() => this.nextJob(worker), (j) => j === null, waitSec, signal);
  }

  /** list_open_documents with `wait`: as openDocuments, waiting up to `waitSec` (max 25) for one to open. */
  waitOpenDocuments(operator: string, waitSec?: number, signal?: AbortSignal) {
    return this.waitFor(() => this.openDocuments(operator), (ds) => ds.length === 0, waitSec, signal);
  }

  /** The Markdown a passing faithfulness check approved, if any (the Brand's Source Markdown). */
  private checkedMarkdown(pipeline: string, documentId: string): string | undefined {
    const jobs = this.jobsOf(pipeline, documentId);
    const passed = jobs.findLastIndex((j) => j.pass === true);
    return passed < 0 ? undefined : jobs.slice(0, passed).findLast((j) => j.markdown !== undefined)?.markdown;
  }

  /** The last Markdown handed in for this Document and Pipeline; checked once a faithfulness Sieve after it passed. */
  private latestMarkdown(pipeline: string, documentId: string): string | undefined {
    return this.jobs.findLast((j) => j.pipeline === pipeline && j.job.documentId === documentId && j.markdown !== undefined)?.markdown;
  }

  /** Sieves stay independent: a Worker does at most one extraction Sieve per Document, across every Pipeline. */
  private didExtraction(worker: string, j: JobState): boolean {
    return this.jobs.some((o) => o !== j && o.takenBy === worker && o.job.documentId === j.job.documentId && extracts(o.job.sieve));
  }

  /**
   * A Worker's id for its shift: `worker` back when it reconnects with the id it was given, else a fresh "w<n>" no
   * Worker has used. Synchronous, so concurrent registrations never share one.
   */
  registerWorker({ worker, harness, label }: { worker?: string; harness?: string; label?: string } = {}): string {
    let id = worker;
    if (!id) do id = `w${++this.lastWorkerNo}`; while (this.workersSeen.has(id) || this.registered.has(id));
    const before = this.registered.get(id);
    this.registered.set(id, { ...before, ...(harness && { harness }), ...(label && { label }) });
    this.workersSeen.set(id, this.now());
    return id;
  }

  /** "w3 · OpenCode", or the bare id when the Worker named no harness. */
  workerLabel(id: string): string {
    const h = this.registered.get(id)?.harness;
    return h ? `${id} · ${h}` : id;
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
      outputHash: outputHash(doc.meta.id, pipeline, fields),
    };
    const { escrowId, link } = await this.ledger.openEscrow(req);
    this.escrows.set(escrowKey(doc.meta.id, pipeline), {
      ...req,
      pipeline,
      escrowId,
      ...(link && { link }),
      openedAt: this.now(),
      ...(!this.demoWindow && { startedAt: this.now() }),
      status: "open",
    });
  }

  // Outside Operators: claim_document, deliver and submit_signed in mcp.ts. Each claim is a Pipeline named by the
  // Operator's address, with one escrow per (Document, Operator) like ours. After delivery, Challenges, the Arbiter
  // and settlement treat it exactly like ours.

  /** Our Pipelines, then the outside Operators' that are claimed and not expired. */
  private pipelinesOf(d: Doc): Pipeline[] {
    return [...this.pipelines, ...[...d.claims.values()].filter((c) => this.active(c)).map((c) => ({ name: c.operator, label: c.label, sieves: blackBox }))];
  }

  /** Every Pipeline that has run on any Document. */
  private allPipelines(): Pipeline[] {
    const seen = new Map(this.pipelines.map((p) => [p.name, p]));
    for (const d of this.docs.values()) for (const p of this.pipelinesOf(d)) if (!seen.has(p.name)) seen.set(p.name, p);
    return [...seen.values()];
  }

  /** Bond in and not past the claim timeout (the Job timeout) without delivering. */
  private active(c: Claim): boolean {
    if (c.step === "bond") return false;
    return c.step === "delivered" || this.now() - c.claimedAt! < this.jobTimeoutMs;
  }

  /** Documents an outside Operator may claim: values not shown yet (so nothing to copy), not already claimed by it. */
  openDocuments(operator: string) {
    return [...this.docs.values()]
      .filter((d) => this.withheld(d) && !(d.claims.get(operator) && this.active(d.claims.get(operator)!)))
      .map((d) => ({
        id: d.meta.id,
        name: d.meta.name,
        supplier: d.meta.supplier,
        template: d.template,
        url: d.meta.link ?? `${this.baseUrl}/documents/${d.meta.id}/file`,
        text: d.text,
        ...this.terms(operator),
        instructions: outsideInstructions,
      }));
  }

  private outsideError(operator: string, documentId: string): string | undefined {
    if (!StrKey.isValidEd25519PublicKey(operator)) return `operator must be your Stellar testnet address (G...), not "${operator}"`;
    if (!this.ledger.prepareBond) return "this Job Board's Ledger takes no outside Operators (start it with LEDGER=fake or trustless-work)";
    if (!this.docs.has(documentId)) return `unknown Document "${documentId}"`;
  }

  /** Claim a Document: returns the transaction that locks the Operator's Bond, for it to sign and hand in with submitSigned. */
  async claim(operator: string, documentId: string, label?: string): Promise<{ ok: true; xdr: string } | { ok: false; error: string }> {
    const err = this.outsideError(operator, documentId);
    if (err) return { ok: false, error: err };
    const d = this.docs.get(documentId)!;
    const c = d.claims.get(operator);
    if (c?.step === "bond") return { ok: true, xdr: c.xdr! };
    if (c && this.active(c)) return { ok: false, error: `you already claimed Document "${documentId}"` };
    if (!this.withheld(d)) return { ok: false, error: `Document "${documentId}" is no longer open: every Pipeline has delivered it` };
    const { bond, fee } = this.terms(operator);
    const have = await this.ledger.usdcBalance!(operator);
    const short = subUsdc(bond, have);
    if (short !== "0")
      return {
        ok: false,
        error: `claim refused: ${operator} holds ${have} USDC on Stellar testnet and the Bond is ${bond} USDC. Add at least ${short} USDC to it, then claim again.`,
      };
    try {
      const { escrowId, xdr } = await this.ledger.prepareBond!({ documentId, operator, brand: d.meta.uploader, bond, fee });
      d.claims.set(operator, { operator, label: label?.trim() || `Operator ${operator.slice(0, 4)}…${operator.slice(-4)}`, escrowId, step: "bond", xdr });
      return { ok: true, xdr };
    } catch (e) {
      return { ok: false, error: `could not open the escrow, try again: ${(e as Error).message}` };
    }
  }

  /** Validate the Fields like an extraction Sieve's, plus every quote must be in the text; returns the transaction recording their hash. */
  async deliverOutside(
    operator: string, documentId: string, result: unknown, rawTrace?: unknown,
  ): Promise<{ ok: true; xdr: string } | { ok: false; error: string }> {
    const c = this.workingClaim(operator, documentId);
    if (typeof c === "string") return { ok: false, error: c };
    const d = this.docs.get(documentId)!;
    const parsed = extractionResult.safeParse(result);
    if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
    const spans = rawTrace === undefined ? undefined : trace.safeParse(rawTrace);
    if (spans && !spans.success) return { ok: false, error: `trace: ${z.prettifyError(spans.error)}` };
    const problems = checkAgainstTemplate(parsed.data.fields, d.template, d.text.length);
    if (spans) problems.push(...checkTrace(spans.data, true).map((p) => `trace: ${p}`));
    const text = fold(d.text.join(" "));
    // ponytail: a scan has no text layer, so its quotes go unchecked here; check them against Markdown if outside Operators take scans.
    if (text)
      for (const v of parsed.data.fields)
        if ("quote" in v && !text.includes(fold(v.quote))) problems.push(`Field "${v.field}": quote not found in the Document's text: "${v.quote}"`);
    if (problems.length) return { ok: false, error: problems.join("\n") };
    const fields = converge(d.template, [parsed.data.fields], d.text);
    try {
      const { xdr } = await this.ledger.prepareDelivery!(c.escrowId, outputHash(documentId, operator, fields));
      Object.assign(c, { step: "delivery", xdr, fields, ...(spans && { trace: spans.data }) });
      return { ok: true, xdr };
    } catch (e) {
      return { ok: false, error: `could not prepare the delivery, try again: ${(e as Error).message}` };
    }
  }

  /** The claim an outside Operator is still working on, or why there is none. */
  private workingClaim(operator: string, documentId: string): Claim | string {
    const err = this.outsideError(operator, documentId);
    if (err) return err;
    const c = this.docs.get(documentId)!.claims.get(operator);
    if (!c || c.step === "bond") return `claim Document "${documentId}" first (claim_document, then submit_signed)`;
    if (c.step === "delivered") return `you already delivered Document "${documentId}"`;
    if (!this.active(c)) return `your claim on Document "${documentId}" expired before you delivered`;
    return c;
  }

  /** report_span: add a Span to the claim's Trace while working, or replace the one with the same id (to end it). */
  reportSpan(operator: string, documentId: string, raw: unknown): SubmitOutcome {
    const c = this.workingClaim(operator, documentId);
    if (typeof c === "string") return { ok: false, error: c };
    const parsed = span.safeParse(raw);
    if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
    const spans = [...(c.trace ?? [])];
    const at = spans.findIndex((s) => s.id === parsed.data.id);
    if (at >= 0) spans[at] = parsed.data;
    else spans.push(parsed.data);
    const problems = checkTrace(spans, false);
    if (spans.length > 200) problems.push("a Trace holds at most 200 Spans");
    if (problems.length) return { ok: false, error: problems.join("\n") };
    c.trace = spans;
    return { ok: true };
  }

  /** Hand in the transaction claim or deliver returned, signed by the Operator's key. */
  async submitSigned(operator: string, documentId: string, signedXdr: string): Promise<{ ok: true; done: string } | { ok: false; error: string }> {
    const err = this.outsideError(operator, documentId);
    if (err) return { ok: false, error: err };
    const d = this.docs.get(documentId)!;
    const c = d.claims.get(operator);
    if (!c || (c.step !== "bond" && c.step !== "delivery")) return { ok: false, error: `nothing waiting for your signature on Document "${documentId}"` };
    if (c.step === "bond" && !this.withheld(d)) return { ok: false, error: `Document "${documentId}" is no longer open: every Pipeline has delivered it` };
    if (c.step === "delivery" && !this.active(c)) return { ok: false, error: `your claim on Document "${documentId}" expired before you delivered` };
    let link: string | undefined;
    try {
      ({ link } = await this.ledger.submitSigned!(c.escrowId, signedXdr));
    } catch (e) {
      return { ok: false, error: `rejected: ${(e as Error).message}` };
    }
    delete c.xdr;
    if (c.step === "bond") {
      Object.assign(c, { step: "claimed", claimedAt: this.now(), ...(link && { link }) });
      return { ok: true, done: `claimed: your Bond is locked. Deliver within ${Math.round(this.jobTimeoutMs / 60_000)} min with deliver.` };
    }
    const fields = c.fields!;
    delete c.fields;
    c.step = "delivered";
    d.delivered.set(operator, fields);
    const { bond, fee } = this.terms(operator);
    this.escrows.set(escrowKey(documentId, operator), {
      documentId, operator, brand: d.meta.uploader, bond, fee, outputHash: outputHash(documentId, operator, fields), pipeline: operator, escrowId: c.escrowId,
      ...(c.link && { link: c.link }),
      openedAt: this.now(),
      ...(!this.demoWindow && { startedAt: this.now() }),
      status: "open",
    });
    return { ok: true, done: `delivered: the Challenge Window is open for ${Math.round(this.challengeWindowMs / 60_000)} min, then the escrow settles` };
  }

  /** Settle every escrow whose Challenge Window has closed (only those of Documents `only` picks). main.ts calls this every 5 s. */
  async tick(only: (documentId: string) => boolean = () => true): Promise<void> {
    for (const e of this.escrows.values()) {
      if (e.status !== "open" || this.window(e).msLeft > 0 || !only(e.documentId)) continue;
      const { documentId, pipeline } = e;
      if (this.challenges.undecided(documentId, pipeline)) continue; // wait for the Arbiter
      const s = slashes(e.bond, this.challenges.upheld(documentId, pipeline).length);
      const deposits = this.challenges.of(documentId, pipeline).map((c) => ({ challenger: c.challenger, amount: c.deposit, upheld: c.decision === "upheld" }));
      e.status = "settling";
      try {
        const { link } = deposits.length
          ? await this.ledger.settleWithSlashes(e.escrowId, s, deposits, this.arbiterFee)
          : await this.ledger.settleClean(e.escrowId);
        e.status = "settled";
        if (link) e.settlementLink = link;
        if (s.length) e.slashes = s;
      } catch (err) {
        e.status = "open";
        console.error(`settling escrow ${e.escrowId} failed:`, err);
      }
    }
  }

  /**
   * Where an escrow's Challenge Window stands. It runs from startedAt; with the demo window it waits until the Brand
   * opens the Document and pauses while a Challenge on it is undecided. closesAt only moves while paused.
   */
  private window(e: Escrow): { closesAt: number; msLeft: number; paused?: "until opened" | "challenge open" } {
    const now = this.now();
    if (e.startedAt === undefined) return { closesAt: now + this.challengeWindowMs, msLeft: this.challengeWindowMs, paused: "until opened" };
    let paused = 0;
    if (this.demoWindow) {
      // Total time with at least one Challenge undecided since the window started (union of [filed, decided]).
      let end = e.startedAt;
      const spans = this.challenges.of(e.documentId, e.pipeline).map((c) => [Math.max(c.filedAt, e.startedAt!), c.decidedAt ?? now] as const).sort((a, b) => a[0] - b[0]);
      for (const [a, b] of spans) if (b > end) (paused += b - Math.max(a, end)), (end = b);
    }
    const closesAt = e.startedAt + this.challengeWindowMs + paused;
    const msLeft = e.status === "settled" ? 0 : Math.max(0, closesAt - now);
    const held = this.demoWindow && msLeft > 0 && this.challenges.undecided(e.documentId, e.pipeline);
    return { closesAt, msLeft, ...(held && { paused: "challenge open" as const }) };
  }

  /** The Brand opened the Document: with the demo window, its delivered escrows' Challenge Windows start now (once). */
  open(documentId: string): boolean {
    const d = this.docs.get(documentId);
    if (!d) return false;
    if (this.withheld(d)) return true;
    for (const e of this.escrows.values()) if (e.documentId === documentId && e.startedAt === undefined) e.startedAt = this.now();
    return true;
  }

  /** The open escrow a Challenge can be filed against, or why not. */
  private challengeable(documentId: string, pipeline: string) {
    const d = this.docs.get(documentId);
    const e = this.escrows.get(escrowKey(documentId, pipeline));
    const delivered = d?.delivered.get(pipeline);
    if (!d || !e || !delivered) return { ok: false as const, reason: "not found" as const, error: "no delivered Document with that id" };
    if (e.status !== "open" || this.window(e).msLeft <= 0)
      return { ok: false as const, reason: "closed" as const, error: "the Challenge Window has closed" };
    // The values are not shown yet, and the Arbiter's view would show them.
    if (this.withheld(d)) return { ok: false as const, reason: "closed" as const, error: "another Pipeline is still extracting this Document" };
    return { ok: true as const, d, e, delivered };
  }

  /**
   * File a Challenge against a delivered Field, only while its Challenge Window is open, once its Challenge Deposit
   * is locked. `challenger` defaults to the Brand, whose key the Ledger holds; any other challenger is a Stellar
   * address and passes `depositXdr`: the transaction from prepareDeposit, signed with its key.
   */
  async challenge(documentId: string, raw: unknown, pipeline = this.pipelines[0]!.name) {
    const t = this.challengeable(documentId, pipeline);
    if (!t.ok) return t;
    const { challenger = t.d.meta.uploader, depositXdr, ...rest } = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (typeof challenger !== "string" || !challenger || (depositXdr !== undefined && typeof depositXdr !== "string"))
      return { ok: false as const, reason: "invalid" as const, error: "challenger and depositXdr must be strings" };
    const deposit = this.challengeDeposit;
    const r = this.challenges.check({ documentId, pipeline, template: t.d.template, text: t.d.text, delivered: t.delivered }, rest, { challenger, deposit });
    if (!r.ok) return { ...r, reason: "invalid" as const };
    // One Challenge per Field (per Operator): a second never replaces or resets the first.
    if (this.challenges.of(documentId, pipeline).some((c) => c.field === r.challenge.field))
      return { ok: false as const, reason: "challenged" as const, error: `Field "${r.challenge.field}" is already Challenged; it takes one Challenge` };
    // Filed first, so settlement waits for it (and returns its Deposit) even if the Window closes while it locks.
    this.challenges.add(r.challenge);
    try {
      await this.ledger.lockDeposit(t.e.escrowId, { challenger, amount: deposit, ...(depositXdr && { signedXdr: depositXdr }) });
    } catch (err) {
      this.challenges.remove(r.challenge.id);
      return { ok: false as const, reason: "deposit" as const, error: `the Challenge Deposit of ${deposit} USDC was not locked: ${(err as Error).message}` };
    }
    return r;
  }

  /** For a challenger that signs its own Deposit: the unsigned transaction to sign and pass as depositXdr. */
  async prepareDeposit(documentId: string, challenger: unknown, pipeline = this.pipelines[0]!.name) {
    const t = this.challengeable(documentId, pipeline);
    if (!t.ok) return t;
    if (typeof challenger !== "string" || !challenger) return { ok: false as const, reason: "invalid" as const, error: "challenger must be a Stellar address" };
    try {
      const { xdr } = await this.ledger.prepareDeposit(t.e.escrowId, challenger, this.challengeDeposit);
      return { ok: true as const, xdr, amount: this.challengeDeposit };
    } catch (err) {
      return { ok: false as const, reason: "invalid" as const, error: (err as Error).message };
    }
  }

  documents(): DocumentMeta[] {
    return [...this.docs.values()].map((d) => d.meta);
  }

  /** What the Brand sees: every Template Field with its status and, once final, its value. Top level is the first Pipeline's. */
  document(id: string) {
    const d = this.docs.get(id);
    if (!d) return undefined;
    const pipelines = Object.fromEntries(this.pipelinesOf(d).map((p) => [p.name, this.view(d, p.name)]));
    return { id, template: d.template.name, uploadedAt: d.meta.uploadedAt, ...pipelines[this.pipelines[0]!.name]!, pipelines };
  }

  /**
   * Sieve independence: every Worker can read the Brand's API, so no value, quote or box of a Document is shown
   * until every Pipeline has delivered it (no extraction Job for it can be open or still to come).
   */
  private withheld(d: Doc): boolean {
    return this.pipelinesOf(d).some((p) => !d.delivered.has(p.name));
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
    const w = this.window(e);
    const upheld = this.challenges.upheld(e.documentId, e.pipeline).length;
    const status: DocStatus =
      e.status === "settled" ? "settled" : w.msLeft <= 0 && this.challenges.undecided(e.documentId, e.pipeline) ? "awaiting arbiter" : "delivered";
    return {
      operator: e.operator,
      bond: e.bond,
      bondLeft: subUsdc(e.bond, addUsdc(...slashes(e.bond, upheld))),
      fee: e.fee,
      outputHash: e.outputHash,
      status,
      openedAt: e.openedAt,
      ...w,
      upheld,
      ...(e.slashes && { slashes: e.slashes }),
      ...(e.link && { link: e.link }),
      ...(e.settlementLink && { settlementLink: e.settlementLink }),
    };
  }

  private summary(d: Doc): ApiDocumentSummary {
    const pipelines = Object.fromEntries(
      this.pipelinesOf(d).map((p) => {
        const e = this.escrows.get(escrowKey(d.meta.id, p.name));
        const es = this.entries(d, p.name);
        const n = (s: string) => es.filter(({ v }) => v.status === s).length;
        const challenged = new Set(this.challenges.of(d.meta.id, p.name).filter((c) => c.decision !== "rejected").map((c) => c.field)).size;
        const counts = { final: n("final"), notStated: n("not stated"), converging: es.length - n("final") - n("not stated"), challenged };
        const status = d.delivered.has(p.name) && e ? this.escrowView(e).status : "processing";
        const settled = e?.status === "settled";
        const brandShare = settled && e.slashes ? settlement(e, e.slashes, [], this.arbiterFee).escrow.filter((x) => x.to === "brand") : [];
        const bond = e && (settled ? (e.slashes ? "slashed" : "released") : "locked") as "slashed" | "released" | "locked";
        return [p.name, { status, ...(e && this.window(e)), counts, ...(bond && { bond }), ...(brandShare.length && { received: addUsdc(...brandShare.map((x) => x.amount)) }) }];
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
    const claim = d.claims.get(p.name);
    if (claim) {
      const e = this.escrows.get(escrowKey(d.meta.id, p.name));
      const meta = delivered ? `${d.delivered.get(p.name)!.filter((v) => v.status === "final").length} values` : "";
      return [{ index: 0, kind: "extract", label: "Black box", state: delivered ? "done" : "run", worker: p.name, takenAt: claim.claimedAt!, ...(e && { doneAt: e.openedAt }), attempt: 1, meta }];
    }
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

  /**
   * The Pipeline's Trace. Ours: one Span per Sieve whose Job a Worker has taken, its result the station's counts.
   * An outside Operator's: what it reported, its result text held back while the values are (it could quote them).
   */
  private trace(d: Doc, p: Pipeline, withheld: boolean): { trace?: ApiSpan[] } {
    const claim = d.claims.get(p.name);
    if (claim) return claim.trace ? { trace: claim.trace.map(({ result, ...s }) => (withheld ? s : { ...s, result })) } : {};
    const stations = this.stations(d, p);
    return {
      trace: p.sieves.flatMap((s, i) => {
        const st = stations[i]!;
        if (st.takenAt === undefined || !st.worker) return [];
        return [{ id: `sieve-${i}`, label: s.label, view: s.view, model: this.workerLabel(st.worker),...(st.meta && { result: st.meta }), start: st.takenAt, ...(st.doneAt !== undefined && { end: st.doneAt }) }];
      }),
    };
  }

  private challengeSummary(c: Challenge) {
    return { id: c.id, status: c.decision ?? ("filed" as const), value: formatValue(c), page: c.page, quote: c.quote };
  }

  private apiField(d: Doc, pipeline: string, { f, v, was }: { f: Field; v: Entry; was?: string }, withheld: boolean): ApiField {
    const tie = this.jobsOf(pipeline, d.meta.id).find((j) => j.job.sieve === "tiebreak");
    const c = this.challenges.of(d.meta.id, pipeline).findLast((c) => c.field === f.name);
    const base = { name: f.name, label: f.label, section: f.section, author: f.author, tieBreak: !!tie?.job.template.fields.some((t) => t.name === f.name), ...(c && { challenge: this.challengeSummary(c) }) };
    if (v.status === "converging" || v.status === "disagreeing") return { ...base, status: "converging" };
    if (withheld) return { ...base, status: v.status, withheld: true };
    if (v.status === "not stated")
      return {
        ...base,
        status: v.status,
        quotes: v.quotes.map((q) => this.quote(d, q.page, q.quote)),
        ...(f.author === "Supplier" && { supplierRequest: supplierRequest(f, d.meta, v.quotes) }),
      };
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
    if (this.withheld(d) || this.pipelinesOf(d).length < 2) return [];
    const keyed = this.pipelinesOf(d).map((p) => this.entries(d, p.name));
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
    const views = this.pipelinesOf(d).map((p): ApiPipelineView => {
      const e = this.escrows.get(escrowKey(id, p.name));
      const entries = this.entries(d, p.name);
      const notStated = withheld ? [] : entries.flatMap(({ f, v }) => (v.status === "not stated" ? [{ f, quotes: v.quotes }] : []));
      const request = combinedSupplierRequest(d.meta, notStated);
      return {
        pipeline: p.name,
        label: p.label ?? p.name,
        operator: this.terms(p.name).operator,
        stations: this.stations(d, p),
        ...this.trace(d, p, withheld),
        ...(e && { deliveredAt: e.openedAt, escrow: this.escrowView(e) }),
        ...(!withheld && { markdown: this.checkedMarkdown(p.name, id) }),
        fields: entries.map((x) => this.apiField(d, p.name, x, withheld)),
        ...(request && { supplierRequest: request }),
        brandToProvide: notStated.filter(({ f }) => f.author === "Brand").map(({ f }) => f.name),
      };
    });
    return { ...this.summary(d), fileUrl: `/documents/${id}/file`, ...(d.meta.link && { storageLink: d.meta.link }), views, differs: this.differs(d) };
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
      ...(this.demoWindow && { demoWindow: true }),
      challengeDeposit: this.challengeDeposit,
      arbiterFee: this.arbiterFee,
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
    const p = this.allPipelines().find((p) => p.name === c.pipeline)!;
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
      ...this.window(e),
      delivered:
        was.status === "final"
          ? { display: formatValue(was), evidence: this.quote(d, was.page, was.quote, was) }
          : { display: was.status === "not stated" ? "Not stated" : "Sieves disagree" },
      claim: { display: formatValue(c), evidence: this.quote(d, c.page, c.quote, c) },
      slash: slashes(e.bond, 1)[0]!,
      challenger: c.challenger,
      deposit: c.deposit,
      ...(c.decision && { arbiterFee: this.earned(c) }),
    };
  }

  /** What the Arbiter earns for deciding c: the Deposit if rejected, the Arbiter Fee (at most the Slash) if upheld. */
  private earned(c: Challenge): string {
    // ponytail: assumes the Slash of one tenth; Slashes past the cap (10 upheld) are 0 and so is their fee at settlement.
    return c.decision === "rejected" ? c.deposit : minUsdc(this.arbiterFee, slashes(this.escrows.get(escrowKey(c.documentId, c.pipeline))!.bond, 1)[0]!);
  }

  /** The Arbiter's desk: open Challenges oldest first, decided ones newest first. */
  arbiter() {
    const all = this.challenges.all();
    const decided = all.filter((c) => c.decision).sort((a, b) => b.decidedAt! - a.decidedAt!);
    return {
      open: all.filter((c) => !c.decision).map((c) => this.apiChallenge(c)),
      decided: decided.map((c) => this.apiChallenge(c)),
      record: {
        decided: decided.length,
        upheld: decided.filter((c) => c.decision === "upheld").length,
        rejected: decided.filter((c) => c.decision === "rejected").length,
        earned: addUsdc(...decided.map((c) => this.earned(c))),
      },
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
          ...this.registered.get(name),
          lastSeen,
          live: now - lastSeen < 60_000,
          ...(cur && { current: { jobId: cur.job.id, sieve: this.sieveOf(cur).label, documentName: this.docs.get(cur.job.documentId)!.meta.name } }),
          doneToday: this.jobs.filter((j) => j.takenBy === name && j.doneAt !== undefined && j.doneAt >= today).length,
        };
      });
  }

  /** Per Operator, in Pipeline order: the Ledger's record plus what the board knows. accuracy is added by web.ts. */
  async leaderboard(): Promise<ApiLeaderRow[]> {
    const ops = [...new Set(this.allPipelines().map((p) => this.terms(p.name).operator))];
    return Promise.all(
      ops.map(async (operator) => {
        const ps = this.allPipelines().filter((p) => this.terms(p.name).operator === operator);
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
            ...(e.link && { link: e.link }),
            ...(e.settlementLink && { settlementLink: e.settlementLink }),
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
        msLeft: this.window(e).msLeft,
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
        return { name: f.name, label: f.label, ...v, ...(f.author === "Supplier" && { supplierRequest: supplierRequest(f, d.meta, v.quotes) }) };
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
