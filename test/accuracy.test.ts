import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { accuracyBoard, deliveredBy, record, replay, score, type Expected, type Run } from "../src/accuracy.js";

const expected: Expected = {
  document: "cell.pdf",
  template: "battery",
  fields: {
    rated_capacity_ah: { value: 3.2, unit: "Ah", qualifier: "nominal", page: 1, quote: "Nominal capacity 3200 mAh" },
    battery_chemistry: { value: "NMC811", page: 1, quote: "NMC 811" },
    battery_identifier: "Not stated",
    manufacturing_date: { value: "2027-02", page: 1, quote: "February 2027" },
  },
};
const capacity = { value: 3200, unit: "mAh", qualifier: "nominal", page: 1, quote: "Nominal capacity 3200 mAh" };

test("a Field equal after normalising is Correct, Not stated against Not stated is Correct, others are listed", () => {
  const [ours] = score([expected], {
    ours: {
      "cell.pdf": [
        { field: "rated_capacity_ah", ...capacity, status: "final" },
        { field: "battery_chemistry", value: "nmc-811", page: 1, quote: "NMC 811", status: "final" },
        { field: "battery_identifier", status: "not stated", quotes: [] },
        { field: "manufacturing_date", status: "not stated", quotes: [] },
      ],
    },
  });
  expect(ours).toEqual({
    pipeline: "ours",
    operator: "ours",
    fields: 4,
    correct: 3,
    notStated: 2,
    incorrect: [{ document: "cell.pdf", field: "manufacturing_date", expected: "2027-02", delivered: "Not stated" }],
  });
});

test("a wrong qualifier and a Document never delivered are not Correct", () => {
  const [baseline] = score([expected, { ...expected, document: "other.pdf" }], {
    baseline: {
      "cell.pdf": [
        { field: "rated_capacity_ah", ...capacity, qualifier: "typical", status: "final" },
        { field: "battery_chemistry", value: "NMC811", page: 1, quote: "NMC 811", status: "final" },
        { field: "battery_identifier", status: "not stated", quotes: [] },
        { field: "manufacturing_date", value: "2027-02", page: 1, quote: "February 2027", status: "final" },
      ],
    },
  });
  expect(baseline!.fields).toBe(8);
  expect(baseline!.correct).toBe(3);
  expect(baseline!.incorrect[0]).toEqual({
    document: "cell.pdf",
    field: "rated_capacity_ah",
    expected: "3.2 Ah (nominal)",
    delivered: "3200 mAh (typical)",
  });
  expect(baseline!.incorrect.slice(1).map((i) => [i.document, i.delivered])).toEqual(Array(4).fill(["other.pdf", "not delivered"]));
});

test("a recorded run replays to the same score: ours holds on the planted error, the Baseline delivers 16 %", async () => {
  const dir = new URL("../testdata/", import.meta.url);
  const file = "battery-04-helion-storage-module.pdf";
  const exp: Expected = JSON.parse(readFileSync(new URL(`expected/${file.replace(".pdf", ".json")}`, dir), "utf8"));
  const readPdf = async (f: string) => new Uint8Array(readFileSync(new URL(`documents/${f}`, dir)));
  const asSubmitted = (overrides: Record<string, object> = {}) => ({
    fields: Object.entries(exp.fields).map(([field, v]) => {
      if (v === "Not stated") return { field, notStated: true };
      const { qualifier, ...rest } = v;
      return { field, ...rest, ...(qualifier && { qualifier }), ...overrides[field] };
    }),
  });

  let t = 0;
  const board = accuracyBoard(() => t);
  const run: Run = { documents: [], events: [] };
  record(board, run, () => t);
  run.documents.push({ id: (await board.upload(await readPdf(file), "battery")).id, file, template: "battery" });

  const take = (w: string) => {
    t += 1000;
    return board.nextJob(w)!;
  };
  const submit = async (w: string, id: string, result: unknown) => {
    t += 1000;
    expect(await board.submitJob(w, id, result)).toEqual({ ok: true });
  };
  await submit("w1", take("w1").id, asSubmitted()); // ours, extract from the original
  const base = take("w3"); // the Baseline's one extraction
  await submit("w3", base.id, asSubmitted({ recycled_content_lithium: { value: 16, page: 1, quote: "16 % recycled lithium" } }));
  await submit("w2", take("w2").id, { markdown: "# Helion" });
  await submit("w2", take("w2").id, { pass: true });
  await submit("w2", take("w2").id, asSubmitted()); // ours, extract from the Markdown

  const known = [
    { pipeline: "ours", operator: "ours", fields: 25, correct: 25, notStated: 5, incorrect: [] },
    {
      pipeline: "baseline",
      operator: "baseline",
      fields: 25,
      correct: 24,
      notStated: 5,
      incorrect: [{ document: file, field: "recycled_content_lithium", expected: "6 %", delivered: "16 %" }],
    },
  ];
  expect(score([exp], deliveredBy(board, run.documents))).toEqual(known);

  const cached: Run = JSON.parse(JSON.stringify(run));
  const replayed = await replay(cached, readPdf);
  expect(score([exp], deliveredBy(replayed.board, replayed.documents))).toEqual(known);
});
