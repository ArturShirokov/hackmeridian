import { expect, test } from "vitest";
import { ours } from "../src/pipelines.js";
import { checkedMarkdown, extraction, makePdf, startBoard } from "./seam.js";

test("Workers registering at the same time get different ids", async () => {
  const { register } = startBoard();
  const ids = (await Promise.all([register(), register(), register()])).map((w) => w.id);
  expect(new Set(ids).size).toBe(3);
  for (const id of ids) expect(id).toMatch(/^w\d+$/);
});

test("a registered Worker shows on /api/workers with its harness and label", async () => {
  const { register, brand } = startBoard();
  const w = await register({ harness: "OpenCode", label: "laptop" });
  expect(await brand.workers()).toEqual([expect.objectContaining({ name: w.id, harness: "OpenCode", label: "laptop", live: true })]);
});

test("a fresh id never collides with one a Worker picked by hand", async () => {
  const { worker, register } = startBoard();
  await (await worker("w1")).nextJob();
  expect((await register()).id).not.toBe("w1");
});

test("a Worker reconnecting with its id keeps it, and its harness", async () => {
  const { register, brand } = startBoard();
  const first = await register({ harness: "Pi" });
  const again = await register({ worker: first.id });
  expect(again.id).toBe(first.id);
  expect(await brand.workers()).toEqual([expect.objectContaining({ name: first.id, harness: "Pi" })]);
});

test("independence holds for registered ids: a Worker does one extraction Sieve per Document", async () => {
  const { register, brand } = startBoard({ pipelines: [ours] });
  const docId = await brand.upload(await makePdf([["Voltaris NMC-800"]]));
  const a = await register({ harness: "Claude Code" });
  const j1 = (await a.nextJob())!;
  await a.submitJob(j1.id, extraction(j1));
  await checkedMarkdown(a);
  expect(await a.nextJob()).toBeNull();
  const b = await register({ harness: "OpenCode" });
  expect(await b.nextJob()).toMatchObject({ documentId: docId, sieve: "extract" });
  expect((await brand.document(docId)).view("ours").trace![0]).toMatchObject({ model: `${a.id} · Claude Code` });
});

test("an unregistered id still works, for Workers connected before register_worker", async () => {
  const { worker, brand } = startBoard();
  await brand.upload(await makePdf([["Voltaris NMC-800"]]));
  const old = await worker("w9");
  expect(await old.nextJob()).not.toBeNull();
  expect(await brand.workers()).toEqual([expect.objectContaining({ name: "w9", live: true })]);
});
