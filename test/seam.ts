// The one test seam: a Job Board with fake adapters, driven through its MCP tools (as Workers)
// and its web API (as the Brand and the Arbiter), all in process.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type {
  ApiArbiter, ApiChallenge, ApiConfig, ApiDocument, ApiDocumentSummary, ApiField, ApiJob, ApiLeaderRow, ApiPipelineView, ApiTemplate, ApiWorker,
} from "../src/api.js";
import { JobBoard, type Job, type OperatorTerms } from "../src/board.js";
import type { Pipeline } from "../src/pipelines.js";
import { InMemoryStorage } from "../src/storage.js";
import { FakeLedger } from "../src/ledger.js";
import { buildMcpServer } from "../src/mcp.js";
import { webApp, type WebOptions } from "../src/web.js";

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
/** An ApiField with every variant's keys optional, so tests read them without narrowing. */
export type Field = Pick<ApiField, "name" | "label" | "tieBreak" | "status"> &
  Partial<Omit<UnionToIntersection<ApiField>, "name" | "label" | "tieBreak" | "status">>;
type PipelineView = Omit<ApiPipelineView, "fields"> & { fields: Field[] };

export function startBoard(
  opts: {
    jobTimeoutMs?: number;
    pipelines?: Pipeline[];
    operators?: Record<string, OperatorTerms>;
    challengeWindowMs?: number;
    /** Have the fake Ledger give explorer links under this base URL; without it, it gives none. */
    explorer?: string;
    web?: WebOptions;
  } = {},
) {
  const { explorer, web: webOpts, ...boardOpts } = opts;
  const storage = new InMemoryStorage();
  const ledger = new FakeLedger(explorer);
  let time = 0;
  const clock = { advance: (ms: number) => void (time += ms) };
  const board = new JobBoard({ storage, ledger, baseUrl: "http://board.test", now: () => time, ...boardOpts });
  const web = webApp(board, webOpts);

  async function worker(name: string) {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await buildMcpServer(board).connect(serverT);
    const client = new Client({ name, version: "0" });
    await client.connect(clientT);
    return {
      async nextJob(): Promise<Job | null> {
        const r = await client.callTool({ name: "next_job", arguments: { worker: name } });
        if (r.isError) throw new Error(JSON.stringify(r.content));
        return (r.structuredContent as { job: Job | null }).job;
      },
      async submitJob(jobId: string, result: unknown) {
        const r = await client.callTool({ name: "submit_job", arguments: { worker: name, jobId, result } });
        const text = (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
        return { ok: !r.isError, text };
      },
    };
  }

  const get = async <T>(path: string) => (await (await web.request(path)).json()) as T;

  const brand = {
    /** Upload through the JSON API; returns the Document id. */
    async upload(pdf: Uint8Array, template = "battery", meta: { name?: string; supplier?: string } = {}): Promise<string> {
      const r = await brand.uploadRaw(pdf, template, meta);
      if (r.status !== 201) throw new Error(`upload failed: ${r.status} ${JSON.stringify(r.body)}`);
      return r.body.id!;
    },
    async uploadRaw(bytes: Uint8Array, template = "battery", { name = "sheet.pdf", supplier = "Voltaris" }: { name?: string; supplier?: string } = {}) {
      const form = new FormData();
      form.set("file", new File([bytes as Uint8Array<ArrayBuffer>], name, { type: "application/pdf" }));
      form.set("template", template);
      form.set("supplier", supplier);
      const res = await web.request("/api/documents", { method: "POST", body: form });
      return { status: res.status, body: (await res.json()) as { id?: string; error?: string } };
    },
    /** The ApiDocument, plus `fields` and `escrow` of the first Pipeline and `view(name)` for any Pipeline. */
    async document(id: string) {
      const doc = await get<Omit<ApiDocument, "views"> & { views: PipelineView[] }>(`/api/documents/${id}`);
      const view = (p: string) => doc.views.find((v) => v.pipeline === p)!;
      return { ...doc, fields: doc.views[0]!.fields, escrow: doc.views[0]!.escrow, view };
    },
    documents: () => get<ApiDocumentSummary[]>("/api/documents"),
    config: () => get<ApiConfig>("/api/config"),
    templates: () => get<ApiTemplate[]>("/api/templates"),
    jobs: () => get<ApiJob[]>("/api/jobs"),
    workers: () => get<ApiWorker[]>("/api/workers"),
    async export(id: string, pipeline?: string) {
      const res = await web.request(`/api/documents/${id}/export${pipeline ? `?pipeline=${pipeline}` : ""}`);
      return { status: res.status, disposition: res.headers.get("content-disposition"), body: (await res.json()) as Record<string, unknown> };
    },
    leaderboard: () => get<ApiLeaderRow[]>("/api/leaderboard"),
    async page(path: string) {
      const res = await web.request(path);
      return { status: res.status, text: await res.text() };
    },
    async challenge(docId: string, body: object) {
      const res = await web.request(`/api/documents/${docId}/challenges`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as { id?: string; error?: string } };
    },
  };

  const arbiter = {
    /** The open Challenges, oldest first. */
    challenges: async (): Promise<ApiChallenge[]> => (await arbiter.desk()).open,
    desk: () => get<ApiArbiter>("/api/challenges"),
    page: () => brand.page("/arbiter"),
    async decide(id: string, decision: "upheld" | "rejected", note?: string) {
      const res = await web.request(`/api/challenges/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      return { status: res.status };
    },
  };

  /** Run what main.ts runs every 5 s: settle escrows whose Challenge Window has closed. */
  const tick = () => board.tick();

  return { web, worker, brand, arbiter, ledger, clock, tick };
}

/** A fixture PDF: one array of text lines per page. */
export async function makePdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const p = doc.addPage();
    lines.forEach((t, i) => p.drawText(t, { x: 50, y: 750 - i * 18, size: 11, font }));
  }
  return doc.save();
}

/** In our Pipeline: this Worker takes the Markdown Sieve, hands in `markdown`, then passes it in the faithfulness Sieve. */
export async function checkedMarkdown(w: Awaited<ReturnType<ReturnType<typeof startBoard>["worker"]>>, markdown = "# Document") {
  const md = (await w.nextJob())!;
  if (md.sieve !== "markdown") throw new Error(`expected a Markdown Job, got ${md.sieve}`);
  await w.submitJob(md.id, { markdown });
  const check = (await w.nextJob())!;
  if (check.sieve !== "faithfulness") throw new Error(`expected a faithfulness Job, got ${check.sieve}`);
  await w.submitJob(check.id, { pass: true });
}

/** An extraction result saying Not stated for every Field of the Job, except the given values. */
export function extraction(job: Job, values: Record<string, object> = {}) {
  return {
    fields: job.template.fields.map((f) => ({ field: f.name, ...(values[f.name] ?? { notStated: true }) })),
  };
}
