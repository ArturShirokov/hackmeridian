// Accuracy report: run our Pipeline and the Baseline over testdata/documents with real Workers, or replay a cached run,
// and compare the delivered Field values with testdata/expected.
//   npx tsx scripts/accuracy.ts                         live: serve MCP, wait for Workers to drain the board
//   npx tsx scripts/accuracy.ts --replay testdata/runs/<file>.json
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { accuracyBoard, deliveredBy, drained, record, replay, score, type Expected, type Run } from "../src/accuracy.js";
import type { JobBoard } from "../src/board.js";
import { webApp } from "../src/web.js";

const dir = new URL("../testdata/", import.meta.url);
const expected: Expected[] = readdirSync(new URL("expected/", dir))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(new URL(`expected/${f}`, dir), "utf8")));
const readPdf = async (file: string) => new Uint8Array(readFileSync(new URL(`documents/${file}`, dir)));

function report(board: JobBoard, documents: Run["documents"]) {
  for (const r of score(expected, deliveredBy(board, documents), (p) => board.operatorOf(p))) {
    const share = r.fields ? ((100 * r.correct) / r.fields).toFixed(1) : "0.0";
    console.log(`\n${r.pipeline} (Operator ${r.operator}): ${share}% Correct (${r.correct} of ${r.fields} Fields), ${r.notStated} Not stated`);
    for (const i of r.incorrect) console.log(`  ${i.document}  ${i.field}: expected ${i.expected}, delivered ${i.delivered}`);
  }
}

const replayAt = process.argv.indexOf("--replay");
if (replayAt >= 0) {
  const file = process.argv[replayAt + 1];
  if (!file) throw new Error("usage: --replay <run file>");
  const { board, documents } = await replay(JSON.parse(readFileSync(file, "utf8")), readPdf);
  report(board, documents);
} else {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  const board = accuracyBoard(Date.now, process.env.BASE_URL ?? `http://${host}:${port}`);
  const run: Run = { documents: [], events: [] };
  mkdirSync(new URL("runs/", dir), { recursive: true });
  const out = new URL(`runs/${new Date().toISOString().replace(/[:.]/g, "-")}.json`, dir);
  const save = () => writeFileSync(out, JSON.stringify(run, null, 1));
  record(board, run, Date.now, save);
  for (const e of expected) {
    const meta = await board.upload(await readPdf(e.document), e.template);
    run.documents.push({ id: meta.id, file: e.document, template: e.template });
  }
  save();
  const server = serve({ fetch: webApp(board).fetch, port, hostname: host });
  console.log(`MCP endpoint: http://${host}:${port}/mcp  (${run.documents.length} Documents, both Pipelines). Recording to ${out.pathname}`);
  console.log("Connect Workers as in the README. Ctrl+C reports on what is delivered so far.");
  const finish = () => {
    report(board, run.documents);
    console.log(`\nRun cached at ${out.pathname}`);
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", finish);
  setInterval(() => drained(board, run.documents) && finish(), 2000);
}
