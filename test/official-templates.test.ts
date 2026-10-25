import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { baseline } from "../src/pipelines.js";
import { extraction, makePdf, startBoard } from "./seam.js";

/** The Field rows of one Template's table in docs/templates/official-templates.md, 39–42 and 43–46 split per metal. */
function docRows(heading: string) {
  const md = readFileSync(new URL("../docs/templates/official-templates.md", import.meta.url), "utf8");
  const table = md.split(`## ${heading}`)[1]!.split("\n## ")[0]!;
  return table.split("\n").filter((l) => /^\| [R\d]/.test(l)).flatMap((l) => {
    const [noCell, , typeCell, author] = l.split("|").slice(1, -1).map((c) => c.trim());
    const [, type, unit] = /^(\w+)(?: \[(.+)\])?$/.exec(typeCell!)!;
    const highStake = noCell!.includes("★");
    const no = noCell!.replace("★", "").trim();
    const range = /^(\d+)–(\d+)$/.exec(no);
    const nos = range ? Array.from({ length: +range[2]! - +range[1]! + 1 }, (_, i) => String(+range[1]! + i)) : [no];
    return nos.map((no) => ({ no, type, ...(type === "quantity" || type === "composition" ? { unit } : {}), author, highStake }));
  });
}

test.each([["battery", "Battery", 60, 7], ["textile", "Textile", 37, 16]] as const)(
  "the %s Template is the doc's list: Field numbers, types, canonical units, Author and ★, each Field in a section",
  async (name, heading, count, byBrand) => {
    const t = (await startBoard().brand.templates()).find((t) => t.name === name)!;
    const rows = docRows(heading);
    expect(rows).toHaveLength(count);
    expect(rows.filter((r) => r.author === "Brand")).toHaveLength(byBrand);
    expect(t.fields.map((f) => ({ no: f.no, type: f.type, ...(f.unit !== undefined && { unit: f.unit }), author: f.author, highStake: !!f.highStake }))).toEqual(rows);
    for (const f of t.fields) expect(f.section).toMatch(/\w/);
  },
);

test("the textile sections follow the source numbering: 2.1 identification to 2.6 environmental footprint", async () => {
  const t = (await startBoard().brand.templates()).find((t) => t.name === "textile")!;
  const bySection = new Map<string, Set<string>>();
  for (const f of t.fields) bySection.set(f.section, (bySection.get(f.section) ?? new Set()).add(f.no.split(".").slice(0, 2).join(".")));
  expect([...bySection.values()].map((s) => [...s])).toEqual([["2.1"], ["2.2"], ["2.3"], ["2.4"], ["2.5"], ["2.6"]]);
});

test("Not stated follows the Author: one Supplier Request per Document for the Supplier's Fields, the Brand's listed as Brand to provide", async () => {
  const { worker, brand } = startBoard({ pipelines: [baseline] });
  const quote = "Rated capacity 220 Ah";
  const id = await brand.upload(await makePdf([[quote, "Warranty: see brand terms"]]), "battery", { supplier: "Voltaris" });
  const w = await worker("w1");
  const job = (await w.nextJob())!;
  const rated = { value: 220, unit: "Ah", qualifier: "rated", page: 1, quote };
  expect(await w.submitJob(job.id, extraction(job, { rated_capacity_ah: rated }))).toMatchObject({ ok: true });

  const view = (await brand.document(id)).views[0]!;
  const notStated = view.fields.filter((f) => f.status === "not stated");
  const bySupplier = notStated.filter((f) => f.author === "Supplier");
  expect(bySupplier).toHaveLength(52);
  expect(view.brandToProvide).toEqual([
    "commodity_code", "operator_identifier_information", "warranty_period", "labels_meaning",
    "spare_parts_postal_address", "spare_parts_email", "spare_parts_web",
  ]);
  const request = view.supplierRequest!;
  expect(request).toMatch(/^To Voltaris:/);
  for (const f of bySupplier) expect(request).toContain(`"${f.label}"`);
  expect(request).not.toContain("Warranty period");
  expect(request).not.toContain("Rated capacity");
  expect(notStated.find((f) => f.name === "warranty_period")).not.toHaveProperty("supplierRequest");
  expect(view.fields.find((f) => f.name === "rated_capacity_ah")).toMatchObject({ status: "final", section: "Performance and durability", author: "Supplier" });
});
