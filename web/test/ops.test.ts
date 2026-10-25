import { expect, test } from "vitest";
import { ago, bondChart, evidenceBoxes, jobView, ranked, sieveRead } from "../src/screens/ops/logic.ts";

const row = (operator: string, series: [string, string][]) => ({ operator, series: series.map(([documentId, balance]) => ({ documentId, short: documentId.toUpperCase(), balance })) });

test("the Bond balance steps down by each Document's Slash and stays flat without one", () => {
  const c = bondChart([row("Origyn", [["a", "10"], ["b", "10"], ["c", "10"]]), row("Baseline", [["a", "10"], ["b", "5"], ["c", "5"]])], { Origyn: "10", Baseline: "10" });
  expect(c.docs).toEqual(["A", "B", "C"]);
  expect(c.lines[0]!.balances).toEqual([10, 10, 10]);
  expect(c.lines[1]!.balances).toEqual([10, 5, 0]);
  expect(c.lines[1]!.steps).toEqual([{ at: 1, drop: 5 }, { at: 2, drop: 5 }]);
});

test("the Arbiter sees both quotes boxed, or one box when the Brand quoted the delivered line", () => {
  const r = [{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }];
  const c = { operatorLabel: "Baseline", fieldLabel: "Rated capacity", delivered: { display: "80 Ah", evidence: { page: 4, quote: "80 Ah nominal", rects: r } }, claim: { display: "78 Ah", evidence: { page: 4, quote: "78 Ah rated", rects: r } } };
  expect(evidenceBoxes(c).map((b) => [b.kind, b.tag, b.page])).toEqual([["delivered", "Delivered · Baseline", 4], ["challenger", "Challenger", 4]]);
  const same = { ...c, claim: { ...c.claim, evidence: { ...c.claim.evidence, quote: " 80 AH nominal" } } };
  expect(evidenceBoxes(same).map((b) => [b.kind, b.tag])).toEqual([["challenger", "Delivered + challenger quote"]]);
  expect(evidenceBoxes({ ...c, delivered: { display: "Not stated" } }).map((b) => b.kind)).toEqual(["challenger"]);
});

test("the Arbiter's boxes stay neutral until the decision; then the losing side's turns red", () => {
  const r = [{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }];
  const c = { operatorLabel: "Baseline", fieldLabel: "Rated capacity", delivered: { display: "80 Ah", evidence: { page: 4, quote: "80 Ah nominal", rects: r } }, claim: { display: "78 Ah", evidence: { page: 4, quote: "78 Ah rated", rects: r } } };
  expect(evidenceBoxes(c, "filed").map((b) => b.kind)).toEqual(["delivered", "challenger"]);
  expect(evidenceBoxes(c, "upheld").map((b) => b.kind)).toEqual(["wrong", "right"]);
  expect(evidenceBoxes(c, "rejected").map((b) => b.kind)).toEqual(["right", "wrong"]);
});

test("filed time reads like the prototype", () => {
  expect(ago(30_000)).toBe("just now");
  expect(ago(2 * 60_000 + 5_000)).toBe("2 min ago");
  expect(ago(3 * 3_600_000)).toBe("3 h ago");
});

test("a Job row shows its status, and how long the Worker took or has been on it", () => {
  const j = { id: "j", documentId: "d", documentName: "D", pipeline: "ours", sieve: "Original", postedAt: 0 };
  expect(jobView({ ...j, status: "done", worker: "Pi", takenAt: 1_000, doneAt: 42_000 }, 99_000)).toMatchObject({ label: "done", tone: "done", duration: "00:41" });
  expect(jobView({ ...j, status: "taken", worker: "Pi", takenAt: 1_000 }, 23_000)).toMatchObject({ label: "taken", tone: "taken", duration: "00:22" });
  expect(jobView({ ...j, status: "open" }, 5_000)).toMatchObject({ label: "open", tone: "open", duration: "—" });
  expect(jobView({ ...j, status: "timed out", worker: "Pi", takenAt: 1_000 }, 5_000)).toMatchObject({ label: "timed out · back on board", tone: "timeout" });
});

test("Leaderboard rank: higher test-set accuracy first, then fewer upheld Challenges per Document", () => {
  const r = (operator: string, documents: number, challengesUpheld: number, accuracy?: [number, number]) =>
    ({ operator, documents, challengesUpheld, ...(accuracy && { accuracy: { correct: accuracy[0], fields: accuracy[1] } }) });
  expect(ranked([r("a", 4, 0, [80, 100]), r("b", 4, 2, [95, 100]), r("c", 4, 0)]).map((x) => x.operator)).toEqual(["b", "a", "c"]);
  expect(ranked([r("slashy", 2, 2), r("clean", 4, 1), r("new", 0, 0)]).map((x) => x.operator)).toEqual(["clean", "slashy", "new"]);
});

test("a Sieve says what it reads: the second extraction reads the Markdown", () => {
  const all = [{ kind: "extract", label: "Original", view: "original" }, { kind: "extract", label: "Markdown extraction", view: "markdown" }] as const;
  expect(sieveRead(all[1], [...all])).toEqual({ view: "Markdown", note: "second independent read" });
  expect(sieveRead(all[0], [all[0]])).toEqual({ view: "original PDF", note: "every Field in one pass" });
});
