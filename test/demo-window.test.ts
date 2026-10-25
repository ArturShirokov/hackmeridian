import { expect, test } from "vitest";
import { extraction, makePdf, startBoard } from "./seam.js";

const sheet = () => makePdf([["Voltaris NMC-800", "Rated capacity: 220 Ah"]]);
const capacity = { value: 220, unit: "Ah", qualifier: "rated", page: 1, quote: "Rated capacity: 220 Ah" };
const min = 60_000;

async function deliver(board: ReturnType<typeof startBoard>) {
  const docId = await board.brand.upload(await sheet());
  const w = await board.worker("w1");
  const job = (await w.nextJob())!;
  expect(await w.submitJob(job.id, extraction(job, { rated_capacity_ah: capacity }))).toMatchObject({ ok: true });
  return docId;
}

test("demo window: the Challenge Window starts when the Brand opens the Document, not at delivery", async () => {
  const board = startBoard({ challengeWindowMs: 3 * min, demoWindow: true });
  const docId = await deliver(board);
  expect((await board.brand.config()).demoWindow).toBe(true);

  board.clock.advance(10 * min);
  await board.tick();
  expect((await board.brand.document(docId)).escrow).toMatchObject({ status: "delivered", paused: "until opened", msLeft: 3 * min });
  expect(board.ledger.calls.filter((c) => c.call === "settleClean")).toHaveLength(0);

  await board.brand.open(docId);
  board.clock.advance(1 * min);
  await board.brand.open(docId); // opening again does not restart it
  const e = (await board.brand.document(docId)).escrow!;
  expect(e).toMatchObject({ msLeft: 2 * min, closesAt: 13 * min });
  expect(e).not.toHaveProperty("paused");

  board.clock.advance(2 * min - 1);
  await board.tick();
  expect(board.ledger.calls.filter((c) => c.call === "settleClean")).toHaveLength(0);
  board.clock.advance(1);
  await board.tick();
  expect(board.ledger.calls.filter((c) => c.call === "settleClean")).toHaveLength(1);
});

test("demo window: it pauses while a Challenge is undecided, and runs on after the decision", async () => {
  const board = startBoard({ challengeWindowMs: 3 * min, demoWindow: true });
  const docId = await deliver(board);
  await board.brand.open(docId);
  board.clock.advance(1 * min);

  expect((await board.brand.challenge(docId, { field: "rated_capacity_ah", page: 1, quote: "Rated capacity: 220 Ah", value: 22, unit: "Ah" })).status).toBe(201);
  board.clock.advance(30 * min);
  await board.tick();
  expect((await board.brand.document(docId)).escrow).toMatchObject({ status: "delivered", paused: "challenge open", msLeft: 2 * min });
  const [c] = await board.arbiter.challenges();
  expect(c).toMatchObject({ paused: "challenge open", msLeft: 2 * min });

  await board.arbiter.decide(c!.id, "rejected");
  board.clock.advance(2 * min - 1);
  await board.tick();
  expect(board.ledger.calls.filter((c) => c.call === "settleWithSlashes")).toHaveLength(0);
  board.clock.advance(1);
  await board.tick();
  expect(board.ledger.calls.filter((c) => c.call === "settleWithSlashes")).toHaveLength(1);
});

test("without the demo window, it opens at delivery and does not pause", async () => {
  const board = startBoard({ challengeWindowMs: 3 * min });
  const docId = await deliver(board);
  expect((await board.brand.config()).demoWindow).toBeFalsy();
  expect((await board.brand.document(docId)).escrow).toMatchObject({ closesAt: 3 * min, msLeft: 3 * min });
  await board.brand.challenge(docId, { field: "rated_capacity_ah", page: 1, quote: "Rated capacity: 220 Ah", value: 22, unit: "Ah" });
  board.clock.advance(3 * min);
  expect((await board.brand.document(docId)).escrow).toMatchObject({ status: "awaiting arbiter", msLeft: 0 });
});
