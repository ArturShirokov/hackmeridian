import { expect, test } from "vitest";
import { extraction, makePdf, startBoard } from "./seam.js";

const sheet = () => makePdf([["Voltaris NMC-800", "Rated capacity: 220 Ah"], ["Chemistry: NMC811"]]);
const wrongCapacity = { value: 22, unit: "Ah", qualifier: "rated", page: 1, quote: "Rated capacity: 220 Ah" };
const capacityChallenge = { field: "rated_capacity_ah", page: 1, quote: "Rated capacity: 220 Ah", value: 220, unit: "Ah", qualifier: "rated" };

async function deliver(opts: Parameters<typeof startBoard>[0] = {}) {
  const board = startBoard(opts);
  const docId = await board.brand.upload(await sheet());
  const w = await board.worker("w1");
  const job = (await w.nextJob())!;
  expect(await w.submitJob(job.id, extraction(job, { rated_capacity_ah: wrongCapacity }))).toMatchObject({ ok: true });
  return { ...board, docId };
}

test("one upheld and one rejected Challenge: the upheld one corrects the Field and Slashes one tenth of the Bond to the Brand", async () => {
  const board = await deliver({ challengeWindowMs: 60_000 });
  const { brand, arbiter, docId } = board;

  expect((await brand.challenge(docId, capacityChallenge)).status).toBe(201);
  // A Not stated Field can be Challenged too: the Document did state it after all.
  const chemistry = await brand.challenge(docId, { field: "battery_chemistry", page: 2, quote: "Chemistry: NMC811", value: "NMC811" });
  expect(chemistry.status).toBe(201);

  const open = await arbiter.challenges();
  expect(open).toHaveLength(2);
  expect(open[0]).toMatchObject({
    documentId: docId,
    field: "rated_capacity_ah",
    challenged: { value: 22, unit: "Ah", page: 1 },
    page: 1,
    quote: "Rated capacity: 220 Ah",
    value: 220,
  });
  expect(open[1]).toMatchObject({ field: "battery_chemistry", challenged: { notStated: true } });
  const page = (await arbiter.page()).text;
  expect(page).toContain("Chemistry: NMC811");
  expect(page).toContain(`/documents/${docId}/file`);

  expect((await arbiter.decide(open[0]!.id, "upheld")).status).toBe(200);
  expect((await arbiter.decide(open[1]!.id, "rejected")).status).toBe(200);
  expect(await arbiter.challenges()).toHaveLength(0);
  expect((await arbiter.decide(open[0]!.id, "rejected")).status).toBe(409);

  const doc = await brand.document(docId);
  expect(doc.fields.find((f) => f.name === "rated_capacity_ah")).toMatchObject({ value: 220, unit: "Ah", corrected: true });
  expect(doc.fields.find((f) => f.name === "battery_chemistry")).toMatchObject({ notStated: true });
  expect((await brand.page(`/documents/${docId}`)).text).toContain("corrected by Challenge");

  board.clock.advance(60_000);
  await board.tick();
  const escrowId = board.ledger.calls[0]!.escrowId;
  expect(board.ledger.calls.filter((c) => c.call !== "openEscrow")).toEqual([{ call: "settleWithSlashes", escrowId, slashes: ["1"] }]);
  expect(await board.ledger.operatorRecord("baseline")).toEqual({ documents: 1, challengesUpheld: 1, totalSlashed: "1" });
  expect((await brand.page(`/documents/${docId}`)).text).toContain("1 USDC Slashed to the Brand");
});

test("Slashes are capped at the whole Bond", async () => {
  const board = await deliver({ operators: { baseline: { operator: "op", bond: "2.5", fee: "1" } } });
  const { brand, arbiter, docId } = board;
  for (let i = 0; i < 12; i++) await brand.challenge(docId, capacityChallenge);
  for (const c of await arbiter.challenges()) await arbiter.decide(c.id, "upheld");

  board.clock.advance(5 * 60_000);
  await board.tick();
  const settle = board.ledger.calls.find((c) => c.call === "settleWithSlashes")!;
  expect(settle.slashes).toEqual([...Array(10).fill("0.25"), "0", "0"]);
  expect(await board.ledger.operatorRecord("op")).toMatchObject({ challengesUpheld: 12, totalSlashed: "2.5" });
});

test("a Challenge after the Challenge Window is refused", async () => {
  const board = await deliver({ challengeWindowMs: 60_000 });
  board.clock.advance(60_000);
  const r = await board.brand.challenge(board.docId, capacityChallenge);
  expect(r.status).toBe(409);
  expect(r.body.error).toMatch(/Challenge Window/);
  expect(await board.arbiter.challenges()).toHaveLength(0);
});

test("settlement waits for the Arbiter while a Challenge is undecided", async () => {
  const board = await deliver({ challengeWindowMs: 60_000 });
  const { brand, arbiter, docId } = board;
  await brand.challenge(docId, capacityChallenge);
  board.clock.advance(60_000);
  await board.tick();
  expect(board.ledger.calls.filter((c) => c.call !== "openEscrow")).toEqual([]);

  await arbiter.decide((await arbiter.challenges())[0]!.id, "rejected");
  await board.tick();
  expect(board.ledger.calls.filter((c) => c.call !== "openEscrow").map((c) => c.call)).toEqual(["settleClean"]);
});

test("a Challenge must name a Template Field and cite a page of the Document and a quote", async () => {
  const { brand, docId } = await deliver();
  expect((await brand.challenge(docId, { ...capacityChallenge, page: 3 })).status).toBe(400);
  expect((await brand.challenge(docId, { ...capacityChallenge, quote: "" })).status).toBe(400);
  expect((await brand.challenge(docId, { ...capacityChallenge, field: "nope" })).status).toBe(400);
  expect((await brand.challenge("no-such-doc", capacityChallenge)).status).toBe(404);
});

test("the Brand files a Challenge from the Document page's form", async () => {
  const { brand, arbiter, docId, web } = await deliver();
  expect((await brand.page(`/documents/${docId}/challenge`)).text).toContain('name="quote"');
  const form = new FormData();
  for (const [k, v] of Object.entries({ field: "rated_capacity_ah", page: "1", quote: "Rated capacity: 220 Ah", value: "220", unit: "Ah" }))
    form.set(k, v);
  const res = await web.request(`/documents/${docId}/challenges`, { method: "POST", body: form });
  expect(res.status).toBe(303);
  expect(await arbiter.challenges()).toMatchObject([{ field: "rated_capacity_ah", value: 220, unit: "Ah" }]);
});
