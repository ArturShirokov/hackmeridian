// The one test seam: a Job Board with fake adapters, driven through its MCP tools (as Workers)
// and its web API (as the Brand and the Arbiter), all in process.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type {
  ApiArbiter, ApiBalance, ApiChallenge, ApiConfig, ApiSession, ApiUser, ApiDocument, ApiDocumentSummary, ApiField, ApiJob, ApiLeaderRow, ApiPipelineView, ApiTemplate, ApiWorker,
} from "../src/api.js";
import { JobBoard, type Job, type OperatorTerms } from "../src/board.js";
import type { Pipeline } from "../src/pipelines.js";
import { InMemoryStorage, type Storage } from "../src/storage.js";
import { IcpStorage, type FileEntry, type IcpActor } from "../src/storage/icp.js";
import { FakeLedger } from "../src/ledger.js";
import { buildMcpServer } from "../src/mcp.js";
import { webApp, type WebOptions } from "../src/web.js";

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
/** An ApiField with every variant's keys optional, so tests read them without narrowing. */
export type Field = Pick<ApiField, "name" | "label" | "tieBreak" | "status"> &
  Partial<UnionToIntersection<DistOmit<ApiField, "name" | "label" | "tieBreak" | "status">>>;
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type PipelineView = Omit<ApiPipelineView, "fields"> & { fields: Field[] };

export function startBoard(
  opts: {
    jobTimeoutMs?: number;
    pipelines?: Pipeline[];
    operators?: Record<string, OperatorTerms>;
    challengeWindowMs?: number;
    demoWindow?: boolean;
    challengeDeposit?: string;
    arbiterFee?: string;
    /** Have the fake Ledger give explorer links under this base URL; without it, it gives none. */
    explorer?: string;
    web?: WebOptions;
    /** Default: in memory. */
    storage?: Storage;
  } = {},
) {
  const { explorer, web: webOpts, storage = new InMemoryStorage(), ...boardOpts } = opts;
  const ledger = new FakeLedger(explorer);
  let time = 0;
  /** Fake timers on the fake clock: advance fires the ones due. */
  const timers = new Set<{ at: number; fn: () => void }>();
  const clock = {
    advance(ms: number) {
      time += ms;
      for (const t of [...timers]) if (t.at <= time) timers.delete(t), t.fn();
    },
    /** How many long-polls are waiting (each holds one timer). */
    waiting: () => timers.size,
  };
  const setTimer = (ms: number, fn: () => void) => {
    const t = { at: time + ms, fn };
    timers.add(t);
    return () => void timers.delete(t);
  };
  const board = new JobBoard({ storage, ledger, baseUrl: "http://board.test", now: () => time, setTimer, ...boardOpts });
  const web = webApp(board, webOpts);

  async function mcpClient(name: string) {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await buildMcpServer(board).connect(serverT);
    const client = new Client({ name, version: "0" });
    await client.connect(clientT);
    return client;
  }

  /** A Worker that calls register_worker first and works under the id it is given (or keeps, with `worker`). */
  async function register(args: { harness?: string; label?: string; worker?: string } = {}) {
    const client = await mcpClient("registering");
    const r = await client.callTool({ name: "register_worker", arguments: args });
    if (r.isError) throw new Error(JSON.stringify(r.content));
    const { worker: id } = r.structuredContent as { worker: string };
    return { id, ...(await worker(id, client)) };
  }

  async function worker(name: string, client?: Client) {
    client ??= await mcpClient(name);
    return {
      /** wait: long-poll for up to that many seconds; signal: abandon the call. */
      async nextJob({ wait, signal }: { wait?: number; signal?: AbortSignal } = {}): Promise<Job | null> {
        const r = await client.callTool({ name: "next_job", arguments: { worker: name, ...(wait !== undefined && { wait }) } }, { signal });
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

  /** An outside Operator: its identity is its Stellar address, and it signs with its own key, which the board never sees. */
  async function outsideOperator(kp = Keypair.random()) {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await buildMcpServer(board).connect(serverT);
    const client = new Client({ name: kp.publicKey(), version: "0" });
    await client.connect(clientT);
    const operator = kp.publicKey();
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: { operator, ...args } });
      const text = (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
      return { ok: !r.isError, text, data: r.structuredContent as Record<string, any> | undefined };
    };
    const sign = (xdr: string, signer: Keypair) => {
      const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
      tx.sign(signer);
      return tx.toXDR();
    };
    /** Call a tool that returns a transaction to sign, sign it with `signer` and hand it back with submit_signed. */
    const signed = async (name: string, args: Record<string, unknown>, signer: Keypair) => {
      const r = await call(name, args);
      if (!r.ok) return r;
      return call("submit_signed", { documentId: args.documentId, signedXdr: sign(r.data!.xdr, signer) });
    };
    return {
      address: operator,
      async openDocuments({ wait }: { wait?: number } = {}) {
        const r = await call("list_open_documents", wait === undefined ? {} : { wait });
        return r.data!.documents as { id: string; template: { name: string; fields: { name: string }[] }; bond: string; fee: string }[];
      },
      claim: (documentId: string, signer = kp) => signed("claim_document", { documentId }, signer),
      deliver: (documentId: string, fields: unknown, { signer = kp, trace }: { signer?: Keypair; trace?: unknown } = {}) =>
        signed("deliver", { documentId, fields, ...(trace !== undefined && { trace }) }, signer),
      reportSpan: (documentId: string, span: unknown) => call("report_span", { documentId, span }),
      call,
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
    /** The Brand opens the Document's Review (in demo mode, that starts its Challenge Window). */
    open: async (id: string) => (await web.request(`/api/documents/${id}/open`, { method: "POST" })).status,
    config: () => get<ApiConfig>("/api/config"),
    templates: () => get<ApiTemplate[]>("/api/templates"),
    jobs: () => get<ApiJob[]>("/api/jobs"),
    workers: () => get<ApiWorker[]>("/api/workers"),
    async export(id: string, pipeline?: string) {
      const res = await web.request(`/api/documents/${id}/export${pipeline ? `?pipeline=${pipeline}` : ""}`);
      return { status: res.status, disposition: res.headers.get("content-disposition"), body: (await res.json()) as Record<string, unknown> };
    },
    leaderboard: () => get<ApiLeaderRow[]>("/api/leaderboard"),
    /** An old HTML page (now under /legacy), or the original file. */
    async page(path: string) {
      const res = await web.request(path.endsWith("/file") ? path : `/legacy${path}`);
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
    /** For a challenger that signs its own Deposit: the unsigned transaction to sign. */
    async prepareDeposit(docId: string, challenger: string, pipeline?: string) {
      const res = await web.request(`/api/documents/${docId}/challenges/deposit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenger, pipeline }),
      });
      return { status: res.status, body: (await res.json()) as { xdr: string; amount: string; error?: string } };
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

  /** Who can sign in, and what each signed-in user (by session cookie) sees. */
  const users = {
    list: () => get<ApiUser[]>("/api/users"),
    /** Signs in as a seeded user; returns the session cookie ("name=value") to send back. */
    async signIn(user: string) {
      const res = await web.request("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user }) });
      return { status: res.status, cookie: res.headers.get("set-cookie")?.split(";")[0] };
    },
    as(cookie?: string) {
      const read = async <T>(path: string) => {
        const res = await web.request(path, { headers: cookie ? { cookie } : {} });
        return { status: res.status, body: (await res.json()) as T };
      };
      return { session: async () => (await read<ApiSession>("/api/session")).body, balance: () => read<ApiBalance>("/api/balance") };
    },
  };

  /** Run what main.ts runs every 5 s: settle escrows whose Challenge Window has closed. */
  const tick = () => board.tick();
  /** Run what main.ts runs every 5 s: pick up Documents other uploaders put in Storage. */
  const poll = () => board.poll();

  return { web, worker, register, outsideOperator, brand, arbiter, users, ledger, clock, tick, poll };
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

/** Viktoria's ICP canister in memory: one Task (id 7) whose files are served under https://files.test. */
export function fakeCanister() {
  const taskId = 7n;
  const files: FileEntry[] = [];
  const served = new Map<string, Uint8Array>();
  const uploads = new Map<string, { size: bigint; contentType: string; chunks: Uint8Array[] }>();
  let chunks = 0;
  const add = (entry_name: string, bytes: Uint8Array, content_type: string) => {
    const path = `tasks/${taskId}/${entry_name}`;
    const entry: FileEntry = {
      entry_name, path, url: `https://files.test/${path}`, hash: path, size: BigInt(bytes.length), content_type,
      added_at_ns: BigInt(Date.now()) * 1_000_000n,
    };
    files.push(entry);
    served.set(entry.url, bytes);
    return entry;
  };
  const actor: IcpActor = {
    create_task: async () => ({ Ok: taskId }),
    list_tasks: async () => ({ total: 0n, tasks: [] }),
    get_task: async (id) => (id === taskId ? [{ id, title: "doc2dpp Documents", files: [...files] }] : []),
    async task_init_upload({ entry_name, file_size, content_type }) {
      if (entry_name.length > 120) return { Err: "Entry name must be 1-120 characters" };
      if (files.some((f) => f.entry_name === entry_name)) return { Err: "exists" };
      uploads.set(entry_name, { size: file_size, contentType: content_type[0] ?? "", chunks: [] });
      return { Ok: entry_name };
    },
    async task_store_chunk({ entry_name, chunk_id, chunk_data }) {
      chunks++;
      uploads.get(entry_name)!.chunks[Number(chunk_id)] = new Uint8Array(chunk_data);
      return { Ok: null };
    },
    async task_finalize_upload({ entry_name }) {
      const u = uploads.get(entry_name)!;
      const bytes = new Uint8Array(Buffer.concat(u.chunks));
      if (BigInt(bytes.length) !== u.size) return { Err: "size mismatch" };
      return { Ok: add(entry_name, bytes, u.contentType) };
    },
    task_cancel_upload: async ({ entry_name }) => (uploads.delete(entry_name), { Ok: null }),
  };
  const fetch = async (url: string | URL | Request) => {
    const bytes = served.get(String(url));
    return bytes ? new Response(bytes as Uint8Array<ArrayBuffer>) : new Response("not found", { status: 404 });
  };
  return {
    storage: () => new IcpStorage({ actor, taskId, fetch: fetch as typeof globalThis.fetch }),
    files: () => [...files],
    chunks: () => chunks,
    /** Someone else's file in the same Task. */
    addForeign: (name: string, bytes: Uint8Array) => void add(name, bytes, "image/png"),
    /** Swap the bytes served behind a URL. */
    tamper: (url: string) => void served.set(url, new Uint8Array([9, 9, 9])),
  };
}
