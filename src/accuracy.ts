// Accuracy report: compare delivered Field values with the hand-checked ones in testdata/expected,
// and record a live run's Worker calls so the run can be replayed through a fresh Job Board.
import { JobBoard, type FieldValue } from "./board.js";
import { canonical, formatValue, type FieldResult } from "./converge.js";
import { FakeLedger } from "./ledger.js";
import { baseline, ours } from "./pipelines.js";
import { InMemoryStorage } from "./storage.js";
import { templates } from "./templates.js";

const pipelines = [ours, baseline];

/** A Job Board with fake adapters running our Pipeline and the Baseline, each under its own Operator. */
export function accuracyBoard(now: () => number = Date.now, baseUrl = "http://127.0.0.1:3000", challengeWindowMs?: number) {
  return new JobBoard({ storage: new InMemoryStorage(), ledger: new FakeLedger(), baseUrl, pipelines: [...pipelines], now, challengeWindowMs });
}

/** Every Job a Worker took and every accepted submission, in order, with the board's clock. Enough to replay. */
export type Event = { t: number; worker: string; take: string } | { t: number; worker: string; submit: string; result: unknown };
export interface Run {
  documents: { id: string; file: string; template: string }[];
  events: Event[];
}

/** Record into `run` every Job taken and every accepted submission. Empty polls and rejections change nothing. */
export function record(board: JobBoard, run: Run, now: () => number = Date.now, onEvent: () => void = () => {}) {
  const next = board.nextJob.bind(board);
  const submit = board.submitJob.bind(board);
  board.nextJob = (worker) => {
    const job = next(worker);
    if (job) run.events.push({ t: now(), worker, take: job.id }), onEvent();
    return job;
  };
  board.submitJob = async (worker, jobId, result) => {
    const t = now();
    const r = await submit(worker, jobId, result);
    if (r.ok) run.events.push({ t, worker, submit: jobId, result }), onEvent();
    return r;
  };
}

/**
 * Replay a recorded run through a fresh Job Board: same uploads, same takes and submissions, same clock.
 * With `live` (the demo), the recorded clock is shifted so the run ends now, then the board runs on `live.now`.
 * Every Challenge Window gets the run's length added, so each has at least `challengeWindowMs` left at the start.
 */
export async function replay(
  run: Run,
  readPdf: (file: string) => Promise<Uint8Array>,
  live?: { now: () => number; challengeWindowMs: number; baseUrl?: string },
) {
  let t = 0;
  let replaying = true;
  const first = run.events[0]?.t ?? 0;
  const last = run.events.at(-1)?.t ?? 0;
  const shift = live ? live.now() - last : 0;
  // ponytail: windows close up to the run's length apart; compress the recorded clock if a long live run makes that awkward.
  const board = live
    ? accuracyBoard(() => (replaying ? t + shift : live.now()), live.baseUrl, live.challengeWindowMs + last - first)
    : accuracyBoard(() => t);
  const documents = [];
  for (const d of run.documents) documents.push({ ...d, id: (await board.upload(await readPdf(d.file), d.template)).id });
  const ids = new Map<string, string>();
  for (const [i, e] of run.events.entries()) {
    t = e.t;
    if ("take" in e) {
      const job = board.nextJob(e.worker);
      if (!job) throw new Error(`replay diverged at event ${i}: no Job for Worker ${e.worker}`);
      ids.set(e.take, job.id);
    } else {
      const r = await board.submitJob(e.worker, ids.get(e.submit) ?? e.submit, e.result);
      if (!r.ok) throw new Error(`replay diverged at event ${i}: ${r.error}`);
    }
  }
  replaying = false;
  return { board, documents };
}

/** Delivered Field values per Pipeline and Document file name, for score(). */
export function deliveredBy(board: JobBoard, documents: Run["documents"]) {
  return Object.fromEntries(
    pipelines.map((p) => [p.name, Object.fromEntries(documents.map((d) => [d.file, board.delivered(d.id, p.name)]))]),
  );
}

/** Every Document delivered by both Pipelines. */
export const drained = (board: JobBoard, documents: Run["documents"]) =>
  documents.every((d) => pipelines.every((p) => board.delivered(d.id, p.name)));

type Stated = Extract<FieldValue, { value: unknown }>;
/** One testdata/expected/*.json file. */
export interface Expected {
  document: string;
  template: string;
  fields: Record<string, "Not stated" | (Omit<Stated, "field" | "qualifier"> & { qualifier?: string | null })>;
}

export interface Report {
  pipeline: string;
  /** The Operator that runs the Pipeline. */
  operator: string;
  fields: number;
  correct: number;
  /** Fields the Pipeline delivered as Not stated. */
  notStated: number;
  incorrect: { document: string; field: string; expected: string; delivered: string }[];
}

/** `delivered`: per Pipeline name, its Field values by Document file name, undefined when not delivered. */
export function score(
  expected: Expected[],
  delivered: Record<string, Record<string, FieldResult[] | undefined>>,
  operatorOf: (pipeline: string) => string = (p) => p,
): Report[] {
  return Object.entries(delivered).map(([pipeline, byDoc]) => {
    const r: Report = { pipeline, operator: operatorOf(pipeline), fields: 0, correct: 0, notStated: 0, incorrect: [] };
    for (const e of expected) {
      const template = templates[e.template]!;
      for (const [name, want] of Object.entries(e.fields)) {
        const f = template.fields.find((f) => f.name === name)!;
        const got = byDoc[e.document]?.find((v) => v.field === name);
        const gotStated = got?.status === "final" ? got : undefined;
        r.fields++;
        if (got?.status === "not stated") r.notStated++;
        const correct =
          want === "Not stated"
            ? got !== undefined && !gotStated && got.status !== "disagreeing"
            : gotStated !== undefined &&
              JSON.stringify(canonical(f, { field: name, ...want } as Stated)) === JSON.stringify(canonical(f, gotStated)) &&
              (want.qualifier ?? null) === (gotStated.qualifier ?? null);
        if (correct) r.correct++;
        else r.incorrect.push({
          document: e.document,
          field: name,
          expected: want === "Not stated" ? want : formatValue(want),
          delivered: got === undefined || got.status === "disagreeing" ? "not delivered" : gotStated ? formatValue(gotStated) : "Not stated",
        });
      }
    }
    return r;
  });
}
