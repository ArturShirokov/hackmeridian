# Test Documents

Made-up Documents with their expected Field values, for the accuracy report and the demo (issue #3). Every company, product, identifier and certificate in them is invented. Each page carries a "FICTITIOUS SAMPLE DOCUMENT" footer.

> **Status: AGENT-DRAFTED, NOT HAND-CHECKED.** Every value in `expected/*.json` was redrafted by an agent on 25 Oct 2026 against the official Templates (#20: battery 60 Fields, textile 37). Artur has not checked them yet. Do not tick "Artur has checked every expected value" on issue #3 until he has read every `expected/*.json` against its PDF; #3 stays open for that.

## Layout

- `documents/*.pdf`: the Documents (generated, committed).
- `expected/*.json`: the expected value for every Template Field, one file per Document, same base name.
- `fields.json`: per Template, each Field's source number, type, canonical unit, high-stake flag, Author and section. Written from `src/templates.ts` (the official lists in `docs/templates/official-templates.md`); keep the two in step.
- `runs/*.json`: recorded runs for replay. `runs/scripted-demo.json` is **scripted** (`scripts/scripted-run.ts`, expected values plus the Baseline's planted 16 %), not a live run.
- `generate/`: `generate.mjs` writes the PDFs; `check.mjs` checks an expected-values file; the `*.test.mjs` files run the checks.

## Expected-values format

```json
"rated_capacity_ah": { "value": 3.2, "unit": "Ah", "qualifier": "nominal", "page": 1, "quote": "Nominal capacity 3200 mAh" },
"battery_identifier": "Not stated"
```

- Quantities are in the Field's canonical unit (`fields.json`, spelt as there: `kgCO2e/kWh`, `Ω`, `A/Ah`), already converted. `qualifier` is the word the Document uses, or `null` where the Field takes none.
- Compositions are `{ fibre: percent }` with canonical fibre names, adding to 100.
- Codes use the canonical form: chemistry `NMC811`, `NMC`, `LFP`; category `EV`, `LMT`, `industrial`, `portable`; country ISO alpha-2; CN code without spaces; recycled origin `pre-consumer` / `post-consumer`.
- Dates are `YYYY-MM` (the Templates' date unit), even when the Document gives the day.
- `quote` is text copied from the PDF's text layer on `page`. It must be found there after folding whitespace (line breaks count as spaces).

## Documents

Stated values per Document (the rest are Not stated): battery-01 48 of 60, battery-02 13, battery-03 18, battery-04 20; textile-01 8 of 37, textile-02 16.

| Document | Template | Layout | What it tests |
|---|---|---|---|
| `battery-01-voltaris-pack-spec` | battery | 2-page spec sheet, label/value tables | The full case: most Supplier Fields given, plus two Brand-authored ones a Supplier sheet happens to state (CN code, warranty). Carbon footprint split by life-cycle stage; recycled share split pre-/post-consumer per metal in a 4-column table. Power in kW (to W), **C-rate `1C` to 1 A/Ah**. Values from Origyn's made-up Voltaris NMC-800 example. |
| `battery-02-kestrel-18650-cell-datasheet` | battery | 1-page cell datasheet, 3-column parameter table | **mAh to Ah** (3200 mAh = 3.2 Ah), g to kg, mOhm to Ω. Mostly Not stated (no manufacture date: the datasheet revision date is not one). Storage temperature counts as idle temperature. |
| `battery-03-cityglide-ebike-test-report` | battery | 2-page prose lab report | Values inside sentences. Rated 14 Ah vs measured 13.8 Ah: the expected value is the rated one. Only operating temperature is given, so idle temperature is Not stated. Manufacture date 14 September 2026 is `2026-09`. |
| `battery-04-helion-storage-module` | battery | brochure page + data table | **Planted error**, see below. Calendar lifetime and extinguishing agent in the table. |
| `textile-01-northwind-grs-certificate` | textile | GRS-style product certificate | Composition in one line, "Portugal" to `PT`, EORI as the manufacturer identifier, a facility ID. Certificate number and dates are no longer Template Fields. Most Fields Not stated. |
| `textile-02-lumen-tee-spec-sheet` | textile | garment tech sheet with a fibre table | Composition from a **table**, water **m3 to L** (1.9 m3 = 1900 L), garment weight **g to kg**, grades (pilling, colour fastness), a negative dimensional change, PFAS statement, Brand-authored footprint and water stated by the Supplier. |

### The planted error (battery-04)

Page 1 has a highlight box with **"16 % recycled lithium"** in large type. The small line under it says "Roadmap target for 2031". The share this product actually has is in the page-2 table: "Recycled lithium, this production lot (pre + post consumer) **6 %**". The expected value is **6 %**. A one-pass extraction is likely to return 16 %. `recycled_content_lithium` is a high-stake Field, so this is the demo Challenge.

### Calls for Artur to confirm while checking

- `rated_capacity_ah` takes the Document's own qualifier word: `nominal` for the Kestrel cell, `rated` elsewhere.
- Recycled cobalt, nickel and lead are Not stated when the Document doesn't mention them (battery-03, battery-04), not 0 %, even for LFP chemistry that holds no cobalt or nickel. Pre-/post-consumer shares likewise (only battery-01 splits them).
- battery-01 `initial_internal_resistance_ohm` is the pack value (0.135 Ω), not the cell value (Field 68 says "cell and pack"; the hint asks for the pack).
- battery-01 `commodity_code`, `warranty_period` (Brand-authored) are taken from the Supplier sheet because it states them. An Author only routes Not stated Fields.
- battery-01 `cycle_life_reference_test` is "IEC 62660-1" from the durability table, not the conditions in brackets on page 1.
- battery-02/03 "to 80% of nominal/rated capacity" (cycle-life end criterion) is left Not stated for `capacity_threshold_exhaustion_percent`. Arguably it is that value.
- textile-01 `manufacturer_identifier` is the EORI number; the GRS chemical-restrictions line is not read as `substances_of_concern` (no identity or concentration), so Not stated.
- textile-02 `substances_of_concern` is the REACH line only; the OEKO-TEX certificate is no longer a Field. `size` is "XS-XXL (EU)" (a size range, not one size).
- `recycled_content_origin` is a code: `post-consumer` (textile-01), `pre-consumer` (textile-02).

### What changed in the #20 redraft

The ad-hoc Templates (battery 25, textile 18 Fields) were replaced by the official lists. Dropped Fields: battery `name`, `battery_identifier` (system-assigned); textile `product_name`, `manufacturer_name`, `production_date`, `fabric_weight`, certificate scheme/number/expiry, `chemical_compliance`, `durability_rating`. Renamed: `country_of_manufacture` to `country_of_final_assembly`, `recycled_fibre_type` to `recycled_content_origin` (now a code). The PDFs gained lines for new Fields (battery-01, battery-04, textile-01, textile-02); the planted battery-04 error is unchanged. `runs/scripted-demo.json` was regenerated (`npx tsx scripts/scripted-run.ts`).

## Regenerate and validate

```sh
cd testdata/generate
npm install
npm run generate   # rewrites documents/*.pdf (byte-stable: fixed PDF dates)
npm test           # node --test: every Template Field covered, every quote found, units canonical, compositions add to 100
```
