# Public test Documents

Real supplier-style PDFs that manufacturers, distributors and certifiers publish openly, with their expected Field values. They sit beside the made-up set in `testdata/` and add real layouts: multi-model tables, text layers that split labels from values, multi-language declarations and a 19-page safety data sheet.

> **Status: AGENT-DRAFTED, NOT HAND-CHECKED.** An agent drafted every value in `expected/*.json` from the PDFs' text layers on 25 Oct 2026. Artur has not checked them yet. Read each file against its PDF before you use these numbers in an accuracy claim.

**We do not redistribute the PDFs.** This repo is public and the PDFs belong to their publishers, so they are not committed. `sources.json` lists where each one comes from. To fetch them:

```sh
npx tsx scripts/fetch-public-testdata.ts   # downloads into testdata/public/documents/ (gitignored), checks each sha256
```

When a publisher changes or moves a file, the sha256 check fails and the script names the file. Find the new copy, then update `sources.json` and the expected values.

## Layout

- `sources.json`: one entry per Document, with `file`, `template`, `url`, `publisher`, `kind`, `sha256`, `pages` and `retrieved`.
- `expected/*.json`: same format as `testdata/expected` (see `testdata/README.md`). Every Template Field is listed, with quotes verbatim from the text layer on the cited page and quantities in canonical units.
- `documents/`: the fetched PDFs (gitignored).
- File names follow `<template>-pNN-<supplier>-<what>.pdf`. The replay reads the Supplier from the third part of the name.

Checks: `cd testdata/generate && npm install && npm test`. `public.test.mjs` checks that every Field is covered, every quote is on its cited page, units are canonical and compositions add to 100. It skips each Document whose PDF has not been fetched.

Accuracy report: `npx tsx scripts/accuracy.ts --set public` (also works with `--replay`). It reads `testdata/public/` and writes runs to `testdata/public/runs/`.

## Documents

| Document | Publisher | Kind | Pages | Stated | What it tests |
|---|---|---|---|---|---|
| `battery-p01-panasonic-ncr18650b-datasheet` | Panasonic (SANYO), copy on TI E2E | cell datasheet | 1 | 8 / 60 | **mAh to Ah** (3200 mAh = 3.2 Ah), **g to kg**. Charts carry no text. Charge, discharge and storage temperatures are on 3 lines, and only storage counts as idle. |
| `battery-p02-victron-lfp-smart-datasheet` | Victron Energy | pack datasheet | 2 | 13 / 60 | **8-model table.** Expected values are for **LFP-Smart 12,8/100** (the 2nd column). The table mixes decimal commas and points (`12,8 V`, `11.2 V`). **mΩ to Ω** (0.8 mΩ). Cycle life at three DoD levels; 80 % DoD is used. |
| `battery-p03-pylontech-us5000-datasheet` | Pylontech, copy from distributor FV Componentes | storage module datasheet | 2 | 9 / 60 | Label/value **table**. Capacity is given in Wh only, so rated capacity is Not stated. `15+ Years` and `>6,000` cycles. Shelf temperature counts as idle temperature. |
| `battery-p04-celxpert-sram-25401-un383-summary` | SRAM (made by Celxpert) | UN 38.3 test summary | 1 | 4 / 60 | Form **table** with a 2-column test grid. Mass `24.92` g to kg. Capacity in Wh only. |
| `battery-p05-changhong-unilite-il850r-un383-summary` | RS Components (Unilite; cell by ChangHong) | UN 38.3 test summary | 1 | 4 / 60 | Numbered form. `3.7v, 2600mAh` to Ah. `49.5387 grams` to kg. Two manufacturers are named: battery and product. |
| `battery-p06-strident-lt12-35-un383-summary` | RS Components (Strident Innovations) | UN 38.3 test summary | 2 | 7 / 60 | LFP pack. `Mass: 4225g` to kg. Cell model as component part number. Page 2 is a wrapped test table. |
| `battery-p07-mts-pedelec-akku-sds` | FISCHER bike (SDS by MTS) | safety data sheet (REACH Annex II) | 19 | 4 / 60 | Long Document with few values. Extinguishing media are on p.4 and the substance list on p.2–3. The repeated page header must not be read as data. |
| `battery-p08-motorola-impres-eu-doc` | Motorola Solutions | EU declaration of conformity (Reg. 2023/1542) | 8 | 1 / 60 | The same declaration in 8 languages. Almost everything is Not stated. |
| `textile-p01-xm-unitec-200-fabric-sheet` | XM Textiles Europe, via the MTender procurement portal | fabric tech sheet | 1 | 5 / 37 | Test-result **table** (ISO 12947-2, 12945-2, 105-C06, 6330). Half grade `4-5`. `>20 000` cycles with a digit-group space. |
| `textile-p02-xm-eco-210-fabric-sheet` | XM Textiles Europe, via MTender | fabric tech sheet | 1 | 6 / 37 | Same layout with recycled fibres (100 % recycled, from two lines). Grade `3-4`. |
| `textile-p03-stanleystella-sttw172-tee-sheet` | Stanley/Stella, copy on the CCC merch site | garment product sheet | 3 | 5 / 37 | Origin given per stage (weaving, dyeing, assembly), so only assembly counts. A colour-variant composition (Heather Haze) is ignored. Fabric `180 GSM` is not garment mass. |
| `textile-p04-novatex-orso-fabric-sheet` | Novatex (Formatex) | upholstery fabric data sheet | 1 | 3 / 37 | **5-fibre composition.** The text layer runs the results together (`50,0004444`), which reads as abrasion 50,000 and then pilling 4 in the image. Care is given as symbols only, so Not stated. |
| `textile-p05-kleinhempel-greentex-infinite-sheet` | Kleinhempel GmbH | technical textile data sheet | 1 | 2 / 37 | **German/English**, with labels and values split into separate blocks in the text layer. `185 g/m²` is fabric weight, not mass. |
| `textile-p06-pacifictextiles-grs-scope-certificate` | Pacific Textiles (issued by Control Union) | GRS 4.0 scope certificate | 4 | 1 / 37 | Real certificate. The product annex lists about 30 compositions, so composition and recycled origin are Not stated. Only the licence number is a value. |

Unit conversions: mAh to Ah (p01, p05), g to kg (p01, p04, p05, p06), mΩ to Ω (p02). Tables: p02, p03, p04, p06, textile p01, p02, p04.

## Calls for Artur to confirm while checking

- **p02 Victron:** the expected values are for one column (12,8/100) of an 8-model sheet. Decide whether multi-model sheets should stay in the set. Also: `maximum_voltage_v` 14.4 V is the top of the charge-voltage range. `capacity_threshold_exhaustion_percent` is Not stated even though the sheet says "capacity ≥ 80 % of nominal", following the existing convention. "Capacity loss <1 % per 100 cycles" is not read as `capacity_fade_percent`.
- **p01 Panasonic:** the `rated_capacity_ah` qualifier is `minimum` ("Rated capacity Min. 3200mAh"). `rated` would also be defensible. Chemistry is Not stated: the sheet says only "Lithium Ion", although the cell is NCA.
- **p03 Pylontech:** 4800 Wh at 48 V is not converted to 100 Ah, so it is Not stated. `battery_category` is Not stated ("Residential BESS" would be `industrial` under the Regulation, but the sheet does not say so). LFP is not stated on the sheet either.
- **p05 Unilite:** `manufacturer_identifier_information` is the battery manufacturer (ChangHong), not Unilite (the product manufacturer). The contact block belongs to Unilite, so `manufacturer_contact` is Not stated.
- **p07 SDS:** MTS is the SDS supplier and is taken as the manufacturer. Chemistry is Not stated because three cathode oxides are listed. The substance list has no electrode or electrolyte roles, so it goes to `hazardous_substances` only. The quote covers the first substance only.
- **Textile fabric sheets (p01, p02, p04, p05):** `product_category` is Not stated because these are fabrics, not garments. `dimensional_stability_percent` is `3` (the sheets say "max. 3.0%", with no sign). Half grades `4-5` and `3-4` are written as 4.5 and 3.5.
- **textile p02:** `recycled_content_percent` 100 is inferred from both fibres being recycled.
- **textile p06:** the TE licence number is taken as `manufacturer_identifier`.

## Licence notes

These were seen in the files. Another reason the PDFs are fetched, not committed:

- Panasonic NCR18650B: "Copyright© 2012 SANYO Energy (U.S.A.) Corporation. All Rights Reserved." and "for descriptive purposes only".
- Kleinhempel GreenTex: "© Kleinhempel GmbH, 2023".
- Pacific Textiles GRS: "This electronically issued document is the valid original version." (Control Union template). Other GRS templates say "shall not be reproduced except in full".
- The others carry no explicit licence. They are public compliance or marketing documents.
