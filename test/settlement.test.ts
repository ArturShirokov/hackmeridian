import { expect, test } from "vitest";
import { extraction, makePdf, startBoard } from "./seam.js";

const sheet = () => makePdf([["Voltaris NMC-800", "Rated capacity: 220 Ah"]]);
const capacity = { value: 220, unit: "Ah", qualifier: "rated", page: 1, quote: "Rated capacity: 220 Ah" };

async function deliver(board: ReturnType<typeof startBoard>, values: Record<string, object> = { rated_capacity_ah: capacity }) {
  const docId = await board.brand.upload(await sheet());
  const w = await board.worker("w1");
  const job = (await w.nextJob())!;
  expect(await w.submitJob(job.id, extraction(job, values))).toMatchObject({ ok: true });
  return docId;
}

test("delivery opens one escrow per (Document, Operator) with the Operator's Bond and Fee and the output hash", async () => {
  const board = startBoard({ operators: { baseline: { operator: "op-baseline", bond: "25", fee: "2.5" } } });
  const docId = await deliver(board);

  const opens = board.ledger.calls.filter((c) => c.call === "openEscrow");
  expect(opens).toHaveLength(1);
  const { req } = opens[0]!;
  expect(req).toMatchObject({ documentId: docId, operator: "op-baseline", brand: "brand", bond: "25", fee: "2.5" });
  expect(req.outputHash).toMatch(/^[0-9a-f]{64}$/);

  const doc = await board.brand.document(docId);
  expect(doc.escrow).toMatchObject({ operator: "op-baseline", bond: "25", fee: "2.5", outputHash: req.outputHash, status: "open" });
  const page = (await board.brand.page(`/documents/${docId}`)).text;
  expect(page).toContain("Bond locked: 25 USDC");
  expect(page).toContain(req.outputHash);
  expect(page).toMatch(/5 min left in the Challenge Window/);
});

test("the Brand page links the escrow and its settlement on a Stellar explorer, when the Ledger gives links", async () => {
  const board = startBoard({ explorer: "https://explorer.test", challengeWindowMs: 60_000 });
  const docId = await deliver(board);
  expect((await board.brand.document(docId)).escrow).toMatchObject({ link: "https://explorer.test/escrow-1" });
  expect((await board.brand.page(`/documents/${docId}`)).text).toContain('href="https://explorer.test/escrow-1"');

  board.clock.advance(60_000);
  await board.tick();
  expect((await board.brand.document(docId)).escrow).toMatchObject({ settlementLink: "https://explorer.test/escrow-1/settle" });
  expect((await board.brand.page(`/documents/${docId}`)).text).toContain('href="https://explorer.test/escrow-1/settle"');
});

test("with the fake Ledger's default, no explorer link is shown", async () => {
  const board = startBoard();
  const docId = await deliver(board);
  expect((await board.brand.document(docId)).escrow).not.toHaveProperty("link");
  expect((await board.brand.page(`/documents/${docId}`)).text).not.toContain("explorer");
});

test("different delivered values give a different output hash", async () => {
  const a = startBoard();
  const b = startBoard();
  await deliver(a);
  await deliver(b, {});
  const hash = (x: typeof a) => x.ledger.calls.find((c) => c.call === "openEscrow")!.req.outputHash;
  expect(hash(a)).not.toBe(hash(b));
});

test("the Challenge Window closing with no upheld Challenge settles clean, once", async () => {
  const board = startBoard({ challengeWindowMs: 2 * 60_000 });
  const docId = await deliver(board);
  const escrowId = board.ledger.calls[0]!.escrowId;

  board.clock.advance(2 * 60_000 - 1);
  await board.tick();
  expect(board.ledger.calls.filter((c) => c.call === "settleClean")).toHaveLength(0);
  expect((await board.brand.page(`/documents/${docId}`)).text).toMatch(/1 min left in the Challenge Window/);

  board.clock.advance(1);
  await board.tick();
  await board.tick();
  expect(board.ledger.calls.filter((c) => c.call === "settleClean")).toEqual([{ call: "settleClean", escrowId }]);
  expect((await board.brand.document(docId)).escrow).toMatchObject({ status: "settled" });
  expect((await board.brand.page(`/documents/${docId}`)).text).toContain("Settled: Bond and Fee paid to the Operator");
  expect(await board.ledger.operatorRecord("baseline")).toEqual({ documents: 1, challengesUpheld: 0, totalSlashed: "0" });
});
