import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { replay, score, deliveredBy, type Expected, type Run } from "../src/accuracy.js";

const dir = new URL("../testdata/", import.meta.url);
const readPdf = async (f: string) => new Uint8Array(readFileSync(new URL(`documents/${f}`, dir)));
const cache: Run = JSON.parse(readFileSync(new URL("runs/scripted-demo.json", dir), "utf8"));

test("the scripted demo cache: ours is Correct everywhere, the Baseline only misses the planted 16 % recycled lithium", async () => {
  const expected: Expected[] = cache.documents.map((d) =>
    JSON.parse(readFileSync(new URL(`expected/${d.file.replace(".pdf", ".json")}`, dir), "utf8")),
  );
  const { board, documents } = await replay(cache, readPdf);
  const [ours, baseline] = score(expected, deliveredBy(board, documents));
  expect(documents).toHaveLength(6);
  expect(ours!.incorrect).toEqual([]);
  expect(baseline!.incorrect).toEqual([
    { document: "battery-04-helion-storage-module.pdf", field: "recycled_content_lithium", expected: "6 %", delivered: "16 %" },
  ]);
});

test("demo replay runs on the wall clock: every Challenge Window opens at start, an upheld Challenge on the Baseline Slashes it", async () => {
  let wall = 1_800_000_000_000;
  const { board, documents } = await replay(cache, readPdf, { now: () => wall, challengeWindowMs: 3 * 60_000 });
  const helion = documents.find((d) => d.file.startsWith("battery-04"))!;

  for (const d of documents) for (const v of Object.values(board.document(d.id)!.pipelines))
    expect(v.escrow!.msLeft).toBeGreaterThanOrEqual(3 * 60_000);

  const r = board.challenge(helion.id, { field: "recycled_content_lithium", page: 2, quote: "Recycled lithium, this production lot (pre + post consumer) 6 %", value: 6, unit: "%" }, "baseline");
  expect(r.ok).toBe(true);
  expect(board.challenges.decide(board.challenges.open()[0]!.id, "upheld")).toBe("ok");

  wall += 60 * 60_000;
  await board.tick();
  expect(await board.leaderboard()).toEqual([
    { operator: "ours", documents: 6, challengesUpheld: 0, totalSlashed: "0" },
    { operator: "baseline", documents: 6, challengesUpheld: 1, totalSlashed: "1" },
  ]);
});
