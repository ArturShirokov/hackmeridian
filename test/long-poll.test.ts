import { expect, test, vi } from "vitest";
import { makePdf, startBoard } from "./seam.js";

const sheet = () => makePdf([["Voltaris NMC-800"]]);

test("a waiting Worker gets the Job the moment a Document is uploaded", async () => {
  const { worker, brand, clock } = startBoard();
  const w1 = await worker("w1");
  const waiting = w1.nextJob({ wait: 25 });
  await vi.waitFor(() => expect(clock.waiting()).toBe(1));

  const docId = await brand.upload(await sheet());
  expect((await waiting)?.documentId).toBe(docId);
  expect(clock.waiting()).toBe(0);
});

test("with no work the wait ends after 25 s at most with no Job", async () => {
  const { worker, clock } = startBoard();
  const w1 = await worker("w1");
  let answered = false;
  const waiting = w1.nextJob({ wait: 600 }).then((j) => ((answered = true), j));
  await vi.waitFor(() => expect(clock.waiting()).toBe(1));

  clock.advance(24_999);
  await new Promise((r) => setTimeout(r, 20));
  expect(answered).toBe(false);
  clock.advance(1);
  expect(await waiting).toBeNull();
});

test("concurrent waiters each get a different Job, and the rest keep waiting", async () => {
  const { worker, brand, clock } = startBoard();
  const ws = await Promise.all(["w1", "w2", "w3", "w4"].map((n) => worker(n)));
  const answers = ws.map((w) => w.nextJob({ wait: 25 }));
  await vi.waitFor(() => expect(clock.waiting()).toBe(4));

  await brand.upload(await sheet());
  await brand.upload(await makePdf([["Kestrel 18650"]]));
  await vi.waitFor(() => expect(clock.waiting()).toBe(2));
  clock.advance(25_000);

  const jobs = await Promise.all(answers);
  const got = jobs.filter((j) => j !== null);
  expect(got).toHaveLength(2);
  expect(new Set(got.map((j) => j!.id)).size).toBe(2);
});

test("a Job that times out wakes a waiting Worker", async () => {
  const { worker, brand, clock } = startBoard({ jobTimeoutMs: 10_000 });
  await brand.upload(await sheet());
  const w1 = await worker("w1");
  const w2 = await worker("w2");
  const job = (await w1.nextJob())!;

  const waiting = w2.nextJob({ wait: 25 });
  await vi.waitFor(() => expect(clock.waiting()).toBe(1));
  clock.advance(10_000);
  expect((await waiting)?.id).toBe(job.id);
});

test("an abandoned waiter never takes a Job", async () => {
  const { worker, brand, clock } = startBoard();
  const w1 = await worker("w1");
  const w2 = await worker("w2");
  const abort = new AbortController();
  const gone = w1.nextJob({ wait: 25, signal: abort.signal }).catch(() => "aborted");
  await vi.waitFor(() => expect(clock.waiting()).toBe(1));
  abort.abort();
  await gone;
  await vi.waitFor(() => expect(clock.waiting()).toBe(0));

  await brand.upload(await sheet());
  expect(await w2.nextJob()).not.toBeNull();
});

test("an outside Operator waiting on open Documents sees an upload at once, or an empty list after the wait", async () => {
  const { outsideOperator, brand, clock } = startBoard();
  const op = await outsideOperator();
  const empty = op.openDocuments({ wait: 25 });
  await vi.waitFor(() => expect(clock.waiting()).toBe(1));
  clock.advance(25_000);
  expect(await empty).toEqual([]);

  const waiting = op.openDocuments({ wait: 25 });
  await vi.waitFor(() => expect(clock.waiting()).toBe(1));
  const docId = await brand.upload(await sheet());
  expect((await waiting).map((d) => d.id)).toEqual([docId]);
});
