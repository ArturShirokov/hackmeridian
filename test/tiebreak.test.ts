import { expect, test } from "vitest";
import { ours } from "../src/pipelines.js";
import { checkedMarkdown, extraction, makePdf, startBoard } from "./seam.js";

const sheet = () =>
  makePdf([["Cell C-32", "Capacity: 3200 mAh (nominal)", "Capacity 3.3 Ah nominal", "Chemistry: LiFePO4"], ["Recycled cobalt: 12 % minimum", "Recycled cobalt 16 % minimum"]]);
const capacity = { value: 3200, unit: "mAh", qualifier: "nominal", page: 1, quote: "Capacity: 3200 mAh (nominal)" };
const capacity33 = { value: 3.3, unit: "Ah", qualifier: "nominal", page: 1, quote: "Capacity 3.3 Ah nominal" };
const chemistry = { value: "LiFePO4", page: 1, quote: "Chemistry: LiFePO4" };
const cobalt12 = { value: 12, unit: "%", qualifier: "minimum", page: 2, quote: "Recycled cobalt: 12 % minimum" };
const cobalt16 = { ...cobalt12, value: 16, quote: "Recycled cobalt 16 % minimum" };

/** Our Pipeline: w1 and w2 do the two extraction Sieves (w1 also the checked Markdown between them); returns the board and a third Worker. */
async function afterTwo(first: Record<string, object>, second: Record<string, object>) {
  const board = startBoard({ pipelines: [ours] });
  const docId = await board.brand.upload(await sheet());
  const [w1, w2] = [await board.worker("w1"), await board.worker("w2")];
  const j1 = (await w1.nextJob())!;
  expect(await w1.submitJob(j1.id, extraction(j1, first))).toMatchObject({ ok: true });
  await checkedMarkdown(w1);
  const j2 = (await w2.nextJob())!;
  expect(await w2.submitJob(j2.id, extraction(j2, second))).toMatchObject({ ok: true });
  const field = async (name: string) => (await board.brand.document(docId)).fields.find((f) => f.name === name)!;
  return { ...board, docId, w1, w2, w3: await board.worker("w3"), field };
}

test("a tie-break from a third Worker covers only the disagreeing and failed-quote Fields, and agreeing with either earlier value makes it final", async () => {
  const b = await afterTwo(
    { rated_capacity_ah: capacity, battery_chemistry: chemistry, name: { value: "Cell C-32", page: 1, quote: "Cell C-32" } },
    { rated_capacity_ah: capacity33, battery_chemistry: chemistry, name: { value: "Cell C-32", page: 1, quote: "Cell C 99" } },
  );
  expect(await b.w1.nextJob()).toBeNull();
  expect(await b.w2.nextJob()).toBeNull();
  const tie = (await b.w3.nextJob())!;
  expect(tie).toMatchObject({ sieve: "tiebreak", view: "original", documentId: b.docId });
  expect(tie.template.fields.map((f) => f.name).sort()).toEqual(["name", "rated_capacity_ah"]);
  expect(await b.field("battery_chemistry")).toMatchObject({ status: "final", value: "LFP" });
  expect(b.ledger.calls.filter((c) => c.call === "openEscrow")).toHaveLength(0);

  expect(
    await b.w3.submitJob(tie.id, extraction(tie, { rated_capacity_ah: { ...capacity, value: 3.2, unit: "Ah" }, name: { value: "cell c-32", page: 1, quote: "Cell C-32" } })),
  ).toMatchObject({ ok: true });
  expect(await b.field("rated_capacity_ah")).toMatchObject({ status: "final", value: 3.2, unit: "Ah" });
  expect(await b.field("name")).toMatchObject({ status: "final" });
  expect(b.ledger.calls.filter((c) => c.call === "openEscrow")).toHaveLength(1);
});

test("when the two extraction Sieves agree on every Field there is no tie-break and the Document is delivered", async () => {
  const b = await afterTwo({ rated_capacity_ah: capacity }, { rated_capacity_ah: capacity });
  expect(await b.w3.nextJob()).toBeNull();
  expect(b.ledger.calls.filter((c) => c.call === "openEscrow")).toHaveLength(1);
});

test("a Field still split after the tie-break is Not stated with every competing quote and a copyable Supplier Request", async () => {
  const b = await afterTwo({ rated_capacity_ah: capacity }, { rated_capacity_ah: capacity33 });
  const tie = (await b.w3.nextJob())!;
  await b.w3.submitJob(tie.id, extraction(tie));
  const f = await b.field("rated_capacity_ah");
  expect(f).toMatchObject({ status: "not stated" });
  expect(f.quotes).toEqual([
    { page: 1, quote: "Capacity: 3200 mAh (nominal)" },
    { page: 1, quote: "Capacity 3.3 Ah nominal" },
  ]);
  expect(f.supplierRequest).toContain("Rated capacity");
  expect(f.supplierRequest).toContain("Capacity 3.3 Ah nominal");
  const page = (await b.brand.page(`/documents/${b.docId}`)).text;
  expect(page).toContain("Not stated");
  expect(page).toContain("Capacity: 3200 mAh (nominal)");
  expect(page).toContain("<textarea");
});

test("a high-stake Field whose two extraction values differ is Not stated at once, with no tie-break", async () => {
  const b = await afterTwo({ recycled_content_cobalt: cobalt12, rated_capacity_ah: capacity }, { recycled_content_cobalt: cobalt16, rated_capacity_ah: capacity33 });
  expect(await b.field("recycled_content_cobalt")).toMatchObject({
    status: "not stated",
    quotes: [
      { page: 2, quote: "Recycled cobalt: 12 % minimum" },
      { page: 2, quote: "Recycled cobalt 16 % minimum" },
    ],
  });
  const tie = (await b.w3.nextJob())!;
  expect(tie.template.fields.map((f) => f.name)).toEqual(["rated_capacity_ah"]);
  await b.w3.submitJob(tie.id, extraction(tie, { rated_capacity_ah: capacity }));
  expect(await b.field("recycled_content_cobalt")).toMatchObject({ status: "not stated" });
  expect(await b.field("rated_capacity_ah")).toMatchObject({ status: "final", value: 3.2 });
});

test("a high-stake Field gets a tie-break only when both extractions agree but a quote failed, and is final when the tie-break agrees", async () => {
  const b = await afterTwo({ recycled_content_cobalt: cobalt12 }, { recycled_content_cobalt: { ...cobalt12, quote: "cobalt 12 % min" } });
  const tie = (await b.w3.nextJob())!;
  expect(tie.template.fields.map((f) => f.name)).toEqual(["recycled_content_cobalt"]);
  await b.w3.submitJob(tie.id, extraction(tie, { recycled_content_cobalt: cobalt12 }));
  expect(await b.field("recycled_content_cobalt")).toMatchObject({ status: "final", value: 12 });
});

test("a high-stake Field whose tie-break differs from the value both extractions agreed on is Not stated", async () => {
  const b = await afterTwo({ recycled_content_cobalt: cobalt12 }, { recycled_content_cobalt: { ...cobalt12, quote: "cobalt 12 % min" } });
  const tie = (await b.w3.nextJob())!;
  await b.w3.submitJob(tie.id, extraction(tie, { recycled_content_cobalt: cobalt16 }));
  expect(await b.field("recycled_content_cobalt")).toMatchObject({ status: "not stated" });
});
