import { expect, test } from "vitest";
import { extraction, makePdf, startBoard } from "./seam.js";

const sheet = () => makePdf([["Voltaris NMC-800", "Rated capacity: 220 Ah"], ["Nominal voltage 360 V"]]);

test("a Worker does the Baseline extraction Job and the Brand sees its Field values", async () => {
  const { worker, brand } = startBoard();
  const w1 = await worker("w1");
  expect(await w1.nextJob()).toBeNull();

  const docId = await brand.upload(await sheet());
  const job = (await w1.nextJob())!;
  expect(job).toMatchObject({ documentId: docId, sieve: "extract", view: "original" });
  expect(job.instructions).toMatch(/notStated/);
  expect(job.template.name).toBe("battery");
  expect(job.template.fields).toContainEqual(
    expect.objectContaining({ name: "rated_capacity_ah", type: "quantity", unit: "Ah" }),
  );
  expect(job.document.text).toEqual(["Voltaris NMC-800\nRated capacity: 220 Ah", "Nominal voltage 360 V"]);
  const file = await brand.page(new URL(job.document.url).pathname);
  expect(file.status).toBe(200);

  const result = extraction(job, {
    rated_capacity_ah: { value: 220, unit: "Ah", qualifier: "rated", page: 1, quote: "Rated capacity: 220 Ah" },
    nominal_voltage_v: { value: 360, unit: "V", qualifier: "nominal", page: 2, quote: "Nominal voltage 360 V" },
  });
  expect(await w1.submitJob(job.id, result)).toMatchObject({ ok: true });

  const doc = await brand.document(docId);
  expect(doc.fields).toHaveLength(job.template.fields.length);
  expect(doc.fields.find((f) => f.name === "rated_capacity_ah")).toMatchObject({
    value: 220, unit: "Ah", qualifier: "rated", evidence: { page: 1, quote: "Rated capacity: 220 Ah" },
  });
  expect(doc.fields.find((f) => f.name === "battery_chemistry")).toMatchObject({ status: "not stated" });
  expect((await brand.page(`/documents/${docId}`)).text).toContain("Rated capacity: 220 Ah");
  expect(await w1.nextJob()).toBeNull();
});

test("a malformed submission is rejected with what is wrong, and the Worker can fix it and resubmit", async () => {
  const { worker, brand } = startBoard();
  const docId = await brand.upload(await sheet());
  const w1 = await worker("w1");
  const job = (await w1.nextJob())!;
  const capacity = { value: 220, unit: "Ah", qualifier: "rated", page: 1, quote: "Rated capacity: 220 Ah" };
  const full = extraction(job, { rated_capacity_ah: capacity });

  const cases: [unknown, RegExp][] = [
    [{ fields: full.fields.filter((f) => f.field !== "battery_chemistry") }, /missing.*battery_chemistry/],
    [{ fields: [...full.fields, { field: "colour", notStated: true }] }, /unknown Field "colour"/],
    [{ fields: [...full.fields, { field: "manufacturing_place", notStated: true }] }, /"manufacturing_place" given more than once/],
    [extraction(job, { rated_capacity_ah: { ...capacity, value: "220" } }), /rated_capacity_ah.*number/],
    [extraction(job, { rated_capacity_ah: { ...capacity, unit: undefined } }), /rated_capacity_ah.*unit/],
    [extraction(job, { rated_capacity_ah: { ...capacity, qualifier: "peak" } }), /rated_capacity_ah.*qualifier "peak"/],
    [extraction(job, { rated_capacity_ah: { ...capacity, page: 5 } }), /rated_capacity_ah.*page 5.*2 pages/],
    [extraction(job, { rated_capacity_ah: { ...capacity, quote: undefined } }), /quote/],
    ["just text", /fields/],
  ];
  for (const [result, message] of cases) {
    const r = await w1.submitJob(job.id, result);
    expect(r.ok, JSON.stringify(result).slice(0, 200)).toBe(false);
    expect(r.text).toMatch(message);
  }
  expect((await brand.document(docId)).fields.find((f) => f.name === "rated_capacity_ah")).not.toHaveProperty("value");

  expect(await w1.submitJob(job.id, full)).toMatchObject({ ok: true });
});
