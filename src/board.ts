// The Job Board: owns Documents, Jobs and Sieve results. Workers reach it through mcp.ts,
// the Brand through web.ts. It touches the outside world only through the Storage and Ledger adapters.
import { randomUUID } from "node:crypto";
import * as z from "zod";
import type { Ledger } from "./ledger.js";
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
const extractionResult = z.strictObject({ fields: z.array(z.union([stated, notStated])) });

export type FieldValue = z.infer<typeof stated> | z.infer<typeof notStated>;

export type SubmitOutcome = { ok: true } | { ok: false; error: string };

interface Doc {
  meta: DocumentMeta;
  template: Template;
  text: string[];
  /** Delivered Field values by Pipeline name. */
  delivered: Map<string, FieldValue[]>;
}

interface JobState {
  job: Job;
  pipeline: string;
  takenBy?: string;
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

  constructor(opts: { storage: Storage; ledger: Ledger; baseUrl: string; pipelines?: Pipeline[] }) {
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
    const s = this.jobs.find((j) => !j.done && !j.takenBy);
    if (!s) return null;
    s.takenBy = worker;
    return s.job;
  }

  submitJob(worker: string, jobId: string, result: unknown): SubmitOutcome {
    const s = this.jobs.find((j) => j.job.id === jobId);
    if (!s) return { ok: false, error: `unknown Job "${jobId}"` };
    if (s.takenBy !== worker) return { ok: false, error: `Job "${jobId}" is not taken by Worker "${worker}"` };
    if (s.done) return { ok: false, error: `Job "${jobId}" was already submitted` };
    const parsed = extractionResult.safeParse(result);
    if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
    s.done = true;
    this.docs.get(s.job.documentId)!.delivered.set(s.pipeline, parsed.data.fields);
    return { ok: true };
  }

  documents(): DocumentMeta[] {
    return [...this.docs.values()].map((d) => d.meta);
  }

  /** What the Brand sees: every Template Field with its delivered value, if any. */
  document(id: string) {
    const d = this.docs.get(id);
    if (!d) return undefined;
    const values = d.delivered.get(this.pipelines[0]!.name) ?? [];
    return {
      id,
      template: d.template.name,
      uploadedAt: d.meta.uploadedAt,
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
