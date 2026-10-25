import { expect, test } from "vitest";
import { baseline, ours } from "../src/pipelines.js";
import { checkedMarkdown, extraction, makePdf, startBoard } from "./seam.js";

const sheet = () => makePdf([["Voltaris NMC-800", "Rated capacity: 220 Ah"]]);
const capacity = { value: 220, unit: "Ah", qualifier: "rated", page: 1, quote: "Rated capacity: 220 Ah" };
const operators = {
  ours: { operator: "origyn", bond: "20", fee: "2" },
  baseline: { operator: "one-pass", bond: "10", fee: "1" },
};

test("two Operators on one Document: two escrows, values side by side, and a leaderboard after one upheld Challenge on the Baseline", async () => {
  const board = startBoard({ pipelines: [ours, baseline], operators, challengeWindowMs: 60_000 });
  const { brand, arbiter, worker, ledger } = board;
  const docId = await brand.upload(await sheet());
  const [w1, w2] = [await worker("w1"), await worker("w2")];

  // w1 takes our first Sieve, w2 the Baseline's single Sieve (which gets capacity wrong), w1 our Markdown, then w2 our second extraction.
  const j1 = (await w1.nextJob())!;
  await w1.submitJob(j1.id, extraction(j1, { rated_capacity_ah: capacity }));
  const jb = (await w2.nextJob())!;
  await w2.submitJob(jb.id, extraction(jb, { rated_capacity_ah: { ...capacity, value: 22 } }));
  await checkedMarkdown(w1);
  const j2 = (await w2.nextJob())!;
  expect(await w2.submitJob(j2.id, extraction(j2, { rated_capacity_ah: capacity }))).toMatchObject({ ok: true });

  expect(ledger.calls.filter((c) => c.call === "openEscrow").map((c) => c.call === "openEscrow" && c.req)).toMatchObject([
    { documentId: docId, operator: "one-pass", bond: "10", fee: "1" },
    { documentId: docId, operator: "origyn", bond: "20", fee: "2" },
  ]);

  const doc = await brand.document(docId);
  const cap = (p: string) => doc.pipelines[p]!.fields.find((f) => f.name === "rated_capacity_ah");
  expect(cap("ours")).toMatchObject({ status: "final", value: 220 });
  expect(cap("baseline")).toMatchObject({ status: "final", value: 22 });
  expect(doc.pipelines.baseline!.escrow).toMatchObject({ operator: "one-pass", status: "open" });
  const page = (await brand.page(`/documents/${docId}`)).text;
  expect(page).toContain("origyn");
  expect(page).toContain("one-pass");
  expect(page).toMatch(/220[\s\S]*22/);

  const r = await brand.challenge(docId, { pipeline: "baseline", field: "rated_capacity_ah", page: 1, quote: "Rated capacity: 220 Ah", value: 220, unit: "Ah", qualifier: "rated" });
  expect(r.status).toBe(201);
  await arbiter.decide((await arbiter.challenges())[0]!.id, "upheld");
  expect((await brand.document(docId)).pipelines.ours!.fields.find((f) => f.name === "rated_capacity_ah")).not.toHaveProperty("corrected");

  board.clock.advance(60_000);
  await board.tick();
  expect(await brand.leaderboard()).toEqual([
    { operator: "origyn", documents: 1, challengesUpheld: 0, totalSlashed: "0" },
    { operator: "one-pass", documents: 1, challengesUpheld: 1, totalSlashed: "1" },
  ]);
  const lb = (await brand.page("/leaderboard")).text;
  expect(lb).toMatch(/one-pass[\s\S]*1[\s\S]*1/);
});
