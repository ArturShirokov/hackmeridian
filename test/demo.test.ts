import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { replay, score, deliveredBy, type Expected, type Run } from "../src/accuracy.js";
import type { ApiDocumentSummary } from "../src/api.js";
import { demoBoard } from "../src/demo.js";
import { webApp } from "../src/web.js";

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

  const r = await board.challenge(helion.id, { field: "recycled_content_lithium", page: 2, quote: "Recycled lithium, this production lot (pre + post consumer) 6 %", value: 6, unit: "%" }, "baseline");
  expect(r.ok).toBe(true);
  expect(board.challenges.decide(board.challenges.open()[0]!.id, "upheld")).toBe("ok");

  wall += 60 * 60_000;
  await board.tick();
  expect(await board.leaderboard()).toMatchObject([
    { operator: "ours", documents: 6, challengesUpheld: 0, totalSlashed: "0" },
    { operator: "baseline", documents: 6, challengesUpheld: 1, totalSlashed: "1" },
  ]);
});

test("the demo seed: about 8 Documents across both Templates and several Suppliers, Processing, Delivered and Settled, one with a Slash", async () => {
  const wall = 1_800_000_000_000;
  const { board } = await demoBoard(cache, readPdf, { now: () => wall, challengeWindowMs: 3 * 60_000, demoWindow: true });
  const list = (await (await webApp(board).request("/api/documents")).json()) as ApiDocumentSummary[];
  const status = (d: ApiDocumentSummary) => {
    const ps = Object.values(d.pipelines);
    return ps.some((p) => p.status === "processing") ? "processing" : ps.every((p) => p.status === "settled") ? "settled" : "delivered";
  };
  expect(list.length).toBeGreaterThanOrEqual(7);
  expect(new Set(list.map((d) => d.template))).toEqual(new Set(["battery", "textile"]));
  expect(new Set(list.map((d) => d.supplier)).size).toBeGreaterThanOrEqual(4);
  expect(list.some((d) => d.supplier === "Linho Norte" && d.template === "textile")).toBe(true);
  expect(new Set(list.map(status))).toEqual(new Set(["processing", "delivered", "settled"]));
  const slashed = list.flatMap((d) => Object.values(d.pipelines)).filter((p) => p.bond === "slashed");
  expect(slashed).toHaveLength(1);
  expect(Number(slashed[0]!.received)).toBeGreaterThan(0);
  // Delivered Documents keep their whole Challenge Window until the Brand opens them.
  for (const d of list.filter((d) => status(d) === "delivered"))
    for (const p of Object.values(d.pipelines)) expect(p).toMatchObject({ paused: "until opened", msLeft: 3 * 60_000 });
});
