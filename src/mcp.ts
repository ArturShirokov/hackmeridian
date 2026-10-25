// MCP tools for Workers. A new McpServer is built per HTTP request (stateless), so all state lives in the board.
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { JobBoard } from "./board.js";

const text = (s: string) => [{ type: "text" as const, text: s }];

export function buildMcpServer(board: JobBoard): McpServer {
  const server = new McpServer({ name: "doc2dpp", version: "0.1.0" });
  const wait = z.number().min(0).optional().describe("Seconds to wait for work before answering empty; capped at 25. Use 25.");

  server.registerTool(
    "register_worker",
    {
      description:
        "Call once at the start of your shift: the Job Board gives you your Worker id. Use it as `worker` in next_job and submit_job. " +
        "Reconnecting? Pass the id you were given as `worker` to keep it.",
      inputSchema: z.object({
        harness: z.string().optional().describe("Your agent harness, e.g. 'Claude Code', 'OpenCode', 'Pi'"),
        label: z.string().optional().describe("Free text the Job Board shows next to your id, e.g. 'Artur's laptop'"),
        worker: z.string().min(1).optional().describe("Only when reconnecting: the Worker id you were given before"),
      }),
      outputSchema: z.object({ worker: z.string() }),
    },
    async (args) => {
      const out = { worker: board.registerWorker(args) };
      return { content: text(`Your Worker id is ${out.worker}. Call next_job with worker: "${out.worker}" and wait: 25.`), structuredContent: out };
    },
  );

  server.registerTool(
    "next_job",
    {
      description:
        "Get the next Job for this Worker, or { job: null } when there is nothing yet (call again). " +
        "With wait, the call holds until a Job appears or wait seconds (max 25) pass. " +
        "Do the Job as its instructions say, then hand it in with submit_job.",
      inputSchema: z.object({ worker: z.string().min(1).describe("Your Worker id, from register_worker"), wait }),
      outputSchema: z.object({ job: z.record(z.string(), z.unknown()).nullable() }),
    },
    async ({ worker, wait }, ctx) => {
      const out = { job: (await board.waitJob(worker, wait, ctx.mcpReq.signal)) as Record<string, unknown> | null };
      return { content: text(JSON.stringify(out)), structuredContent: out };
    },
  );

  server.registerTool(
    "submit_job",
    {
      description: "Hand in the result of a Job you took with next_job. A malformed result is rejected with what is wrong.",
      inputSchema: z.object({
        worker: z.string().min(1),
        jobId: z.string().min(1),
        result: z.unknown().describe("The result in the shape the Job's instructions give"),
      }),
    },
    async ({ worker, jobId, result }) => {
      const r = await board.submitJob(worker, jobId, result);
      return r.ok ? { content: text("accepted") } : { isError: true, content: text(`rejected: ${r.error}`) };
    },
  );

  // Outside Operators: a whole Document, its own Bond, its own key. operator is its Stellar testnet address.
  const operator = z.string().min(1).describe("Your Stellar testnet address (G...): your identity, and where your Bond comes from and pay goes");
  const documentId = z.string().min(1);
  const toSign = (r: { ok: true; xdr: string } | { ok: false; error: string }, what: string) =>
    r.ok
      ? {
          content: text(`Sign this testnet transaction (${what}) with your Stellar key and hand it in with submit_signed:\n${r.xdr}`),
          structuredContent: { xdr: r.xdr },
        }
      : { isError: true, content: text(r.error) };

  server.registerTool(
    "list_open_documents",
    {
      description:
        "For outside Operators: the Documents you can claim whole, each with its Template Fields, text layer, PDF link, " +
        "the Bond you lock and the Fee you earn (USDC), and how to deliver. " +
        "With wait, an empty list holds until a Document opens or wait seconds (max 25) pass.",
      inputSchema: z.object({ operator, wait }),
      outputSchema: z.object({ documents: z.array(z.record(z.string(), z.unknown())) }),
    },
    async ({ operator, wait }, ctx) => {
      const out = { documents: (await board.waitOpenDocuments(operator, wait, ctx.mcpReq.signal)) as Record<string, unknown>[] };
      return { content: text(JSON.stringify(out)), structuredContent: out };
    },
  );

  server.registerTool(
    "claim_document",
    {
      description:
        "Claim a whole Document. Returns a Stellar testnet transaction (xdr) that locks your Bond from your own wallet in the " +
        "Document's escrow; sign it with your key and hand it in with submit_signed. Refused when your USDC balance is short of the Bond.",
      inputSchema: z.object({ operator, documentId, name: z.string().optional().describe("How the Brand sees you, e.g. 'Acme Extract'") }),
      outputSchema: z.object({ xdr: z.string() }),
    },
    async ({ operator, documentId, name }) => toSign(await board.claim(operator, documentId, name), "locks your Bond"),
  );

  server.registerTool(
    "deliver",
    {
      description:
        "Deliver your Fields for a Document you claimed: one entry per Template Field, { field, value, unit, qualifier, page, quote } " +
        "or { field, notStated: true }. Each quote must be words found in the Document. A malformed delivery is rejected with what is wrong. " +
        "Returns a transaction (xdr) recording your output hash on Stellar; sign it and hand it in with submit_signed to open the Challenge Window. " +
        "Optional trace: how you produced it, as Spans (see report_span), each with an end; it replaces the Spans you reported.",
      inputSchema: z.object({ operator, documentId, fields: z.array(z.unknown()), trace: z.array(z.unknown()).optional() }),
      outputSchema: z.object({ xdr: z.string() }),
    },
    async ({ operator, documentId, fields, trace }) =>
      toSign(await board.deliverOutside(operator, documentId, { fields }, trace), "records your output hash"),
  );

  server.registerTool(
    "report_span",
    {
      description:
        "Optional, for outside Operators: show the Brand your work live as a Trace of Spans while you work on a claimed Document. " +
        "A Span is { id, parent?, label, view, model, result, start, end? }: view is what it looked at (original, markdown, a script's output), " +
        "model the model or tool used, result one line, start/end ms since the epoch (leave end out while it runs), parent the id of an " +
        "earlier Span it sits inside (a sub-agent). Report the same id again to update it. Never put Field values in a Span. " +
        "The Trace is self-reported; the Bond is the guarantee.",
      inputSchema: z.object({ operator, documentId, span: z.unknown() }),
    },
    async ({ operator, documentId, span }) => {
      const r = board.reportSpan(operator, documentId, span);
      return r.ok ? { content: text("reported") } : { isError: true, content: text(`rejected: ${r.error}`) };
    },
  );

  server.registerTool(
    "submit_signed",
    {
      description: "Hand in the transaction claim_document or deliver gave you, signed with your Stellar key (base64 XDR).",
      inputSchema: z.object({ operator, documentId, signedXdr: z.string().min(1) }),
    },
    async ({ operator, documentId, signedXdr }) => {
      const r = await board.submitSigned(operator, documentId, signedXdr);
      return r.ok ? { content: text(r.done) } : { isError: true, content: text(r.error) };
    },
  );

  return server;
}
