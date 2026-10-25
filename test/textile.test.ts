import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { ours } from "../src/pipelines.js";
import { extraction, makePdf, startBoard } from "./seam.js";

const quote = "Cotton 60 % Polyester 35 % Elastane 5 %";
const sheet = () => makePdf([["Style Lumen Everyday Tee", quote, "Recycled content: 35 % of garment mass"]]);
const composition = (value: Record<string, number>) => ({ value, unit: "%", page: 1, quote });

/** Upload a textile Document under our Pipeline; Worker w1 does the first extraction Sieve, w2 the second. */
async function twoExtractions(first: Record<string, number>, second: Record<string, number>) {
  const { worker, brand } = startBoard({ pipelines: [ours] });
  const docId = await brand.upload(await sheet(), "textile");
  const [w1, w2] = [await worker("w1"), await worker("w2")];
  const j1 = (await w1.nextJob())!;
  expect(j1.template.name).toBe("textile");
  expect(await w1.submitJob(j1.id, extraction(j1, { fibre_composition: composition(first) }))).toMatchObject({ ok: true });
  const j2 = (await w2.nextJob())!;
  expect(await w2.submitJob(j2.id, extraction(j2, { fibre_composition: composition(second) }))).toMatchObject({ ok: true });
  const doc = await brand.document(docId);
  expect(doc.template).toBe("textile");
  return doc.fields.find((f) => f.name === "fibre_composition")!;
}

test("a textile Job carries the textile Template, Field for Field as in testdata/fields.json", async () => {
  const { worker, brand } = startBoard();
  await brand.upload(await sheet(), "textile");
  const job = (await (await worker("w1")).nextJob())!;
  const expected = JSON.parse(readFileSync(new URL("../testdata/fields.json", import.meta.url), "utf8")).textile;
  const unit = (u?: string) => u?.replace(/\s+/g, "");
  expect(Object.fromEntries(job.template.fields.map((f) => [f.name, { type: f.type, unit: unit(f.unit), highStake: f.highStake }]))).toEqual(
    Object.fromEntries(Object.entries(expected).map(([k, f]: [string, any]) => [k, { type: f.type, unit: unit(f.unit), highStake: f.highStake }])),
  );
});

test("two extraction Sieves agree on a fibre composition named and ordered differently, so it is final", async () => {
  expect(await twoExtractions({ Cotton: 60, Polyester: 35, Elastane: 5 }, { EL: 5, PES: 35, CO: 60.0 })).toMatchObject({
    status: "final",
    value: { cotton: 60, elastane: 5, polyester: 35 },
  });
});

test("a different fibre set or a different percentage is a disagreement", async () => {
  const first = { cotton: 60, polyester: 35, elastane: 5 };
  for (const second of <Record<string, number>[]>[{ cotton: 60, polyester: 40 }, { cotton: 65, polyester: 30, elastane: 5 }, { cotton: 60, polyamide: 35, elastane: 5 }])
    expect(await twoExtractions(first, second)).toMatchObject({ status: "disagreeing" });
});

test("a composition not adding to 100 fails submission validation, saying what it adds up to", async () => {
  const { worker, brand } = startBoard();
  await brand.upload(await sheet(), "textile");
  const w1 = await worker("w1");
  const job = (await w1.nextJob())!;
  const r = await w1.submitJob(job.id, extraction(job, { fibre_composition: composition({ cotton: 60, polyester: 35 }) }));
  expect(r.ok).toBe(false);
  expect(r.text).toMatch(/fibre_composition.*add up to 100.*95/);
  const fixed = extraction(job, { fibre_composition: composition({ cotton: 60, polyester: 35, elastane: 5 }) });
  expect(await w1.submitJob(job.id, fixed)).toMatchObject({ ok: true });
});
