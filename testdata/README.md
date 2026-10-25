# Test Documents

Made-up Documents with their expected Field values, for the accuracy report and the demo (issue #3). Every company, product, identifier and certificate in them is invented. Each page carries a "FICTITIOUS SAMPLE DOCUMENT" footer.

> **Status: the expected values are agent-drafted and wait for Artur's hand-check.** Do not tick "Artur has checked every expected value" on issue #3 until he has read every `expected/*.json` against its PDF.

## Layout

- `documents/*.pdf`: the Documents (generated, committed).
- `expected/*.json`: the expected value for every Template Field, one file per Document, same base name.
- `fields.json`: the Field names, types and canonical units per Template. Keep in step with the Templates in `src/`.
- `runs/*.json`: recorded runs for replay. `runs/scripted-demo.json` is **scripted** (`scripts/scripted-run.ts`, expected values plus the Baseline's planted 16 %), not a live run.
- `generate/`: `generate.mjs` writes the PDFs; `check.mjs` checks an expected-values file; the `*.test.mjs` files run the checks.

## Expected-values format

```json
"rated_capacity_ah": { "value": 3.2, "unit": "Ah", "qualifier": "nominal", "page": 1, "quote": "Nominal capacity 3200 mAh" },
"battery_identifier": "Not stated"
```

- Quantities are in the Field's canonical unit (`fields.json`), already converted. `qualifier` is the word the Document uses, or `null` where the Field takes none.
- Compositions are `{ fibre: percent }` with canonical fibre names, adding to 100.
- Codes use the canonical form: chemistry `NMC811`, `NMC`, `LFP`; category `EV`, `LMT`, `industrial`, `portable`; country ISO alpha-2.
- Dates are `YYYY-MM` or `YYYY-MM-DD`, as precise as the Document is.
- `quote` is text copied from the PDF's text layer on `page`. It must be found there after folding whitespace (line breaks count as spaces).

## Documents

| Document | Template | Layout | What it tests |
|---|---|---|---|
| `battery-01-voltaris-pack-spec` | battery | 2-page spec sheet, label/value tables | The easy case. Every Field given. Power in kW (to W). Values from Origyn's made-up Voltaris NMC-800 example. |
| `battery-02-kestrel-18650-cell-datasheet` | battery | 1-page cell datasheet, 3-column parameter table | **mAh to Ah** (3200 mAh = 3.2 Ah), g to kg, mOhm to ohm. Many Fields Not stated (no serial, no manufacture date: the datasheet revision date is not one). Storage temperature counts as idle temperature. |
| `battery-03-cityglide-ebike-test-report` | battery | 2-page prose lab report | Values inside sentences. Rated 14 Ah vs measured 13.8 Ah: the expected value is the rated one. Only operating temperature is given, so idle temperature is Not stated. |
| `battery-04-helion-storage-module` | battery | brochure page + data table | **Planted error**, see below. |
| `textile-01-northwind-grs-certificate` | textile | GRS-style product certificate | Composition in one line, certificate fields. The issue date fills `production_date` (its label is "Production / issue date"). No footprint, water, care or durability: Not stated. |
| `textile-02-lumen-tee-spec-sheet` | textile | garment tech sheet with a fibre table | Composition from a **table**, water **m3 to L** (1.9 m3 = 1900 L), gsm to g/m2. Every Field given. |

### The planted error (battery-04)

Page 1 has a highlight box with **"16 % recycled lithium"** in large type. The small line under it says "Roadmap target for 2031". The share this product actually has is in the page-2 table: "Recycled lithium, this production lot (pre + post consumer) **6 %**". The expected value is **6 %**. A one-pass extraction is likely to return 16 %. `recycled_content_lithium` is a high-stake Field, so this is the demo Challenge.

### Calls for Artur to confirm while checking

- `rated_capacity_ah` takes the Document's own qualifier word: `nominal` for the Kestrel cell, `rated` elsewhere.
- Recycled cobalt, nickel and lead are Not stated when the Document doesn't mention them (battery-03, battery-04), not 0 %, even for LFP chemistry that holds no cobalt or nickel.
- battery-01 `initial_internal_resistance_ohm` is the pack value (0.135 ohm), not the cell value.
- textile-02 `chemical_compliance` combines the REACH line and the OEKO-TEX line.

## Regenerate and validate

```sh
cd testdata/generate
npm install
npm run generate   # rewrites documents/*.pdf (byte-stable: fixed PDF dates)
npm test           # node --test: every Template Field covered, every quote found, units canonical, compositions add to 100
```
