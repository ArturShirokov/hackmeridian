import { Keypair } from "@stellar/stellar-sdk";
import { expect, test } from "vitest";
import { extraction, makePdf, startBoard } from "./seam.js";

const sheet = () => makePdf([["Voltaris NMC-800", "Rated capacity: 220 Ah"]]);
const capacity = { value: 220, unit: "Ah", qualifier: "rated", page: 1, quote: "Rated capacity: 220 Ah" };

/** A board with the Baseline and one funded outside Operator that has claimed the uploaded Document. */
async function claimed(opts: Parameters<typeof startBoard>[0] = {}) {
  const board = startBoard({ challengeWindowMs: 60_000, ...opts });
  const docId = await board.brand.upload(await sheet());
  const op = await board.outsideOperator();
  board.ledger.fund(op.address, "10");
  expect((await op.claim(docId)).text).toMatch(/^claimed/);
  return { board, docId, op };
}

/** Every battery Field Not stated except the given ones, in deliver's shape. */
async function fieldsFor(board: ReturnType<typeof startBoard>, values: Record<string, object>) {
  const battery = (await board.brand.templates()).find((t) => t.name === "battery")!;
  return battery.fields.map((f) => ({ field: f.name, ...(values[f.name] ?? { notStated: true }) }));
}

/** The Baseline's Worker hands in its extraction. */
async function baselineDelivers(board: ReturnType<typeof startBoard>, values: Record<string, object> = { rated_capacity_ah: capacity }) {
  const w = await board.worker("w1");
  const job = (await w.nextJob())!;
  expect(await w.submitJob(job.id, extraction(job, values))).toMatchObject({ ok: true });
}

test("an outside Operator lists open Documents and claims one, its Bond locked from its own wallet", async () => {
  const board = startBoard();
  const docId = await board.brand.upload(await sheet());
  const op = await board.outsideOperator();
  board.ledger.fund(op.address, "25");

  const open = await op.openDocuments();
  expect(open.map((d) => d.id)).toEqual([docId]);
  expect(open[0]).toMatchObject({ bond: "10", fee: "1", template: { name: "battery" } });

  expect((await op.claim(docId)).text).toMatch(/^claimed: your Bond is locked/);
  expect(await board.ledger.usdcBalance(op.address)).toBe("15");
  expect(board.ledger.calls).toContainEqual(
    expect.objectContaining({ call: "lockBond", req: expect.objectContaining({ documentId: docId, operator: op.address, bond: "10", fee: "1" }) }),
  );
  expect(await op.openDocuments()).toEqual([]);
});

test("a claim is refused when the Operator's wallet holds less USDC than the Bond, or is signed by another key", async () => {
  const board = startBoard();
  const docId = await board.brand.upload(await sheet());
  const op = await board.outsideOperator();
  board.ledger.fund(op.address, "4.5");

  const short = await op.claim(docId);
  expect(short.ok).toBe(false);
  expect(short.text).toBe(
    `claim refused: ${op.address} holds 4.5 USDC on Stellar testnet and the Bond is 10 USDC. Add at least 5.5 USDC to it, then claim again.`,
  );

  board.ledger.fund(op.address, "10");
  const forged = await op.claim(docId, Keypair.random());
  expect(forged.ok).toBe(false);
  expect(forged.text).toMatch(/not signed by G/);
  expect(await board.ledger.usdcBalance(op.address)).toBe("14.5");
  expect(await op.openDocuments()).toHaveLength(1);
  expect((await board.brand.document(docId)).views.map((v) => v.pipeline)).toEqual(["baseline"]);

  const named = await op.call("claim_document", { operator: "ours", documentId: docId });
  expect(named).toMatchObject({ ok: false, text: expect.stringMatching(/your Stellar testnet address/) });
});

test("delivery records the output hash, opens the Challenge Window, and shows its Fields next to the Baseline's", async () => {
  const { board, docId, op } = await claimed();
  const delivered = await op.deliver(docId, await fieldsFor(board, { rated_capacity_ah: { ...capacity, value: 230 } }));
  expect(delivered.text).toMatch(/^delivered: the Challenge Window is open/);
  const record = board.ledger.calls.find((c) => c.call === "recordOutput")!;
  expect(record).toMatchObject({ outputHash: expect.stringMatching(/^[0-9a-f]{64}$/) });

  // Values stay withheld until the Baseline delivers too.
  let doc = await board.brand.document(docId);
  expect(doc.view(op.address).fields.find((f) => f.name === "rated_capacity_ah")).toMatchObject({ status: "final", withheld: true });
  await baselineDelivers(board);

  doc = await board.brand.document(docId);
  expect(doc.views.map((v) => v.pipeline)).toEqual(["baseline", op.address]);
  const theirs = doc.view(op.address);
  expect(theirs).toMatchObject({
    operator: op.address,
    label: expect.stringContaining(op.address.slice(0, 4)),
    stations: [{ label: "Black box", state: "done" }],
    escrow: { operator: op.address, bond: "10", fee: "1", outputHash: record.outputHash, status: "delivered" },
  });
  expect(theirs.fields.find((f) => f.name === "rated_capacity_ah")).toMatchObject({ status: "final", display: "230 Ah (rated)" });
  expect(doc.differs).toEqual(["rated_capacity_ah"]);
  expect((await board.brand.documents())[0]!.pipelines[op.address]).toMatchObject({ status: "delivered" });

  const row = (await board.brand.leaderboard()).find((r) => r.operator === op.address);
  expect(row).toMatchObject({ documents: 1, fieldsDelivered: 25, bondsLocked: "10", challengesUpheld: 0 });
});

test("the Challenge Window closing clean pays Bond and Fee to the outside Operator's own address", async () => {
  const { board, docId, op } = await claimed();
  await op.deliver(docId, await fieldsFor(board, { rated_capacity_ah: capacity }));
  await baselineDelivers(board);
  expect(await board.ledger.usdcBalance(op.address)).toBe("0");

  board.clock.advance(60_000);
  await board.tick();
  expect(await board.ledger.usdcBalance(op.address)).toBe("11");
  expect((await board.brand.document(docId)).view(op.address).escrow).toMatchObject({ status: "settled" });
  expect((await board.brand.leaderboard()).find((r) => r.operator === op.address)).toMatchObject({ bondsLocked: "0" });
});

test("an upheld Challenge against an outside Operator Slashes its Bond to the Brand and pays it the rest", async () => {
  const { board, docId, op } = await claimed();
  await op.deliver(docId, await fieldsFor(board, { rated_capacity_ah: { ...capacity, value: 230 } }));
  await baselineDelivers(board);

  const filed = await board.brand.challenge(docId, { pipeline: op.address, field: "rated_capacity_ah", page: 1, quote: "Rated capacity: 220 Ah", value: 220, unit: "Ah", qualifier: "rated" });
  expect(filed.status).toBe(201);
  const [open] = await board.arbiter.challenges();
  expect(open).toMatchObject({ pipeline: op.address, operatorLabel: expect.stringContaining(op.address.slice(0, 4)) });
  expect((await board.arbiter.decide(open!.id, "upheld")).status).toBe(200);

  board.clock.advance(60_000);
  await board.tick();
  const lock = board.ledger.calls.find((c) => c.call === "lockBond")!;
  expect(board.ledger.calls).toContainEqual({ call: "settleWithSlashes", escrowId: lock.escrowId, slashes: ["1"] });
  expect(await board.ledger.usdcBalance("brand")).toBe("1");
  expect(await board.ledger.usdcBalance(op.address)).toBe("10");
  expect((await board.brand.leaderboard()).find((r) => r.operator === op.address)).toMatchObject({ challengesUpheld: 1, totalSlashed: "1" });
});

test("deliver rejects Fields outside the Template, missing Fields and quotes not in the Document, and accepts the fix", async () => {
  const { board, docId, op } = await claimed();
  const good = await fieldsFor(board, { rated_capacity_ah: capacity });

  const bad = [
    ...good.filter((f) => f.field !== "name").map((f) => (f.field === "rated_capacity_ah" ? { ...capacity, field: f.field, quote: "Capacity is 220 Ah" } : f)),
    { field: "colour", notStated: true },
  ];
  const r = await op.deliver(docId, bad);
  expect(r.ok).toBe(false);
  expect(r.text).toContain('unknown Field "colour"');
  expect(r.text).toContain("missing Fields (give each a value or notStated): name");
  expect(r.text).toContain(`Field "rated_capacity_ah": quote not found in the Document's text: "Capacity is 220 Ah"`);
  expect((await op.deliver(docId, [{ field: "name", value: "x" }])).text).toMatch(/page|quote/);
  expect(board.ledger.calls.some((c) => c.call === "recordOutput")).toBe(false);

  expect((await op.deliver(docId, good)).text).toMatch(/^delivered/);
  expect((await op.deliver(docId, good)).text).toMatch(/already delivered/);
});

test("our own Pipelines run unchanged beside an outside Operator, and an expired claim stops holding back their values", async () => {
  const { board, docId, op } = await claimed({ jobTimeoutMs: 5 * 60_000 });
  await baselineDelivers(board);
  expect((await board.brand.document(docId)).fields.find((f) => f.name === "rated_capacity_ah")).toMatchObject({ withheld: true });

  board.clock.advance(5 * 60_000);
  const doc = await board.brand.document(docId);
  expect(doc.views.map((v) => v.pipeline)).toEqual(["baseline"]);
  expect(doc.fields.find((f) => f.name === "rated_capacity_ah")).toMatchObject({ status: "final", display: "220 Ah (rated)" });
  expect((await op.deliver(docId, await fieldsFor(board, {}))).text).toMatch(/expired/);
});
