// The demo's starting board (npm run demo): the replayed run, plus a history for the Brand's Documents list,
// so it shows every status: two Documents settled (one after a Slash on the Baseline), the rest delivered,
// and two fresh uploads still processing.
import { replay, type Run } from "./accuracy.js";

/** Re-uploads still waiting for Workers: [file name, Supplier], their PDF the first replayed one of the Template. */
const PROCESSING: Record<string, [string, string]> = {
  textile: ["linho-norte-linen-overshirt-spec.pdf", "Linho Norte"],
  battery: ["kestrel-21700-cell-datasheet-rev-b.pdf", "Kestrel"],
};

export async function demoBoard(
  run: Run,
  readPdf: (file: string) => Promise<Uint8Array>,
  live: { now: () => number; challengeWindowMs: number; demoWindow?: boolean; baseUrl?: string },
) {
  let skew = 0;
  const { board, documents } = await replay(run, readPdf, { ...live, now: () => live.now() + skew });

  // The first Document where the Pipelines disagree: the Brand Challenges the Baseline with our quoted value, and it is upheld.
  const settle = new Set<string>();
  for (const { id } of documents) {
    const d = board.apiDocument(id)!;
    const [ours, other] = d.views;
    const f = ours!.fields.find((f) => f.name === d.differs[0]);
    if (!other || !f || !("evidence" in f)) continue;
    const { value, unit, qualifier, evidence } = f;
    const r = await board.challenge(id, { field: f.name, page: evidence.page, quote: evidence.quote, value, unit, qualifier }, other.pipeline);
    if (!r.ok) continue;
    board.challenges.decide(r.challenge.id, "upheld");
    settle.add(id);
    break;
  }
  const clean = documents.find((d) => !settle.has(d.id));
  if (clean) settle.add(clean.id);
  // Settle those two as if their Challenge Window had passed; the rest stay open on the wall clock.
  for (const id of settle) board.open(id); // with the demo window, a window runs only once the Document is opened
  skew = 30 * 86_400_000;
  await board.tick((id) => settle.has(id));
  skew = 0;

  // ponytail: these put Jobs on the board, and live Workers take the oldest Job first; drop PROCESSING if that slows a live run.
  for (const [template, [name, supplier]] of Object.entries(PROCESSING)) {
    const src = documents.find((d) => d.template === template);
    if (src) await board.upload(await readPdf(src.file), template, { name, supplier });
  }
  return { board, documents };
}
