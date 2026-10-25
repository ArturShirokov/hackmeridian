// Wires adapters, serves the web pages and the MCP endpoint, and polls Storage every 5 s.
// LEDGER=fake|payments|trustless-work picks the Ledger (default fake; the Stellar ones need .env keys).
// STORAGE=memory|icp picks Storage (default memory; icp needs ICP_IDENTITY in .env, see scripts/icp-identity.ts).
// DEMO_REPLAY=<run file> starts from a cached run instead (fake Ledger, no models, no network).
import { existsSync, readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { deliveredBy, score, type Expected } from "./accuracy.js";
import { demoBoard } from "./demo.js";
import { JobBoard } from "./board.js";
import { baseline, ours } from "./pipelines.js";
import { ledgerFromEnv } from "./ledger/env.js";
import { InMemoryStorage } from "./storage.js";
import { icpStorageFromEnv } from "./storage/icp.js";
import { webApp, type WebOptions } from "./web.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const baseUrl = process.env.BASE_URL ?? `http://${host}:${port}`;

const challengeWindowMs = Number(process.env.CHALLENGE_WINDOW_MIN ?? 5) * 60_000;
// The demo window (starts when the Brand opens the Document, pauses while a Challenge is undecided): on for any window
// shorter than the live 48 h, unless DEMO_WINDOW=0.
const demoWindow = (process.env.DEMO_WINDOW ?? (challengeWindowMs < 48 * 3_600_000 ? "1" : "0")) !== "0";
const { CHALLENGE_DEPOSIT: challengeDeposit = "1", ARBITER_FEE: arbiterFee = "0.1" } = process.env;
const cache = process.env.DEMO_REPLAY;
const testdata = (path: string) => new URL(`../testdata/${path}`, import.meta.url);
let accuracy: WebOptions["accuracy"];
let board: JobBoard;
if (cache) {
  const run = await demoBoard(
    JSON.parse(readFileSync(cache, "utf8")),
    async (file) => new Uint8Array(readFileSync(testdata(`documents/${file}`))),
    { now: Date.now, challengeWindowMs, demoWindow, baseUrl },
  );
  board = run.board;
  // The leaderboard's "Accuracy · test set": the replayed deliveries scored against the hand-checked values.
  const expected = run.documents.flatMap((d): Expected[] => {
    const f = testdata(`expected/${d.file.replace(/\.pdf$/, ".json")}`);
    return existsSync(f) ? [JSON.parse(readFileSync(f, "utf8"))] : [];
  });
  accuracy = Object.fromEntries(
    score(expected, deliveredBy(board, run.documents), (p) => board.operatorOf(p)).map((r) => [r.operator, { correct: r.correct, fields: r.fields }]),
  );
} else {
  const storage = process.env.STORAGE === "icp" ? await icpStorageFromEnv() : new InMemoryStorage();
  board = new JobBoard({ storage, ledger: ledgerFromEnv(), baseUrl, pipelines: [ours, baseline], challengeWindowMs, demoWindow, challengeDeposit, arbiterFee });
  // The Job Board's own state is in memory. With STORAGE=icp, Documents come back from ICP on the first poll after
  // a restart; with memory Storage, SEED_DOCUMENTS=<testdata PDF>,... uploads those on start so Workers find Jobs
  // waiting. The Template comes from the file name (battery-… or textile-…).
  for (const file of (process.env.SEED_DOCUMENTS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const supplier = file.split("-")[2] ?? "";
    await board.upload(new Uint8Array(readFileSync(testdata(`documents/${file}`))), file.split("-")[0]!, {
      name: file,
      supplier: supplier.charAt(0).toUpperCase() + supplier.slice(1),
    });
  }
}
setInterval(() => board.poll().catch((e) => console.error("poll failed:", e)), 5000);
setInterval(() => board.tick().catch((e) => console.error("settlement failed:", e)), 5000);

serve({ fetch: webApp(board, { accuracy }).fetch, port, hostname: host }, () => {
  if (cache) console.log(`Demo replay of ${cache} (fake Ledger, no models or network).`);
  else console.log(`Ledger: ${process.env.LEDGER ?? "fake"}  Storage: ${process.env.STORAGE ?? "memory"}`);
  console.log(`Brand page: ${baseUrl}/  MCP endpoint: ${baseUrl}/mcp`);
});
