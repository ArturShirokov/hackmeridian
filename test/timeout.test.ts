import { expect, test } from "vitest";
import { extraction, makePdf, startBoard } from "./seam.js";

test("a taken Job not handed in within the timeout goes back on the board, and the late submission is rejected", async () => {
  const { worker, brand, clock } = startBoard({ jobTimeoutMs: 60_000 });
  await brand.upload(await makePdf([["Voltaris NMC-800"]]));
  const w1 = await worker("w1");
  const w2 = await worker("w2");
  const job = (await w1.nextJob())!;

  clock.advance(59_999);
  expect(await w2.nextJob()).toBeNull();

  clock.advance(1);
  expect((await w2.nextJob())?.id).toBe(job.id);

  const late = await w1.submitJob(job.id, extraction(job));
  expect(late.ok).toBe(false);
  expect(late.text).toMatch(/not taken by Worker "w1"/);
  expect(await w2.submitJob(job.id, extraction(job))).toMatchObject({ ok: true });
});
