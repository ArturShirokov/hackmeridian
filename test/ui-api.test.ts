import { expect, test } from "vitest";
import { baseline, ours } from "../src/pipelines.js";
import { checkedMarkdown, extraction, makePdf, startBoard } from "./seam.js";

const sheet = () => makePdf([["Voltaris NMC-800", "Rated capacity: 220 Ah"], ["Chemistry: NMC811"]]);
const capacity = { value: 220, unit: "Ah", qualifier: "rated", page: 1, quote: "Rated capacity: 220 Ah" };
const operators = {
  ours: { operator: "origyn", bond: "20", fee: "2" },
  baseline: { operator: "one-pass", bond: "10", fee: "1" },
};

/** Both Pipelines on one Document; w1/w2/w3 as in side-by-side.test.ts, stopping before our second extraction. */
async function twoPipelines() {
  const board = startBoard({ pipelines: [ours, baseline], operators, challengeWindowMs: 60_000 });
  const docId = await board.brand.upload(await sheet(), "battery", { name: "voltaris-pack.pdf", supplier: "Voltaris" });
  const [w1, w2, w3] = [await board.worker("w1"), await board.worker("w2"), await board.worker("w3")];
  const j1 = (await w1.nextJob())!;
  await w1.submitJob(j1.id, extraction(j1, { rated_capacity_ah: capacity }));
  const jb = (await w2.nextJob())!;
  await w2.submitJob(jb.id, extraction(jb, { rated_capacity_ah: { ...capacity, value: 22 } }));
  await checkedMarkdown(w1);
  return { ...board, docId, w1, w2, w3 };
}

test("a Worker on our second extraction cannot read the Baseline's delivered values from the Brand's API", async () => {
  const b = await twoPipelines();
  const j2 = (await b.w3.nextJob())!;
  expect(j2.sieve).toBe("extract");

  const doc = await b.brand.document(b.docId);
  const text = JSON.stringify(doc);
  expect(text).not.toContain("220");
  expect(text).not.toContain("Rated capacity: 220 Ah");
  // Statuses still flow: the Baseline delivered, its capacity is final but withheld.
  expect(doc.view("baseline").fields.find((f) => f.name === "rated_capacity_ah")).toEqual(
    expect.objectContaining({ status: "final", withheld: true }),
  );
  expect(doc.pipelines.baseline).toMatchObject({ status: "delivered", counts: { final: 1 } });
  expect(doc.differs).toEqual([]);
  expect((await b.brand.export(b.docId, "baseline")).status).toBe(409);
  expect(JSON.stringify(await b.brand.jobs())).not.toContain("220");

  await b.w3.submitJob(j2.id, extraction(j2, { rated_capacity_ah: capacity }));
  const after = await b.brand.document(b.docId);
  expect(after.view("baseline").fields.find((f) => f.name === "rated_capacity_ah")).toMatchObject({ status: "final", value: 22, display: "22 Ah (rated)" });
  expect(after.view("ours").fields.find((f) => f.name === "rated_capacity_ah")).toMatchObject({
    status: "final",
    value: 220,
    evidence: { page: 1, quote: "Rated capacity: 220 Ah", mark: "220 Ah" },
  });
  expect(after.differs).toEqual(["rated_capacity_ah"]);
});
