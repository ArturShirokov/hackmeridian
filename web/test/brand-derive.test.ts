import { expect, test } from "vitest";
import { respond } from "../src/fixtures.ts";
import type { ApiDocument, ApiField, ApiStation } from "../src/api.ts";
import { boxes, compare, pipelineState, pipelineRows, reviewGroups, shown } from "../src/screens/brand/derive.ts";

const doc = (id: string) => structuredClone(respond(`/api/documents/${id}`)) as ApiDocument;
const st = (index: number, state: ApiStation["state"], extra: Partial<ApiStation> = {}): ApiStation =>
  ({ index, kind: "extract", label: `S${index}`, state, attempt: 1, meta: "", ...extra });

test("a Document every Pipeline has delivered reads Delivered", () => {
  expect(pipelineState(doc("doc-1"))).toMatchObject({ delivered: true, word: "Delivered" });
});

test("a Sieve being worked reads Processing; no Worker on any open Sieve reads Waiting for a Worker", () => {
  const d = doc("doc-2");
  expect(pipelineState(d)).toMatchObject({ delivered: false, word: "Processing" });
  expect(pipelineState(d).banner).toBeUndefined();
  d.views[0]!.stations = [st(0, "done"), st(1, "wait")];
  d.views[1]!.stations = [st(0, "done")];
  expect(pipelineState(d)).toMatchObject({ word: "Waiting for a Worker", banner: { kind: "waiting", text: "Job on the Job Board, waiting for a Worker." } });
});

test("a failed faithfulness check shows the re-run banner", () => {
  const d = doc("doc-2");
  d.views[0]!.stations = [st(0, "done"), st(1, "run", { kind: "markdown", attempt: 2, meta: "re-run 1 of 1" }), st(2, "fail", { kind: "faithfulness" })];
  expect(pipelineState(d).banner).toEqual({ kind: "rerun", text: "The faithfulness check failed, so the Markdown is being redone once." });
});

test("Pipeline rows: Fields are Queued until a first extraction is in, and the counter strip counts the badges", () => {
  const d = doc("doc-2");
  const ours = d.views[0]!;
  const rows = pipelineRows(ours);
  expect(rows.counts).toEqual({ final: 3, converging: ours.fields.length - 3, notStated: 0 });
  expect(rows.rows.map((r) => r.badge).slice(2, 4)).toEqual(["final", "converging"]);
  ours.stations = ours.stations.map((s) => ({ ...s, state: "wait" }));
  const queued = pipelineRows(ours);
  expect(queued.rows[5]!.badge).toBe("queued");
  expect(queued.counts.converging).toBe(0);
});

test("a Not stated Field counts as Not stated", () => {
  const ns = doc("doc-1").views[0]!.fields.filter((f: ApiField) => f.status === "not stated").length;
  expect(pipelineRows(doc("doc-1").views[0]!).counts.notStated).toBe(ns);
  expect(ns).toBe(1);
});

import { parseClaim } from "../src/screens/brand/derive.ts";

test("a typed Challenge value splits into number and unit, falling back to the Template's unit", () => {
  const cap = { type: "quantity", unit: "Ah", label: "Rated capacity" } as const;
  expect(parseClaim("80.0 Ah", cap)).toEqual({ value: 80, unit: "Ah" });
  expect(parseClaim("3 000 cycles", { type: "quantity", unit: "cycles", label: "Cycle life" })).toEqual({ value: 3000, unit: "cycles" });
  expect(parseClaim(" 0,135 ", { type: "quantity", unit: "ohm", label: "R" })).toEqual({ value: 0.135, unit: "ohm" });
  expect(parseClaim("about eighty", cap)).toEqual({ error: "Enter a number for Rated capacity, e.g. 80 Ah." });
  expect(parseClaim("  ", cap)).toEqual({ error: "Enter the value the Document states." });
});

test("a value typed in the unit as printed converts to the Template's unit, and says so", () => {
  const r = { type: "quantity", unit: "ohm", label: "R" } as const;
  expect(parseClaim("35 mOhm", r)).toEqual({ value: 0.035, unit: "ohm", converted: "35 mOhm = 0.035 ohm" });
  expect(parseClaim("35 mΩ", r)).toEqual({ value: 0.035, unit: "ohm", converted: "35 mΩ = 0.035 ohm" });
  expect(parseClaim("2.5 kWh", { type: "quantity", unit: "Wh", label: "E" })).toEqual({ value: 2500, unit: "Wh", converted: "2.5 kWh = 2500 Wh" });
  expect(parseClaim("35 Ω", r)).toEqual({ value: 35, unit: "ohm" });
  // A unit it does not know goes to the server as typed.
  expect(parseClaim("3 C", { type: "quantity", unit: "A/Ah", label: "Rate" })).toEqual({ value: 3, unit: "C" });
});

test("a typed composition reads either way round", () => {
  const comp = { type: "composition", unit: "%", label: "Fibre composition" } as const;
  expect(parseClaim("55 % linen · 45 % organic cotton", comp)).toEqual({ value: { linen: 55, "organic cotton": 45 }, unit: "%" });
  expect(parseClaim("cotton 95%, elastane 5%", comp)).toEqual({ value: { cotton: 95, elastane: 5 }, unit: "%" });
  expect(parseClaim("all cotton", comp)).toEqual({ error: "Enter the shares, e.g. 95 % cotton · 5 % elastane." });
});

test("a text Field takes the words as typed", () => {
  expect(parseClaim(" Komorniki, Poland ", { type: "text", label: "Place" })).toEqual({ value: "Komorniki, Poland" });
});

import { settledText, suggestions, windowLength } from "../src/screens/brand/derive.ts";

test("Supplier suggestions come from past uploads, with a count, filtered by what is typed", () => {
  const docs = [{ supplier: "Hunan Cellworks" }, { supplier: "Hunan Cellworks" }, { supplier: "Fiação do Ave" }, { supplier: "" }];
  expect(suggestions(docs, "")).toEqual([{ name: "Hunan Cellworks", meta: "2 Documents" }, { name: "Fiação do Ave", meta: "1 Document" }]);
  expect(suggestions(docs, "hun")).toEqual([{ name: "Hunan Cellworks", meta: "2 Documents" }]);
  expect(suggestions(docs, "Hunan Cellworks")).toEqual([]);
});

test("the Challenge Window reads in hours, or minutes when short", () => {
  expect(windowLength(48 * 3600_000)).toBe("48 h");
  expect(windowLength(3 * 60_000)).toBe("3 min");
});

test("the settled banner names the Slash when one was upheld", () => {
  const e = { bond: "50", bondLeft: "50", fee: "5", upheld: 0 };
  expect(settledText(e, "Baseline")).toBe("Bond 50.00 USDC released. Fee 5.00 USDC paid.");
  expect(settledText({ ...e, bondLeft: "45", upheld: 1 }, "Baseline")).toBe("Baseline Bond 45.00 USDC released after a 5.00 USDC Slash. Fee paid.");
});

const f = (x: Record<string, unknown>) => ({ name: "n", label: "L", tieBreak: false, status: "final", evidence: { page: 1, quote: "q", rects: [] }, display: "", ...x }) as unknown as ApiField;

test("a value reads as value, unit and qualifier: 220 Ah · rated; a composition as shares", () => {
  expect(shown(f({ value: 220, unit: "Ah", qualifier: "rated" }))).toBe("220 Ah · rated");
  expect(shown(f({ value: "NMC811" }))).toBe("NMC811");
  expect(shown(f({ value: { cotton: 95, elastane: 5 }, unit: "%" }))).toBe("95 % cotton · 5 % elastane");
  expect(shown(f({ status: "not stated", quotes: [], supplierRequest: "" }))).toBe("Not stated");
});

test("Compare lists every Field for both Pipelines and marks the server's differs", () => {
  const c = compare(doc("doc-1"));
  const cap = c.rows.find((r) => r.name === "rated_capacity_ah")!;
  expect(cap).toMatchObject({ label: "Rated capacity", values: ["220 Ah · rated", "80 Ah"], diff: true });
  const ns = c.rows.find((r) => r.name === "initial_internal_resistance_ohm")!;
  expect(ns.values[0]).toBe("Not stated");
  expect(c.rows.filter((r) => r.diff)).toHaveLength(2);
  expect(c.summary).toBe("2 differences in 10 Fields. Click a row to see its quote.");
});

test("Review puts Not stated Fields in their own group, above the other rows", () => {
  const g = reviewGroups(doc("doc-1").views[0]!.fields);
  expect(g.notStated.map((x) => x.name)).toEqual(["initial_internal_resistance_ohm"]);
  expect(g.rows).toHaveLength(9);
  expect(g.order[0]).toBe("initial_internal_resistance_ohm");
});

test("Review splits Not stated by Author and groups the other rows by Template section, in Template order", () => {
  const f = (name: string, section: string, author: "Supplier" | "Brand", status: "final" | "not stated") =>
    ({ name, label: name, section, author, tieBreak: false, status, ...(status === "not stated" ? { quotes: [] } : { value: 1, display: "1", evidence: { page: 1, quote: "q", rects: [] } }) }) as ApiField;
  const g = reviewGroups([
    f("commodity_code", "General", "Brand", "not stated"), f("mass", "General", "Supplier", "final"),
    f("cf", "Carbon footprint", "Supplier", "not stated"), f("chem", "Materials", "Supplier", "final"), f("crm", "Materials", "Supplier", "final"),
  ]);
  expect(g.supplier.map((x) => x.name)).toEqual(["cf"]);
  expect(g.brand.map((x) => x.name)).toEqual(["commodity_code"]);
  expect(g.sections.map((s) => [s.section, s.fields.map((x) => x.name)])).toEqual([["General", ["mass"]], ["Materials", ["chem", "crm"]]]);
  expect(g.order).toEqual(["cf", "commodity_code", "mass", "chem", "crm"]);
});

test("viewer boxes: the selected Field is solid and tagged, a Challenged one red, the rest dashed", () => {
  const b = boxes(doc("doc-1").views[1]!.fields, "nominal_voltage_v");
  expect(b.find((x) => x.id === "nominal_voltage_v")).toMatchObject({ kind: "selected", tag: "Nominal voltage" });
  expect(b.find((x) => x.id === "rated_capacity_ah")).toMatchObject({ kind: "challenged", tag: "Challenged" });
  expect(b.find((x) => x.id === "battery_mass_kg")).toMatchObject({ kind: "quoted" });
  expect(b.find((x) => x.id === "battery_mass_kg")!.tag).toBeUndefined();
});
