// The one test seam: a Job Board with fake adapters, driven through its MCP tools (as Workers)
// and its web API (as the Brand and the Arbiter), all in process.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { JobBoard, type Job, type OperatorTerms } from "../src/board.js";
import type { Pipeline } from "../src/pipelines.js";
import { InMemoryStorage } from "../src/storage.js";
import { FakeLedger } from "../src/ledger.js";
import { buildMcpServer } from "../src/mcp.js";
import { webApp } from "../src/web.js";

export function startBoard(
  opts: {
    jobTimeoutMs?: number;
    pipelines?: Pipeline[];
    operators?: Record<string, OperatorTerms>;
    challengeWindowMs?: number;
  } = {},
) {
  const storage = new InMemoryStorage();
  const ledger = new FakeLedger();
  let time = 0;
  const clock = { advance: (ms: number) => void (time += ms) };
  const board = new JobBoard({ storage, ledger, baseUrl: "http://board.test", now: () => time, ...opts });
  const web = webApp(board);

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

  const brand = {
    async upload(pdf: Uint8Array, template = "battery"): Promise<string> {
      const form = new FormData();
      form.set("file", new File([pdf as Uint8Array<ArrayBuffer>], "sheet.pdf", { type: "application/pdf" }));
      form.set("template", template);
      const res = await web.request("/upload", { method: "POST", body: form });
      if (res.status !== 303) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
      return res.headers.get("location")!.split("/").pop()!;
    },
    async document(id: string) {
      const res = await web.request(`/api/documents/${id}`);
      return (await res.json()) as {
        id: string;
        template: string;
        fields: {
          name: string;
          status: "converging" | "final" | "disagreeing" | "not stated";
          value?: unknown; unit?: string; qualifier?: string; page?: number; quote?: string; notStated?: boolean; corrected?: boolean;
          quotes?: { page: number; quote: string }[];
          supplierRequest?: string;
        }[];
        escrow?: { operator: string; bond: string; fee: string; outputHash: string; status: "open" | "settled"; msLeft: number; slashes?: string[] };
      };
    },
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
    async challenges() {
      const res = await web.request("/api/challenges");
      return (await res.json()) as {
        id: string;
        documentId: string;
        field: string;
        disputed: Record<string, unknown>;
        page: number;
        quote: string;
        value: unknown;
        unit?: string;
      }[];
    },
    page: () => brand.page("/arbiter"),
    async decide(id: string, decision: "upheld" | "rejected") {
      const res = await web.request(`/api/challenges/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
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

/** An extraction result saying Not stated for every Field of the Job, except the given values. */
export function extraction(job: Job, values: Record<string, object> = {}) {
  return {
    fields: job.template.fields.map((f) => ({ field: f.name, ...(values[f.name] ?? { notStated: true }) })),
  };
}
