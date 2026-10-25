import { expect, test } from "vitest";
import { respond } from "../src/fixtures.ts";
import type { ApiDocument, ApiTemplate } from "../src/api.ts";
import { boxes, passport, passportMarkdown } from "../src/screens/brand/derive.ts";

const doc = () => structuredClone(respond("/api/documents/doc-1")) as ApiDocument;
const battery = () => structuredClone((respond("/api/templates") as ApiTemplate[]).find((t) => t.name === "battery")!);

test("the JSON export round-trips the delivered Fields exactly, every Field present and Not stated explicit", () => {
  const d = doc();
  const ours = d.views[0]!;
  const back = JSON.parse(JSON.stringify(passport(d, ours)));
  expect(back).toMatchObject({ template: "battery", documentId: "doc-1", pipeline: "ours", operator: "Origyn", outputHash: ours.escrow!.outputHash });
  expect(Object.keys(back.fields)).toEqual(ours.fields.map((f) => f.name));
  expect(back.fields.rated_capacity_ah).toEqual({ status: "final", value: 220, unit: "Ah", qualifier: "rated", page: 1, quote: "Rated capacity 220 Ah" });
  expect(back.fields.battery_chemistry).toEqual({ status: "final", value: "NMC811", page: 2, quote: "Lithium nickel manganese cobalt oxide (NMC 811), graphite anode" });
  expect(back.fields.initial_internal_resistance_ohm).toEqual({ status: "not stated", value: "Not stated" });
  for (const f of ours.fields) {
    if (!("evidence" in f)) continue;
    const { status: _, ...got } = back.fields[f.name];
    expect(got).toEqual({ value: f.value, ...(f.unit && { unit: f.unit }), ...(f.qualifier && { qualifier: f.qualifier }), page: f.evidence.page, quote: f.evidence.quote });
  }
  // A filed Challenge shows in the status.
  expect(passport(d, d.views[1]!).fields.rated_capacity_ah).toMatchObject({ status: "challenged", value: 80 });
});

test("the JSON carries each Field's Author when the Template gives one", () => {
  const d = doc();
  const t = battery();
  t.fields = t.fields.map((f) => (f.name === "rated_capacity_ah" ? { ...f, author: "Supplier" } : f));
  const out = passport(d, d.views[0]!, t).fields;
  expect(out.rated_capacity_ah).toMatchObject({ author: "Supplier" });
  expect(out.name).not.toHaveProperty("author");
});

test("the Markdown is a table per Template section, falling back to one table without sections", () => {
  const d = doc();
  const t = battery();
  t.fields = t.fields.map((f) => ({ ...f, section: f.name === "rated_capacity_ah" || f.name === "nominal_voltage_v" ? "Performance and durability" : "General" }));
  const md = passportMarkdown(d, d.views[0]!, t);
  expect(md).toContain("# battery-01-voltaris-pack-spec · Origyn\n");
  expect(md).toContain("## Performance and durability\n\n| Field | Value | Status | Page | Quote |\n|---|---|---|---|---|\n| Rated capacity | 220 Ah · rated | Final | 1 | Rated capacity 220 Ah |\n| Nominal voltage | 360 V · nominal | Final | 1 | Nominal voltage 360 V |\n");
  expect(md).toContain("| Initial internal resistance (pack) | Not stated | Not stated |  |  |");
  expect(md.indexOf("## General")).toBeLessThan(md.indexOf("## Performance"));
  expect(passportMarkdown(d, d.views[0]!)).toContain("## Fields\n");
});

test("Fields sharing a quote share one box that lists them all", () => {
  const d = doc();
  const f = d.views[0]!.fields;
  const volt = f.find((x) => x.name === "nominal_voltage_v")!;
  const cap = f.find((x) => x.name === "rated_capacity_ah")!;
  if (!("evidence" in volt) || !("evidence" in cap)) throw new Error("fixture");
  volt.evidence = { ...cap.evidence };
  const b = boxes(f).filter((x) => x.page === 1 && x.rects[0]?.y === cap.evidence.rects[0]!.y);
  expect(b).toHaveLength(1);
  expect(b[0]!.fields).toEqual([{ id: "rated_capacity_ah", label: "Rated capacity" }, { id: "nominal_voltage_v", label: "Nominal voltage" }]);
  expect(boxes(f, "nominal_voltage_v").find((x) => x.fields)).toMatchObject({ kind: "selected", tag: "Nominal voltage" });
});
