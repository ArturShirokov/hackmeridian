// Wires adapters, serves the web pages and the MCP endpoint, and polls Storage every 5 s.
// LEDGER=fake|payments|trustless-work picks the Ledger (default fake; the Stellar ones need .env keys).
// DEMO_REPLAY=<run file> starts from a cached run instead (fake Ledger, no models, no network).
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { replay } from "./accuracy.js";
import { JobBoard } from "./board.js";
import { baseline, ours } from "./pipelines.js";
import { ledgerFromEnv } from "./ledger/env.js";
import { InMemoryStorage } from "./storage.js";
import { webApp } from "./web.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const baseUrl = process.env.BASE_URL ?? `http://${host}:${port}`;

// ponytail: in-memory Storage only; swap in ICP Storage when it lands.
const challengeWindowMs = Number(process.env.CHALLENGE_WINDOW_MIN ?? 5) * 60_000;
const cache = process.env.DEMO_REPLAY;
const board = cache
  ? (
      await replay(
        JSON.parse(readFileSync(cache, "utf8")),
        async (file) => new Uint8Array(readFileSync(new URL(`../testdata/documents/${file}`, import.meta.url))),
        { now: Date.now, challengeWindowMs, baseUrl },
      )
    ).board
  : new JobBoard({ storage: new InMemoryStorage(), ledger: ledgerFromEnv(), baseUrl, pipelines: [ours, baseline], challengeWindowMs });
setInterval(() => board.poll().catch((e) => console.error("poll failed:", e)), 5000);
setInterval(() => board.tick().catch((e) => console.error("settlement failed:", e)), 5000);

serve({ fetch: webApp(board).fetch, port, hostname: host }, () => {
  if (cache) console.log(`Demo replay of ${cache} (fake Ledger, no models or network).`);
  else console.log(`Ledger: ${process.env.LEDGER ?? "fake"}`);
  console.log(`Brand page: ${baseUrl}/  MCP endpoint: ${baseUrl}/mcp`);
});
