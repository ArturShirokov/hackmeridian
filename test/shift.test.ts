import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { ours, baseline } from "../src/pipelines.js";
import { parseResult, runShift, type WorkerConfig } from "../scripts/shift.js";
import { makePdf, startBoard } from "./seam.js";

const fake = fileURLToPath(new URL("fake-harness.mjs", import.meta.url));
const sheet = () => makePdf([["Voltaris NMC-800", "Rated capacity: 220 Ah"]]);
const shifts: AbortController[] = [];
afterEach(() => shifts.splice(0).forEach((s) => s.abort()));

/** A Worker whose harness is the fake: `good` hands in a valid result, `garbage` prints prose. Its runs go to `log`. */
function fakeWorker(mode: "good" | "garbage", model: string) {
  const log = join(mkdtempSync(join(tmpdir(), "fake-harness-")), "runs.log");
  const runs = () => {
    try {
      return readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string);
    } catch {
      return [];
    }
  };
  const config: WorkerConfig = { harness: "fake", model, command: [process.execPath, fake, mode, log] };
  return { config, runs };
}

/** Start a shift against a board served in process: the runner's HTTP goes to `serve()`, which a test can swap or drop. */
function shift(workers: WorkerConfig[], serve: () => (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const stop = new AbortController();
  shifts.push(stop);
  const lines: string[] = [];
  const done = runShift({
    url: "http://board.test",
    workers,
    signal: stop.signal,
    fetch: async (url, init) => serve()(String(url), init),
    log: (l) => lines.push(l),
    retryMs: 50,
  });
  return { lines, stop, done };
}

test("a Document uploaded while 4 Workers wait is worked through by them, one extraction per Worker", async () => {
  const board = startBoard({ pipelines: [ours, baseline] });
  const workers = ["a", "b", "c", "d"].map((m) => fakeWorker("good", m));
  const { lines } = shift(workers.map((w) => w.config), () => board.web.request);
  await vi.waitFor(() => expect(board.clock.waiting()).toBe(4), { timeout: 5000 });

  const docId = await board.brand.upload(await sheet(), "battery", { name: "battery-02-kestrel.pdf" });
  // Ours: Original, Markdown, Faithfulness check, Markdown extraction (no tie-break: they agree); the Baseline: one pass.
  const jobs = await vi.waitFor(async () => {
    const js = (await board.brand.jobs()).filter((j) => j.documentId === docId);
    expect(js.map((j) => j.status)).toEqual(Array(5).fill("done"));
    return js;
  }, { timeout: 15000 });
  const extractors = jobs.filter((j) => ["Original", "Markdown extraction", "One-pass extraction", "Tie-break"].includes(j.sieve)).map((j) => j.worker);
  expect(extractors.length).toBeGreaterThanOrEqual(3);
  expect(new Set(extractors).size).toBe(extractors.length);
  await vi.waitFor(() =>
    expect(lines).toContainEqual(expect.stringMatching(/^w\d · fake\/[abcd] · took Markdown extraction for battery-02-kestrel · \d+ s · submitted$/)),
  );
  expect(await board.brand.workers()).toHaveLength(4);
}, 30000);

test("output that is not JSON is retried once with the rejection, then the Worker gives the Job up and waits again", async () => {
  const board = startBoard();
  const w = fakeWorker("garbage", "x");
  const { lines } = shift([w.config], () => board.web.request);
  await vi.waitFor(() => expect(board.clock.waiting()).toBe(1), { timeout: 5000 });

  await board.brand.upload(await sheet(), "battery", { name: "battery-02.pdf" });
  await vi.waitFor(() => expect(lines.at(-1)).toMatch(/^w1 · fake\/x · took One-pass extraction for battery-02 · \d+ s · gave up/), { timeout: 5000 });
  const [first, second] = w.runs();
  expect(w.runs()).toHaveLength(2);
  expect(first).not.toMatch(/rejected/);
  expect(second).toMatch(/rejected: your output was not one JSON object/);
  await vi.waitFor(() => expect(board.clock.waiting()).toBe(1));
  expect((await board.brand.jobs()).map((j) => j.status)).toEqual(["taken"]);
});

test("after the Job Board drops and restarts, the Workers come back under their ids and take Jobs again", async () => {
  const before = startBoard();
  let live: typeof before.web.request | undefined = before.web.request;
  const inflight = new Set<() => void>();
  // Cut every open request and response stream (a long-poll can be one) when the server drops.
  const serve = () => async (url: string, init?: RequestInit) => {
    if (!live) throw new TypeError("fetch failed");
    const cut = new AbortController();
    const drop = () => cut.abort(new TypeError("fetch failed"));
    inflight.add(drop);
    const res = await Promise.race([live(url, init), new Promise<never>((_, reject) => cut.signal.addEventListener("abort", () => reject(cut.signal.reason)))]);
    if (!res.body) return res;
    const pipe = new TransformStream();
    res.body.pipeTo(pipe.writable, { signal: cut.signal }).catch(() => {}).finally(() => inflight.delete(drop));
    return new Response(pipe.readable, res);
  };
  const { lines } = shift([fakeWorker("good", "a").config, fakeWorker("good", "b").config], serve);
  await vi.waitFor(() => expect(before.clock.waiting()).toBe(2), { timeout: 5000 });

  live = undefined;
  inflight.forEach((drop) => drop());
  await vi.waitFor(() => expect(lines.filter((l) => l.includes("unreachable"))).toHaveLength(2));
  const after = startBoard();
  live = after.web.request;
  await vi.waitFor(() => expect(after.clock.waiting()).toBe(2), { timeout: 5000 });
  expect((await after.brand.workers()).map((w) => w.name).sort()).toEqual(["w1", "w2"]);
  expect(lines).toContainEqual(expect.stringMatching(/^w1 · fake\/. · back on shift$/));

  await after.brand.upload(await sheet(), "battery", { name: "battery-02.pdf" });
  await vi.waitFor(async () => expect((await after.brand.jobs()).map((j) => j.status)).toEqual(["done"]), { timeout: 5000 });
});

test("the result is found in Claude Code's JSON wrapper, a fenced block, or prose; anything else is no result", () => {
  expect(parseResult(JSON.stringify({ type: "result", result: '{"pass":true}' }))).toEqual({ pass: true });
  expect(parseResult('Done.\n```json\n{"pass": true}\n```')).toEqual({ pass: true });
  expect(parseResult('The result is {"pass": true}.')).toEqual({ pass: true });
  expect(parseResult('Read {job.json}\n{"fields": [{"field": "a", "notStated": true}]}\n')).toEqual({ fields: [{ field: "a", notStated: true }] });
  expect(parseResult(JSON.stringify({ type: "result", is_error: true, result: "Credit balance is too low" }))).toBeUndefined();
  expect(parseResult("[1, 2]")).toBeUndefined();
});

test("Ctrl-C ends the shift", async () => {
  const board = startBoard();
  const { stop, done } = shift([fakeWorker("good", "a").config], () => board.web.request);
  await vi.waitFor(() => expect(board.clock.waiting()).toBe(1), { timeout: 5000 });
  stop.abort();
  await done;
});
