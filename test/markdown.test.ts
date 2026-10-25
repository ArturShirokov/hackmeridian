import { expect, test } from "vitest";
import { ours } from "../src/pipelines.js";
import { extraction, makePdf, startBoard } from "./seam.js";

const sheet = () => makePdf([["Cell C-32", "Capacity: 3200 mAh (nominal)"]]);
const markdown = "# Cell C-32\n\n| Capacity | 3200 mAh (nominal) |";
const capacity = { value: 3.2, unit: "Ah", qualifier: "nominal", page: 1, quote: "Capacity: 3200 mAh (nominal)" };

test("the Markdown Sieve's text, once the faithfulness Sieve passes it, is the second extraction Sieve's view", async () => {
  const { worker, brand } = startBoard({ pipelines: [ours] });
  const docId = await brand.upload(await sheet());
  const [w1, w2, w3] = [await worker("w1"), await worker("w2"), await worker("w3")];
  const e1 = (await w1.nextJob())!;
  await w1.submitJob(e1.id, extraction(e1, { rated_capacity_ah: capacity }));

  const md = (await w2.nextJob())!;
  expect(md).toMatchObject({ sieve: "markdown", view: "original" });
  expect(md.document).not.toHaveProperty("markdown");
  expect(await w2.nextJob()).toBeNull(); // nothing else until the Markdown is handed in
  expect(await w2.submitJob(md.id, { markdown })).toMatchObject({ ok: true });

  const check = (await w3.nextJob())!;
  expect(check).toMatchObject({ sieve: "faithfulness", document: { markdown } });
  expect(await w2.nextJob()).toBeNull(); // the second extraction waits for the check
  expect(await w3.submitJob(check.id, { pass: true })).toMatchObject({ ok: true });

  const e2 = (await w2.nextJob())!;
  expect(e2).toMatchObject({ sieve: "extract", view: "markdown", document: { markdown } });
  expect(await w2.submitJob(e2.id, extraction(e2, { rated_capacity_ah: capacity }))).toMatchObject({ ok: true });
  expect((await brand.document(docId)).fields.find((f) => f.name === "rated_capacity_ah")).toMatchObject({ status: "final", value: 3.2 });
});

test("a failed faithfulness check reruns the Markdown Sieve once, and the second extraction reads the rerun", async () => {
  const { worker, brand } = startBoard({ pipelines: [ours] });
  await brand.upload(await sheet());
  const w = await worker("w1");
  const e1 = (await w.nextJob())!;
  await w.submitJob(e1.id, extraction(e1));

  const md1 = (await w.nextJob())!;
  await w.submitJob(md1.id, { markdown: "# Cell C-23" });
  const check1 = (await w.nextJob())!;
  expect(await w.submitJob(check1.id, { pass: false, problems: ["name reads C-23, the original says C-32"] })).toMatchObject({ ok: true });

  const md2 = (await w.nextJob())!;
  expect(md2).toMatchObject({ sieve: "markdown" });
  expect(md2.id).not.toBe(md1.id);
  await w.submitJob(md2.id, { markdown });
  const check2 = (await w.nextJob())!;
  expect(check2).toMatchObject({ sieve: "faithfulness", document: { markdown } });
  await w.submitJob(check2.id, { pass: true });

  const e2 = (await (await worker("w2")).nextJob())!;
  expect(e2).toMatchObject({ sieve: "extract", document: { markdown } });
});

test("a second failed faithfulness check delivers every Field as Not stated, with the first extraction's quotes, and opens the escrow", async () => {
  const { worker, brand, ledger } = startBoard({ pipelines: [ours] });
  const docId = await brand.upload(await sheet());
  const w = await worker("w1");
  const e1 = (await w.nextJob())!;
  await w.submitJob(e1.id, extraction(e1, { rated_capacity_ah: capacity }));
  for (let i = 0; i < 2; i++) {
    const md = (await w.nextJob())!;
    await w.submitJob(md.id, { markdown: "# wrong" });
    const check = (await w.nextJob())!;
    await w.submitJob(check.id, { pass: false, problems: ["wrong"] });
  }
  expect(await w.nextJob()).toBeNull();
  expect(await (await worker("w2")).nextJob()).toBeNull();

  const doc = await brand.document(docId);
  expect(doc.fields.every((f) => f.status === "not stated" && !!f.supplierRequest === (f.author === "Supplier"))).toBe(true);
  const cap = doc.fields.find((f) => f.name === "rated_capacity_ah")!;
  expect(cap.quotes).toMatchObject([{ page: 1, quote: "Capacity: 3200 mAh (nominal)" }]);
  expect(cap.supplierRequest).toContain("Capacity: 3200 mAh (nominal)");
  expect(ledger.calls.filter((c) => c.call === "openEscrow")).toHaveLength(1);
  expect(doc.escrow).toMatchObject({ status: "delivered" });
});

test("malformed Markdown and faithfulness results are rejected with what is wrong", async () => {
  const { worker, brand } = startBoard({ pipelines: [ours] });
  await brand.upload(await sheet());
  const w = await worker("w1");
  const e1 = (await w.nextJob())!;
  await w.submitJob(e1.id, extraction(e1));
  const md = (await w.nextJob())!;
  expect(await w.submitJob(md.id, extraction(md))).toMatchObject({ ok: false, text: expect.stringMatching(/markdown/) });
  expect(await w.submitJob(md.id, { markdown: "" })).toMatchObject({ ok: false });
  await w.submitJob(md.id, { markdown });
  const check = (await w.nextJob())!;
  expect(await w.submitJob(check.id, { pass: false })).toMatchObject({ ok: false, text: expect.stringMatching(/problems/) });
  expect(await w.submitJob(check.id, { pass: "yes" })).toMatchObject({ ok: false });
});

test("on a scan with no text layer, quotes are checked against the checked Markdown", async () => {
  const { worker, brand } = startBoard({ pipelines: [ours] });
  const docId = await brand.upload(await makePdf([[]]));
  const [w1, w2] = [await worker("w1"), await worker("w2")];
  const inMarkdown = { ...capacity, quote: "3200 mAh (nominal)" };
  const name = { value: "Cell C-32", page: 1, quote: "Cell C-99" }; // not in the Markdown
  const e1 = (await w1.nextJob())!;
  await w1.submitJob(e1.id, extraction(e1, { rated_capacity_ah: inMarkdown, manufacturing_place: name }));
  const md = (await w1.nextJob())!;
  await w1.submitJob(md.id, { markdown });
  const check = (await w1.nextJob())!;
  await w1.submitJob(check.id, { pass: true });
  const e2 = (await w2.nextJob())!;
  await w2.submitJob(e2.id, extraction(e2, { rated_capacity_ah: inMarkdown, manufacturing_place: name }));

  const fields = (await brand.document(docId)).fields;
  expect(fields.find((f) => f.name === "rated_capacity_ah")).toMatchObject({ status: "final", withheld: true }); // until the tie-break is in
  expect(fields.find((f) => f.name === "manufacturing_place")).toMatchObject({ status: "converging", tieBreak: true });
  const w3 = await worker("w3");
  const tie = (await w3.nextJob())!;
  await w3.submitJob(tie.id, extraction(tie));
  const delivered = (await brand.document(docId)).fields;
  expect(delivered.find((f) => f.name === "rated_capacity_ah")).toMatchObject({ status: "final", value: 3.2, evidence: { rects: [] } }); // a scan: no boxes
  expect(delivered.find((f) => f.name === "manufacturing_place")).toMatchObject({ status: "not stated" });
});
