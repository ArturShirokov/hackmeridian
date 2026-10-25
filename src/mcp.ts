// MCP tools for Workers. A new McpServer is built per HTTP request (stateless), so all state lives in the board.
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { JobBoard } from "./board.js";

const text = (s: string) => [{ type: "text" as const, text: s }];

export function buildMcpServer(board: JobBoard): McpServer {
  const server = new McpServer({ name: "job-board", version: "0.1.0" });

  server.registerTool(
    "next_job",
    {
      description:
        "Get the next Job for this Worker, or { job: null } when there is nothing yet (wait and retry). " +
        "Do the Job as its instructions say, then hand it in with submit_job.",
      inputSchema: z.object({ worker: z.string().min(1).describe("Your stable Worker identity") }),
      outputSchema: z.object({ job: z.record(z.string(), z.unknown()).nullable() }),
    },
    async ({ worker }) => {
      const out = { job: board.nextJob(worker) as Record<string, unknown> | null };
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
      const r = board.submitJob(worker, jobId, result);
      return r.ok ? { content: text("accepted") } : { isError: true, content: text(`rejected: ${r.error}`) };
    },
  );

  return server;
}
