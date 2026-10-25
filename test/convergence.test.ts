import { expect, test } from "vitest";
import { baseline, ours } from "../src/pipelines.js";
import { checkedMarkdown, extraction, makePdf, startBoard } from "./seam.js";

const sheet = () => makePdf([["Cell C-32", "Capacity: 3200 mAh (nominal)", "Chemistry: LiFePO4"], ["Nominal voltage 3.2 V"]]);
const capacityMah = { value: 3200, unit: "mAh", qualifier: "nominal", page: 1, quote: "Capacity: 3200 mAh (nominal)" };
const capacityAh = { ...capacityMah, value: 3.2, unit: "Ah" };
const chemistry = { value: "LiFePO4", page: 1, quote: "Chemistry: LiFePO4" };

/** Upload under our Pipeline; Worker w1 does the first extraction Sieve, w2 the second. */
async function twoExtractions(first: Record<string, object>, second: Record<string, object>) {
  const { worker, brand } = startBoard({ pipelines: [ours] });
  const docId = await brand.upload(await sheet());
  const [w1, w2] = [await worker("w1"), await worker("w2")];
  const j1 = (await w1.nextJob())!;
  expect(await w1.submitJob(j1.id, extraction(j1, first))).toMatchObject({ ok: true });
  expect((await brand.document(docId)).fields.every((f) => f.status === "converging")).toBe(true);
  await checkedMarkdown(w1);
  const j2 = (await w2.nextJob())!;
  expect(await w2.submitJob(j2.id, extraction(j2, second))).toMatchObject({ ok: true });
  const doc = await brand.document(docId);
  return { brand, docId, field: (name: string) => doc.fields.find((f) => f.name === name)! };
}

test("two extraction Sieves agree on capacity 3200 mAh vs 3.2 Ah nominal, so the Field is final", async () => {
  const { field, brand, docId } = await twoExtractions(
    { rated_capacity_ah: capacityMah, battery_chemistry: chemistry },
    { rated_capacity_ah: capacityAh, battery_chemistry: { ...chemistry, value: "LFP" } },
  );
  expect(field("rated_capacity_ah")).toMatchObject({ status: "final", value: 3.2, unit: "Ah", qualifier: "nominal" });
  expect(field("battery_chemistry")).toMatchObject({ status: "final", value: "LFP" });
  expect(field("name")).toMatchObject({ status: "not stated", quotes: [] }); // both said Not stated
  expect((await brand.page(`/documents/${docId}`)).text).toMatch(/final/);
});

test("a different value, a different qualifier, or Not stated against a value is a disagreement", async () => {
  const voltage = { value: 3.2, unit: "V", qualifier: "nominal", page: 2, quote: "Nominal voltage 3.2 V" };
  const { field, brand, docId } = await twoExtractions(
    { rated_capacity_ah: capacityMah, nominal_voltage_v: voltage, battery_chemistry: chemistry },
    { rated_capacity_ah: { ...capacityAh, value: 3.3 }, battery_chemistry: { ...chemistry, value: "NMC811" } },
  );
  expect(field("rated_capacity_ah")).toMatchObject({ status: "converging", tieBreak: true });
  expect(field("rated_capacity_ah")).not.toHaveProperty("value");
  expect(field("nominal_voltage_v")).toMatchObject({ status: "converging", tieBreak: true });
  expect(field("battery_chemistry")).toMatchObject({ status: "converging", tieBreak: true });
  expect((await brand.page(`/documents/${docId}`)).text).toMatch(/disagreeing/);

  const qualifier = await twoExtractions({ rated_capacity_ah: capacityMah }, { rated_capacity_ah: { ...capacityAh, qualifier: "rated" } });
  expect(qualifier.field("rated_capacity_ah")).toMatchObject({ status: "converging", tieBreak: true });
});

test("text is compared trimmed and case-folded", async () => {
  const { field } = await twoExtractions(
    { name: { value: "Cell C-32", page: 1, quote: "Cell C-32" } },
    { name: { value: "  cell c-32 ", page: 1, quote: "Cell   C-32" } },
  );
  expect(field("name")).toMatchObject({ status: "final", value: "Cell C-32" });
});

test("a quote not found in the Document's text layer counts as disagreement, even when the values agree", async () => {
  const { field } = await twoExtractions(
    { rated_capacity_ah: capacityMah },
    { rated_capacity_ah: { ...capacityAh, quote: "Capacity: 3.2 Ah" } },
  );
  expect(field("rated_capacity_ah")).toMatchObject({ status: "converging", tieBreak: true });
});

test("next_job never includes another Sieve's Field values", async () => {
  const { worker, brand } = startBoard({ pipelines: [ours] });
  await brand.upload(await sheet());
  const [w1, w2] = [await worker("w1"), await worker("w2")];
  const j1 = (await w1.nextJob())!;
  await w1.submitJob(j1.id, extraction(j1, { rated_capacity_ah: capacityMah }));
  await checkedMarkdown(w1, "# Cell C-32");
  const j2 = (await w2.nextJob())!;
  expect(JSON.stringify(j2)).not.toMatch(/"(value|quote|notStated|result)":/);
  expect(j2.document).toEqual({ ...j1.document, markdown: "# Cell C-32" });
});

test("a Worker that did one extraction Sieve on a Document is never offered a second on it", async () => {
  const { worker, brand } = startBoard({ pipelines: [ours] });
  const docA = await brand.upload(await sheet());
  const w1 = await worker("w1");
  const j1 = (await w1.nextJob())!;
  expect(j1.documentId).toBe(docA);
  await w1.submitJob(j1.id, extraction(j1));
  await checkedMarkdown(w1);
  expect(await w1.nextJob()).toBeNull();

  const docB = await brand.upload(await sheet());
  expect((await w1.nextJob())!.documentId).toBe(docB);
  expect((await (await worker("w2")).nextJob())!.documentId).toBe(docA);
});

test("a Worker that did an extraction Sieve on a Document in one Pipeline is never offered one on it in another", async () => {
  const { worker, brand } = startBoard({ pipelines: [ours, baseline] });
  const docId = await brand.upload(await sheet());
  const [w1, w2] = [await worker("w1"), await worker("w2")];
  const ourFirst = (await w1.nextJob())!;
  await w1.submitJob(ourFirst.id, extraction(ourFirst));
  await checkedMarkdown(w1); // w1 may still do our Markdown and faithfulness Sieves
  expect(await w1.nextJob()).toBeNull(); // neither the Baseline's extraction nor our second one

  const theBaselines = (await w2.nextJob())!;
  expect(theBaselines).toMatchObject({ documentId: docId, sieve: "extract", view: "original" });
  await w2.submitJob(theBaselines.id, extraction(theBaselines));
  expect(await w2.nextJob()).toBeNull(); // our second extraction needs a third Worker

  expect(await (await worker("w3")).nextJob()).toMatchObject({ documentId: docId, sieve: "extract", view: "markdown" });
});
