# Official Templates: the Fields we extract

The source is Origyn's "DPP templates" Google Doc (battery and textile tabs, read 25 Oct 2026). The battery list follows the Commission's "Digital Batteries Passport – data point by category". The textile list is Origyn's internal draft (anticipatory, not official).

**What's in:** only Fields that can be read from a **Supplier's Document** or a **Brand's own Document**. Each Field names its **author**, the side whose Documents normally state it. A Not stated Field becomes a Supplier Request when the author is the Supplier, and "Brand to provide" when the author is the Brand.

**What's left out, and why:**
- Registry-assigned data (R1, R3–R5).
- Item-level data generated in use, i.e. live battery management system values: 6, 10, 52, 54, 55, 60, 65, 67, 72, 75, 76, 78, 81–86.
- System-assigned identifiers (battery 1, textile 2.1.1).
- Graphics (11–13).
- Fields whose value is a whole attached PDF, not something read from a Document (16, 17, 24, 26, 32, 37, 48–50a).
- Fields with no defined content yet (23, 25).

**High-stake** (★) means the Field needs full agreement between Sieves, never a majority.

Numbers refer to the source list. Units in brackets are canonical units.

## Battery

| No. | Field | Type [unit] | Author |
|---|---|---|---|
| R2 | Commodity code (CN) | code | Brand |
| 2 | Operator identifier and information | text | Brand |
| 3 | Manufacturer identifier and information | text | Supplier |
| 3a | Digital contact of manufacturer/importer (e-mail or web form) | text | Supplier |
| 4 | Manufacturing place | text | Supplier |
| 5 | Manufacturing date | date [YYYY-MM] | Supplier |
| 7 | Warranty period | text | Brand |
| 8 | Battery category | code | Supplier |
| 9 | Battery mass | quantity [kg] | Supplier |
| 14 | Extinguishing agent | text | Supplier |
| 15 | Meaning of labels and symbols | text | Brand |
| 18 ★ | Carbon footprint per functional unit | quantity [kgCO2e/kWh] | Supplier |
| 19 | CF contribution: raw material acquisition and pre-processing | quantity [kgCO2e/kWh] | Supplier |
| 20 | CF contribution: main product production | quantity [kgCO2e/kWh] | Supplier |
| 21 | CF contribution: distribution | quantity [kgCO2e/kWh] | Supplier |
| 22 | CF contribution: end of life and recycling | quantity [kgCO2e/kWh] | Supplier |
| 27 | Battery chemistry | code | Supplier |
| 28 | Critical raw materials | text | Supplier |
| 29 | Materials used in cathode, anode and electrolyte | text | Supplier |
| 30 | Hazardous substances | text | Supplier |
| 31 | Impact of substances on environment, human health, safety | text | Supplier |
| 33 | Part numbers for components | text | Supplier |
| 34 | Postal address of sources for spare parts | text | Brand |
| 35 | E-mail address of sources for spare parts | text | Brand |
| 36 | Web address of sources for spare parts | text | Brand |
| 38a ★ | Recycled cobalt share | quantity [%] | Supplier |
| 38b ★ | Recycled lithium share | quantity [%] | Supplier |
| 38c ★ | Recycled nickel share | quantity [%] | Supplier |
| 38d ★ | Recycled lead share | quantity [%] | Supplier |
| 39–42 | Pre-consumer recycled Ni / Co / Li / Pb share (voluntary, 4 Fields) | quantity [%] | Supplier |
| 43–46 | Post-consumer recycled Ni / Co / Li / Pb share (voluntary, 4 Fields) | quantity [%] | Supplier |
| 47 | Renewable content share | quantity [%] | Supplier |
| 47a | EU-recycling bonus applied (planned) | code [yes/no] | Supplier |
| 47b | Share of recycled input from EU recyclers (planned) | quantity [%] | Supplier |
| 51 | Rated capacity | quantity [Ah] | Supplier |
| 53 | Capacity fade | quantity [%] | Supplier |
| 56 | Minimum voltage | quantity [V] | Supplier |
| 57 | Maximum voltage | quantity [V] | Supplier |
| 58 | Nominal voltage | quantity [V] | Supplier |
| 59 | Original power capability | quantity [W] | Supplier |
| 61 | Power fade | quantity [%] | Supplier |
| 62 | Maximum permitted battery power | quantity [W] | Supplier |
| 63 | Initial round trip energy efficiency | quantity [%] | Supplier |
| 64 | Round trip energy efficiency at 50% of cycle-life | quantity [%] | Supplier |
| 66 | Energy round trip efficiency fade | quantity [%] | Supplier |
| 68 | Initial internal resistance of cell and pack | quantity [Ω] | Supplier |
| 69 | Internal resistance increase of pack | quantity [%] | Supplier |
| 70 | Expected lifetime in calendar years | quantity [years] | Supplier |
| 71 | Expected lifetime: charge-discharge cycles | quantity [cycles] | Supplier |
| 73 | Cycle-life reference test | text | Supplier |
| 74 | C-rate of relevant cycle-life test | quantity [A/Ah] | Supplier |
| 77 | Capacity threshold for exhaustion | quantity [%] | Supplier |
| 79 | Idle temperature range, lower boundary | quantity [°C] | Supplier |
| 80 | Idle temperature range, upper boundary | quantity [°C] | Supplier |

That's 60 Fields once 38 and 39–46 are split per metal: 53 by the Supplier, 7 by the Brand.

## Textile

| No. | Field | Type [unit] | Author |
|---|---|---|---|
| 2.1.2 | Product unique identifier (GTIN/SKU) | code | Brand |
| 2.1.3 | Brand / trade name | text | Brand |
| 2.1.4 | Unique manufacturer identifier | code | Supplier |
| 2.1.5 | Manufacturing facility identifier (final assembly) | code | Supplier |
| 2.1.6 | Country of final assembly | code [ISO 3166 alpha-2] | Supplier |
| 2.1.7 | Product category (garment / footwear type) | text | Supplier |
| 2.1.8 | Product mass | quantity [kg] | Supplier |
| 2.1.9 | Date placed on market | date [YYYY-MM] | Brand |
| 2.1.10 | EU declaration of conformity identifier | code | Brand |
| 2.1.11 | Size system / size | text | Brand |
| 2.2.1 ★ | Fibre composition per fibre type (whole-number %, adds to 100) | composition [%] | Supplier |
| 2.2.2 ★ | Recycled fibre content | quantity [%] | Supplier |
| 2.2.3 | Recycled content origin (pre-/post-consumer) | code | Supplier |
| 2.2.4 | Presence of non-textile parts of animal origin | text | Supplier |
| 2.2.5 | Coatings, membranes and laminates | text | Supplier |
| 2.2.6 | Substances of concern (identity, concentration range) | text | Supplier |
| 2.2.7 ★ | Presence of PFAS | text | Supplier |
| 2.2.8 | Dyeing / finishing process class | text | Supplier |
| 2.3.1 | Physical durability score / class | text | Supplier |
| 2.3.2 | Abrasion resistance (Martindale cycles) | quantity [cycles] | Supplier |
| 2.3.3 | Pilling resistance grade (1–5) | quantity [grade] | Supplier |
| 2.3.4 | Colour fastness to washing grade (1–5) | quantity [grade] | Supplier |
| 2.3.5 | Dimensional stability after washing | quantity [%] | Supplier |
| 2.3.6 | Microfibre / microplastic release class | text | Supplier |
| 2.3.7 | Expected lifetime (wash cycles) | quantity [cycles] | Supplier |
| 2.4.1 | Care instructions (ISO 3758 symbol codes) | text | Supplier |
| 2.4.2 | Repairability score | text | Brand |
| 2.4.3 | Availability of spare parts | text | Brand |
| 2.4.4 | Repair instructions (link) | text | Brand |
| 2.4.5 | Commercial guarantee duration | quantity [months] | Brand |
| 2.5.1 | Recyclability score / class | text | Brand |
| 2.5.2 | Disassembly information (link) | text | Brand |
| 2.5.3 | Take-back / collection scheme reference (link) | text | Brand |
| 2.5.4 | Packaging material composition | text | Brand |
| 2.6.1 | Carbon footprint per product (PEF-based) | quantity [kg CO2e] | Brand |
| 2.6.2 | Water consumption per product | quantity [L] | Brand |
| 2.6.3 | PEF study / methodology reference (link) | text | Brand |

That's 37 Fields: 21 by the Supplier, 16 by the Brand.

## Open points

- **Who writes what** is our best guess for a typical Supplier/Brand split. A Field can still be read from any Document that states it; the author only decides where a Not stated Field gets routed.
- The textile list is anticipatory. Revisit it when the textile delegated act is published (indicatively 2027).
