// Wires adapters, serves the web pages and the MCP endpoint, and polls Storage every 5 s.
import { serve } from "@hono/node-server";
import { JobBoard } from "./board.js";
import { FakeLedger } from "./ledger.js";
import { InMemoryStorage } from "./storage.js";
import { webApp } from "./web.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const baseUrl = process.env.BASE_URL ?? `http://${host}:${port}`;

// ponytail: fake adapters only; swap in ICP Storage and Trustless Work Ledger when they land.
const board = new JobBoard({ storage: new InMemoryStorage(), ledger: new FakeLedger(), baseUrl });
setInterval(() => board.poll().catch((e) => console.error("poll failed:", e)), 5000);

serve({ fetch: webApp(board).fetch, port, hostname: host }, () => {
  console.log(`Brand page: ${baseUrl}/  MCP endpoint: ${baseUrl}/mcp`);
});
