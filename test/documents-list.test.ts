import { expect, test } from "vitest";
import { extraction, makePdf, startBoard } from "./seam.js";

const sheet = () => makePdf([["Voltaris NMC-800", "Rated capacity: 220 Ah"]]);
const capacity = { value: 220, unit: "Ah", qualifier: "rated", page: 1, quote: "Rated capacity: 220 Ah" };

test("the Documents list reflects uploads, deliveries and settlements", async () => {
  const board = startBoard({ challengeWindowMs: 60_000, arbiterFee: "0.1" });
  const id = await board.brand.upload(await sheet(), "battery", { name: "pack.pdf", supplier: "Kestrel" });

  let [row] = await board.brand.documents();
  expect(row).toMatchObject({ id, name: "pack.pdf", supplier: "Kestrel", template: "battery" });
  expect(row!.pipelines.baseline).toMatchObject({ status: "processing", counts: { final: 0, notStated: 0, challenged: 0 } });
  expect(row!.pipelines.baseline).not.toHaveProperty("bond");

  const w = await board.worker("w1");
  const job = (await w.nextJob())!;
  await w.submitJob(job.id, extraction(job, { rated_capacity_ah: { ...capacity, value: 200 } }));
  [row] = await board.brand.documents();
  const fields = job.template.fields.length;
  expect(row!.pipelines.baseline).toMatchObject({ status: "delivered", bond: "locked", closesAt: 60_000, counts: { final: 1, notStated: fields - 1, challenged: 0 } });

  expect((await board.brand.challenge(id, { pipeline: "baseline", field: "rated_capacity_ah", ...capacity })).status).toBe(201);
  [row] = await board.brand.documents();
  expect(row!.pipelines.baseline!.counts.challenged).toBe(1);

  const [c] = await board.arbiter.challenges();
  await board.arbiter.decide(c!.id, "upheld");
  board.clock.advance(60_000);
  await board.tick();
  [row] = await board.brand.documents();
  // A Slash is a tenth of the 10 USDC Bond; the Brand receives it less the 0.1 USDC Arbiter Fee.
  expect(row!.pipelines.baseline).toMatchObject({ status: "settled", bond: "slashed", received: "0.9", counts: { challenged: 1 } });
});

test("a clean settlement releases the Bond, and newer uploads come first", async () => {
  const board = startBoard({ challengeWindowMs: 60_000 });
  await board.brand.upload(await sheet(), "battery", { name: "old.pdf" });
  const w = await board.worker("w1");
  const job = (await w.nextJob())!;
  await w.submitJob(job.id, extraction(job, { rated_capacity_ah: capacity }));
  board.clock.advance(60_000);
  await board.tick();
  await board.brand.upload(await sheet(), "battery", { name: "new.pdf" });
  const [newer, older] = await board.brand.documents();
  expect(newer!.name).toBe("new.pdf");
  expect(older!.pipelines.baseline).toMatchObject({ status: "settled", bond: "released" });
  expect(older!.pipelines.baseline).not.toHaveProperty("received");
});
