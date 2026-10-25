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

test("upload stores the file name and Supplier; the list is newest first with statuses per Pipeline; a non-PDF or unknown Template is a 400", async () => {
  const { brand } = startBoard({ pipelines: [ours, baseline], operators });
  const a = await brand.upload(await sheet(), "battery", { name: "a.pdf", supplier: "Voltaris" });
  const b = await brand.upload(await sheet(), "textile", { name: "b.pdf", supplier: "Lumen" });
  expect(await brand.documents()).toMatchObject([
    { id: b, name: "b.pdf", supplier: "Lumen", template: "textile", pages: 2 },
    { id: a, name: "a.pdf", supplier: "Voltaris", template: "battery", pages: 2,
      pipelines: { ours: { status: "processing", counts: { final: 0, converging: 60, notStated: 0 } }, baseline: { status: "processing" } } },
  ]);
  expect(await brand.uploadRaw(new TextEncoder().encode("PK not a pdf"), "battery", { name: "x.docx" })).toMatchObject({ status: 400 });
  expect(await brand.uploadRaw(await sheet(), "shoes")).toMatchObject({ status: 400, body: { error: expect.stringMatching(/Template/) } });
  expect(await brand.documents()).toHaveLength(2);
});

test("config and Templates: terms per Pipeline with Sieve labels, the window length, Template Fields with examples", async () => {
  const { brand } = startBoard({ pipelines: [ours, baseline], operators, challengeWindowMs: 60_000 });
  expect(await brand.config()).toEqual({
    now: 0,
    baseUrl: "http://board.test",
    challengeWindowMs: 60_000,
    challengeDeposit: "1",
    arbiterFee: "0.1",
    brand: { name: "Voltaris", reviewer: "Inês Duarte" },
    operators: [
      { pipeline: "ours", label: "Origyn", operator: "origyn", bond: "20", fee: "2",
        sieves: ["Original", "Markdown", "Faithfulness check", "Markdown extraction", "Tie-break"].map((label, i) => ({ kind: ours.sieves[i]!.kind, label })) },
      { pipeline: "baseline", label: "Baseline", operator: "one-pass", bond: "10", fee: "1", sieves: [{ kind: "extract", label: "One-pass extraction" }] },
    ],
  });
  const [battery, textile] = await brand.templates();
  expect(battery).toMatchObject({ name: "battery", label: "Battery" });
  expect(battery!.fields).toHaveLength(60);
  expect(textile!.fields).toHaveLength(37);
  expect(battery!.fields.find((f) => f.name === "rated_capacity_ah")).toMatchObject({ type: "quantity", unit: "Ah", qualifiers: ["rated", "nominal", "minimum", "typical"] });
  expect(battery!.examples).toHaveLength(3);
});

test("a final Field's quote is boxed where it sits on the page; a partial quote gets a narrower box", async () => {
  const board = startBoard();
  const docId = await board.brand.upload(await sheet());
  const w = await board.worker("w1");
  const job = (await w.nextJob())!;
  await w.submitJob(job.id, extraction(job, {
    rated_capacity_ah: capacity,
    battery_chemistry: { value: "NMC811", page: 2, quote: "NMC811" },
  }));
  const doc = await board.brand.document(docId);
  const [box] = doc.fields.find((f) => f.name === "rated_capacity_ah")!.evidence!.rects;
  // makePdf draws line 2 at x 50, baseline y 732, 11 pt, on an A4 page (595.28 x 841.89 pt).
  expect(box!.x).toBeCloseTo(50 / 595.28, 3);
  expect(box!.y).toBeCloseTo((841.89 - 732 - 11) / 841.89, 2);
  expect(box!.h).toBeCloseTo(11 / 841.89, 2);
  expect(box!.w).toBeGreaterThan(0.15);
  const chem = doc.fields.find((f) => f.name === "battery_chemistry")!.evidence!;
  expect(chem).toMatchObject({ page: 2, mark: "NMC811" });
  expect(chem.rects).toHaveLength(1);
  expect(chem.rects[0]!.x).toBeGreaterThan(100 / 595.28); // starts after "Chemistry: "
  expect(chem.rects[0]!.w).toBeLessThan(box!.w);
});

test("stations show each Sieve's state, Worker and counts; Jobs and Workers list metadata only, with a timed-out take as its own row", async () => {
  const board = startBoard({ pipelines: [ours], jobTimeoutMs: 10_000 });
  const docId = await board.brand.upload(await sheet(), "battery", { name: "pack.pdf" });
  const [w1, w2] = [await board.worker("w1"), await board.worker("w2")];
  const j1 = (await w1.nextJob())!;
  board.clock.advance(10_000); // w1 holds it past the timeout; w2 takes it over
  expect((await w2.nextJob())!.id).toBe(j1.id);
  board.clock.advance(1000);
  await w2.submitJob(j1.id, extraction(j1, { rated_capacity_ah: capacity }));
  const md = (await w1.nextJob())!;
  await w1.submitJob(md.id, { markdown: "<!-- page 1 -->\n| a | b |\n|---|---|\n| 1 | 2 |\n<!-- page 2 -->" });
  const check = (await w1.nextJob())!;

  const stations = (await board.brand.document(docId)).view("ours").stations;
  expect(stations.map((s) => [s.label, s.state, s.worker, s.meta])).toEqual([
    ["Original", "done", "w2", "1 values"],
    ["Markdown", "done", "w1", "2 pages read · 1 tables"],
    ["Faithfulness check", "run", "w1", ""],
    ["Markdown extraction", "wait", undefined, ""],
    ["Tie-break", "wait", undefined, ""],
  ]);
  expect(stations[0]).toMatchObject({ postedAt: 0, takenAt: 10_000, doneAt: 11_000, attempt: 1 });

  const jobs = await board.brand.jobs();
  expect(jobs.map((j) => [j.sieve, j.status, j.worker])).toEqual([
    ["Faithfulness check", "taken", "w1"],
    ["Markdown", "done", "w1"],
    ["Original", "done", "w2"],
    ["Original", "timed out", "w1"],
  ]);
  expect(jobs[0]).toMatchObject({ id: check.id, documentId: docId, documentName: "pack.pdf", pipeline: "ours" });
  expect(JSON.stringify(jobs)).not.toMatch(/instructions|Rated capacity|markdown/);

  expect(await board.brand.workers()).toEqual([
    { name: "w1", lastSeen: 11_000, live: true, current: { jobId: check.id, sieve: "Faithfulness check", documentName: "pack.pdf" }, doneToday: 1 },
    { name: "w2", lastSeen: 11_000, live: true, doneToday: 1 },
  ]);
  board.clock.advance(60_000);
  expect((await board.brand.workers()).map((w) => w.live)).toEqual([false, false]);

  await w1.submitJob(check.id, { pass: false, problems: ["drops a row", "wrong unit"] });
  expect((await board.brand.document(docId)).view("ours").stations.map((s) => [s.state, s.attempt, s.meta]).slice(1, 3)).toEqual([
    ["wait", 2, "re-run 1 of 1"],
    ["fail", 1, "failed · 2 problems"],
  ]);
});

test("export: the delivered values in the expected-file shape, corrections applied, as an attachment; 409 before delivery", async () => {
  const board = startBoard({ challengeWindowMs: 60_000 });
  const docId = await board.brand.upload(await sheet(), "battery", { name: "voltaris-pack.pdf" });
  expect((await board.brand.export(docId)).status).toBe(409);
  const w = await board.worker("w1");
  const job = (await w.nextJob())!;
  await w.submitJob(job.id, extraction(job, { rated_capacity_ah: { ...capacity, value: 22 } }));
  await board.brand.challenge(docId, { field: "rated_capacity_ah", page: 1, quote: "Rated capacity: 220 Ah", value: 220, unit: "Ah", qualifier: "rated" });
  await board.arbiter.decide((await board.arbiter.challenges())[0]!.id, "upheld");

  const r = await board.brand.export(docId);
  expect(r.status).toBe(200);
  expect(r.disposition).toBe('attachment; filename="voltaris-pack.passport.json"');
  expect(r.body).toMatchObject({ template: "battery", documentId: docId, pipeline: "baseline", operator: "baseline", outputHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  const fields = r.body.fields as Record<string, unknown>;
  expect(fields.rated_capacity_ah).toEqual({ value: 220, unit: "Ah", qualifier: "rated", page: 1, quote: "Rated capacity: 220 Ah" });
  expect(fields.battery_chemistry).toBe("Not stated");
  expect(Object.keys(fields)).toHaveLength(60);
  expect((await board.brand.export("nope")).status).toBe(404);
});

test("an escrow whose window shut with a Challenge undecided is awaiting the Arbiter; the leaderboard carries accuracy and the Operator link", async () => {
  const board = startBoard({ challengeWindowMs: 60_000, explorer: "https://explorer.test", web: { accuracy: { baseline: { correct: 20, fields: 25 } } } });
  const docId = await board.brand.upload(await sheet());
  const w = await board.worker("w1");
  const job = (await w.nextJob())!;
  await w.submitJob(job.id, extraction(job, { rated_capacity_ah: capacity }));
  await board.brand.challenge(docId, { field: "rated_capacity_ah", page: 1, quote: "Rated capacity: 220 Ah", value: 220, unit: "Ah" });
  board.clock.advance(60_000);
  await board.tick();
  const doc = await board.brand.document(docId);
  expect(doc.escrow).toMatchObject({ status: "awaiting arbiter", openedAt: 0, closesAt: 60_000, upheld: 0, bondLeft: "10" });
  expect(doc.pipelines.baseline).toMatchObject({ status: "awaiting arbiter", closesAt: 60_000 });
  expect(await board.brand.leaderboard()).toMatchObject([
    { operator: "baseline", accuracy: { correct: 20, fields: 25 }, link: "https://explorer.test/account/baseline", bondsLocked: "10" },
  ]);
});

test("a Worker on our second extraction cannot read the Baseline's delivered values from the Brand's API", async () => {
  const b = await twoPipelines();
  const j2 = (await b.w3.nextJob())!;
  expect(j2.sieve).toBe("extract");

  const doc = await b.brand.document(b.docId);
  const text = JSON.stringify(doc);
  expect(text).not.toMatch(/\b220\b/); // not inside a random UUID
  expect(text).not.toContain("Rated capacity: 220 Ah");
  // Statuses still flow: the Baseline delivered, its capacity is final but withheld.
  expect(doc.view("baseline").fields.find((f) => f.name === "rated_capacity_ah")).toEqual(
    expect.objectContaining({ status: "final", withheld: true }),
  );
  expect(doc.pipelines.baseline).toMatchObject({ status: "delivered", counts: { final: 1 } });
  expect(doc.differs).toEqual([]);
  expect((await b.brand.export(b.docId, "baseline")).status).toBe(409);
  expect(JSON.stringify(await b.brand.jobs())).not.toMatch(/\b220\b/);

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

test("Source Markdown: our Pipeline's checked Markdown, only once every Pipeline has delivered; none for the Baseline", async () => {
  const b = await twoPipelines();
  const j2 = (await b.w3.nextJob())!;
  const before = await b.brand.document(b.docId);
  expect(JSON.stringify(before)).not.toContain("# Document");
  expect(before.view("ours").markdown).toBeUndefined();

  await b.w3.submitJob(j2.id, extraction(j2, { rated_capacity_ah: capacity }));
  const after = await b.brand.document(b.docId);
  expect(after.view("ours").markdown).toBe("# Document");
  expect(after.view("baseline").markdown).toBeUndefined();
});
