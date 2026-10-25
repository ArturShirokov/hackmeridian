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
    value: 220, unit: "Ah", qualifier: "rated", page: 1, quote: "Rated capacity: 220 Ah",
  });
  expect(doc.fields.find((f) => f.name === "battery_chemistry")).toMatchObject({ notStated: true });
  expect((await brand.page(`/documents/${docId}`)).text).toContain("Rated capacity: 220 Ah");
  expect(await w1.nextJob()).toBeNull();
});
