import { expect, test } from "vitest";
import { baseline, ours } from "../src/pipelines.js";
import { makePdf, startBoard } from "./seam.js";

const sheet = () => makePdf([["Voltaris NMC-800", "Rated capacity: 220 Ah"]]);
const capacity = { value: 220, unit: "Ah", qualifier: "rated", page: 1, quote: "Rated capacity: 220 Ah" };

/** A board with the Baseline and one outside Operator that has claimed the Document, plus a valid delivery for it. */
async function claimed() {
  const board = startBoard({ challengeWindowMs: 60_000 });
  const docId = await board.brand.upload(await sheet());
  const op = await board.outsideOperator();
  board.ledger.fund(op.address, "10");
  await op.claim(docId);
  const battery = (await board.brand.templates()).find((t) => t.name === "battery")!;
  const fields = battery.fields.map((f) => ({ field: f.name, ...(f.name === "rated_capacity_ah" ? capacity : { notStated: true }) }));
  return { board, docId, op, fields };
}

const plan = { id: "plan", label: "Planner", view: "original", model: "claude-opus", result: "split into 2 sub-agents", start: 1000, end: 5000 };
const tables = { id: "tables", parent: "plan", label: "Table reader", view: "pdftotext output", model: "gpt-5", result: "3 tables read", start: 1200, end: 3000 };

test("an outside Operator's nested Spans, reported live and then with deliver, round-trip to the Brand", async () => {
  const { board, docId, op, fields } = await claimed();
  expect(await op.reportSpan(docId, { ...plan, end: undefined, result: "planning" })).toMatchObject({ ok: true });
  let view = (await board.brand.document(docId)).view(op.address);
  expect(view.trace).toEqual([{ id: "plan", label: "Planner", view: "original", model: "claude-opus", start: 1000 }]);

  expect(await op.reportSpan(docId, tables)).toMatchObject({ ok: true });
  expect((await board.brand.document(docId)).view(op.address).trace!.map((s) => [s.id, s.parent])).toEqual([["plan", undefined], ["tables", "plan"]]);

  expect((await op.deliver(docId, fields, { trace: [plan, tables] })).text).toMatch(/^delivered/);
  const w = await board.worker("w1");
  const job = (await w.nextJob())!;
  await w.submitJob(job.id, { fields: job.template.fields.map((f) => ({ field: f.name, notStated: true })) });
  view = (await board.brand.document(docId)).view(op.address);
  expect(view.trace).toEqual([plan, tables]);
});

test("report_span and deliver reject malformed Spans and say what is wrong", async () => {
  const { board, docId, op, fields } = await claimed();
  const bad = async (span: object) => (await op.reportSpan(docId, span)).text;
  expect(await bad({ ...plan, label: "" })).toMatch(/rejected:.*label/s);
  expect(await bad({ ...plan, result: "two\nlines" })).toMatch(/one line/);
  expect(await bad({ ...plan, end: 10 })).toMatch(/end must not be before start/);
  expect(await bad({ ...plan, colour: "red" })).toMatch(/colour/);
  expect(await bad(tables)).toMatch(/parent "plan" must be a Span reported before it/);

  const r = await op.deliver(docId, fields, { trace: [tables, { ...plan, end: undefined }] });
  expect(r.ok).toBe(false);
  expect(r.text).toContain('trace: Span "tables": parent "plan" must be a Span reported before it');
  expect(r.text).toContain('trace: Span "plan": a delivered Trace needs an end on every Span');
  expect((await op.deliver(docId, fields, { trace: [{ start: 1 }] })).text).toMatch(/^trace: /);
  expect((await board.brand.document(docId)).view(op.address).trace).toBeUndefined();
});

test("a delivery without a Trace is accepted and shows as one Black box station", async () => {
  const { board, docId, op, fields } = await claimed();
  expect((await op.deliver(docId, fields)).text).toMatch(/^delivered/);
  const view = (await board.brand.document(docId)).view(op.address);
  expect(view.trace).toBeUndefined();
  expect(view.stations).toMatchObject([{ label: "Black box", state: "done" }]);
});

test("our Pipelines emit their Trace from their Sieve Jobs: one Span per Sieve, with the Worker that ran it", async () => {
  const board = startBoard({ pipelines: [ours, baseline] });
  const docId = await board.brand.upload(await sheet());
  const claude = await board.worker("Claude Code");
  const original = (await claude.nextJob())!;
  board.clock.advance(4000);
  let doc = await board.brand.document(docId);
  expect(doc.view("ours").trace).toEqual([{ id: "sieve-0", label: "Original", view: "original", model: "Claude Code", start: 0 }]);
  expect(doc.view("baseline").trace).toEqual([]);

  const open = await board.worker("OpenCode");
  const base = (await open.nextJob())!;
  await open.submitJob(base.id, { fields: base.template.fields.map((f) => ({ field: f.name, notStated: true })) });
  await claude.submitJob(original.id, { fields: original.template.fields.map((f) => ({ field: f.name, ...(f.name === "rated_capacity_ah" ? capacity : { notStated: true }) })) });
  board.clock.advance(1000);
  expect((await open.nextJob())!.sieve).toBe("markdown");
  doc = await board.brand.document(docId);
  expect(doc.view("ours").trace).toEqual([
    { id: "sieve-0", label: "Original", view: "original", model: "Claude Code", result: "1 values", start: 0, end: 4000 },
    { id: "sieve-1", label: "Markdown", view: "original", model: "OpenCode", start: 5000 },
  ]);
  expect(doc.view("baseline").trace).toEqual([
    { id: "sieve-0", label: "One-pass extraction", view: "original", model: "OpenCode", result: "0 values", start: 4000, end: 4000 },
  ]);
});
