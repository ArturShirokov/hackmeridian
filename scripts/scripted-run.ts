// Writes testdata/runs/scripted-demo.json: a SCRIPTED run, not a live one. Three scripted Workers hand in the
// expected values from testdata/expected; the Baseline's Worker takes the planted 16 % recycled lithium on battery-04.
// The demo replays it until a live run cache replaces it (npm run demo, DEMO_REPLAY=<cache>).
//   npx tsx scripts/scripted-run.ts
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { accuracyBoard, record, type Expected, type Run } from "../src/accuracy.js";
import { pageTexts } from "../src/pdf.js";

const dir = new URL("../testdata/", import.meta.url);
const expected: Expected[] = readdirSync(new URL("expected/", dir))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(new URL(`expected/${f}`, dir), "utf8")));
const pdf = (file: string) => new Uint8Array(readFileSync(new URL(`documents/${file}`, dir)));
const planted = { recycled_content_lithium: { value: 16, unit: "%", page: 1, quote: "16 % recycled lithium" } };

let t = 0;
const board = accuracyBoard(() => t);
const run: Run = { documents: [], events: [] };
record(board, run, () => t);
const byId = new Map<string, Expected>();
for (const e of expected) {
  const id = (await board.upload(pdf(e.document), e.template)).id;
  run.documents.push({ id, file: e.document, template: e.template });
  byId.set(id, e);
}

const asSubmitted = (e: Expected, overrides: Record<string, object> = {}) => ({
  fields: Object.entries(e.fields).map(([field, v]) => {
    if (v === "Not stated") return { field, notStated: true };
    const { qualifier, ...rest } = v;
    return { field, ...rest, ...(qualifier && { qualifier }), ...overrides[field] };
  }),
});

// Each Job is handed in before the next is taken, so a Document's first extraction from the original is ours
// (our Pipeline posts first) and its second is the Baseline's.
const originals = new Map<string, number>();
for (let i = 0, idle = 0; idle < 3; i++) {
  const worker = `scripted-${(i % 3) + 1}`;
  t += 1000;
  const job = board.nextJob(worker);
  if (!job) {
    idle++;
    continue;
  }
  idle = 0;
  const e = byId.get(job.documentId)!;
  let result: unknown;
  if (job.sieve === "markdown")
    result = { markdown: (await pageTexts(pdf(e.document))).map((p, n) => `<!-- page ${n + 1} -->\n${p}`).join("\n\n") };
  else if (job.sieve === "faithfulness") result = { pass: true };
  else {
    const nth = job.view === "original" ? (originals.get(job.documentId) ?? 0) + 1 : 0;
    originals.set(job.documentId, nth);
    result = asSubmitted(e, nth === 2 && e.document.startsWith("battery-04") ? planted : {});
  }
  t += 1000;
  const r = await board.submitJob(worker, job.id, result);
  if (!r.ok) throw new Error(`${e.document} ${job.sieve}: ${r.error}`);
}

mkdirSync(new URL("runs/", dir), { recursive: true });
writeFileSync(new URL("runs/scripted-demo.json", dir), JSON.stringify(run, null, 1));
console.log(`Wrote testdata/runs/scripted-demo.json: ${run.documents.length} Documents, ${run.events.length} events (scripted Workers).`);
