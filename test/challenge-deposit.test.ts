import { expect, test } from "vitest";
import { addUsdc } from "../src/ledger.js";
import { extraction, makePdf, startBoard } from "./seam.js";

const sheet = () => makePdf([["Voltaris NMC-800", "Rated capacity: 220 Ah"], ["Chemistry: NMC811"]]);
const wrongCapacity = { value: 22, unit: "Ah", qualifier: "rated", page: 1, quote: "Rated capacity: 220 Ah" };
const capacityChallenge = { field: "rated_capacity_ah", page: 1, quote: "Rated capacity: 220 Ah", value: 220, unit: "Ah", qualifier: "rated" };
const chemistryChallenge = { field: "battery_chemistry", page: 2, quote: "Chemistry: NMC811", value: "NMC811" };
const outsider = "GOUTSIDECHALLENGER";

async function deliver(opts: Parameters<typeof startBoard>[0] = {}) {
  const board = startBoard({ challengeWindowMs: 60_000, ...opts });
  const docId = await board.brand.upload(await sheet());
  const w = await board.worker("w1");
  const job = (await w.nextJob())!;
  expect(await w.submitJob(job.id, extraction(job, { rated_capacity_ah: wrongCapacity }))).toMatchObject({ ok: true });
  return { ...board, docId, escrowId: board.ledger.calls[0]!.escrowId };
}

const total = (payouts: { amount: string }[]) => addUsdc(...payouts.map((p) => p.amount));

test("filing a Challenge locks the Challenge Deposit from the challenger, the Brand by default", async () => {
  const { brand, arbiter, ledger, docId, escrowId } = await deliver();
  expect((await brand.config())).toMatchObject({ challengeDeposit: "1", arbiterFee: "0.1" });
  expect((await brand.challenge(docId, capacityChallenge)).status).toBe(201);
  expect(ledger.calls.filter((c) => c.call === "lockDeposit")).toEqual([{ call: "lockDeposit", escrowId, challenger: "brand", amount: "1" }]);
  expect((await arbiter.challenges())[0]).toMatchObject({ challenger: "brand", deposit: "1" });
});

test("a challenger that signs its own Deposit: prepare it, sign it, file the Challenge with it", async () => {
  const { brand, arbiter, ledger, docId, escrowId } = await deliver();
  const prep = await brand.prepareDeposit(docId, outsider);
  expect(prep).toMatchObject({ status: 200, body: { amount: "1", xdr: expect.any(String) } });
  // The fake Ledger's "signature" leaves the transaction as prepared.
  const r = await brand.challenge(docId, { ...capacityChallenge, challenger: outsider, depositXdr: prep.body.xdr });
  expect(r.status).toBe(201);
  expect(ledger.calls.filter((c) => c.call === "lockDeposit")).toEqual([{ call: "lockDeposit", escrowId, challenger: outsider, amount: "1" }]);
  expect((await arbiter.challenges())[0]).toMatchObject({ challenger: outsider, deposit: "1" });
});

test("a Challenge whose Deposit is not locked is refused", async () => {
  const { brand, arbiter, ledger, docId } = await deliver();
  const none = await brand.challenge(docId, { ...capacityChallenge, challenger: outsider });
  expect(none.status).toBe(402);
  expect(none.body.error).toMatch(/Challenge Deposit/);
  const forged = await brand.challenge(docId, { ...capacityChallenge, challenger: outsider, depositXdr: "not-prepared" });
  expect(forged.status).toBe(402);
  expect(await arbiter.challenges()).toHaveLength(0);
  expect(ledger.calls.filter((c) => c.call === "lockDeposit")).toHaveLength(0);
});

test("upheld and rejected: each pot pays out exactly what it holds, the Arbiter Fee out of the Slash and the rejected Deposit to the Arbiter", async () => {
  const { brand, arbiter, ledger, clock, tick, docId, escrowId } = await deliver();
  await brand.challenge(docId, capacityChallenge);
  const prep = await brand.prepareDeposit(docId, outsider);
  await brand.challenge(docId, { ...chemistryChallenge, challenger: outsider, depositXdr: prep.body.xdr });
  const [capacity, chemistry] = await arbiter.challenges();
  await arbiter.decide(capacity!.id, "upheld");
  await arbiter.decide(chemistry!.id, "rejected");

  const desk = await arbiter.desk();
  expect(desk.record).toMatchObject({ decided: 2, earned: "1.1" });
  expect(desk.decided.find((c) => c.id === capacity!.id)).toMatchObject({ arbiterFee: "0.1" });
  expect(desk.decided.find((c) => c.id === chemistry!.id)).toMatchObject({ arbiterFee: "1" });

  clock.advance(60_000);
  await tick();
  const settle = ledger.calls.find((c) => c.call === "settleWithSlashes")!;
  // Bond 10 + Fee 1 in the escrow, two Deposits of 1 in the deposit account.
  expect(settle).toEqual({
    call: "settleWithSlashes",
    escrowId,
    slashes: ["1"],
    payouts: {
      escrow: [
        { to: "brand", amount: "0.9" },
        { to: "arbiter", amount: "0.1" },
        { to: "operator", amount: "10" },
      ],
      deposits: [
        { to: { challenger: "brand" }, amount: "1" },
        { to: "arbiter", amount: "1" },
      ],
    },
  });
  expect(total(settle.payouts.escrow)).toBe("11");
  expect(total([...settle.payouts.escrow, ...settle.payouts.deposits])).toBe(ledger.held(escrowId));
  expect(await ledger.operatorRecord("baseline")).toEqual({ documents: 1, challengesUpheld: 1, totalSlashed: "1" });
});

test("only rejected Challenges: the Bond is untouched and each Deposit pays the Arbiter", async () => {
  const { brand, arbiter, ledger, clock, tick, docId, escrowId } = await deliver();
  await brand.challenge(docId, capacityChallenge);
  await arbiter.decide((await arbiter.challenges())[0]!.id, "rejected");
  clock.advance(60_000);
  await tick();
  const settle = ledger.calls.find((c) => c.call === "settleWithSlashes")!;
  expect(settle.payouts).toEqual({ escrow: [{ to: "operator", amount: "11" }], deposits: [{ to: "arbiter", amount: "1" }] });
  expect(total([...settle.payouts.escrow, ...settle.payouts.deposits])).toBe(ledger.held(escrowId));
  expect((await brand.document(docId)).escrow).toMatchObject({ bondLeft: "10" });
});

test("Deposit and Arbiter Fee are configurable; the Arbiter Fee never exceeds the Slash", async () => {
  const { brand, arbiter, ledger, clock, tick, docId, escrowId } = await deliver({
    challengeDeposit: "2.5",
    arbiterFee: "5",
    operators: { baseline: { operator: "op", bond: "4", fee: "1" } },
  });
  await brand.challenge(docId, capacityChallenge);
  expect(ledger.calls.find((c) => c.call === "lockDeposit")).toMatchObject({ amount: "2.5" });
  await arbiter.decide((await arbiter.challenges())[0]!.id, "upheld");
  expect((await arbiter.desk()).record.earned).toBe("0.4");
  clock.advance(60_000);
  await tick();
  const settle = ledger.calls.find((c) => c.call === "settleWithSlashes")!;
  expect(settle.payouts).toEqual({
    escrow: [{ to: "arbiter", amount: "0.4" }, { to: "operator", amount: "4.6" }],
    deposits: [{ to: { challenger: "brand" }, amount: "2.5" }],
  });
  expect(total([...settle.payouts.escrow, ...settle.payouts.deposits])).toBe(ledger.held(escrowId));
});
