// Templates as data: docs/templates/official-templates.md, battery 60 Fields and textile 37, in source order.
import * as z from "zod";

export type FieldType = "code" | "quantity" | "composition" | "text" | "date";
export type Qualifier = "nominal" | "rated" | "minimum" | "maximum" | "typical";
export type Author = "Supplier" | "Brand";

export interface Field {
  /** Number in the source list: "18", "38a", "2.2.1". */
  no: string;
  name: string;
  label: string;
  type: FieldType;
  /** Canonical unit, quantities and compositions only. */
  unit?: string;
  /** Qualifiers a value may carry. Omitted = the Field takes no qualifier. */
  qualifiers?: Qualifier[];
  /** Needs full agreement between Sieves, never a majority. */
  highStake?: true;
  /** The Template section the Field sits in. */
  section: string;
  /** Whose Documents normally state it: a Not stated Field goes to a Supplier Request or to "Brand to provide". */
  author: Author;
  /** How to write the value, for Workers: "YYYY-MM", "ISO 3166 alpha-2". */
  hint?: string;
}

export interface Template {
  name: string;
  label: string;
  fields: Field[];
}

/** An optional string where "" or whitespace counts as absent (models write `"unit": ""` on Fields with no unit). */
const optionalText = z.preprocess((v) => (typeof v === "string" && !v.trim() ? undefined : v), z.string().min(1).optional());

/** The parts of a stated Field value, shared by extraction results and Challenges (each adds field and page). */
export const statedValue = {
  value: z.union([z.string().min(1), z.number(), z.record(z.string(), z.number())]),
  unit: optionalText,
  qualifier: optionalText,
  quote: z.string().min(1),
};

/** What a value of each structured Field type must be, for error messages. */
export const mustBe = {
  quantity: "a quantity value must be a number",
  composition: "a composition value must be { fibre: percent }",
};

/** A Field maker for one section. */
const section =
  (name: string) =>
  (no: string, field: string, label: string, type: FieldType, author: Author, more: Partial<Field> = {}): Field => ({
    no, name: field, label, type, section: name, author, ...more,
  });
const S = "Supplier", B = "Brand";
const pct = { unit: "%" } as const;
const star = { highStake: true } as const;
const cf = { unit: "kgCO2e/kWh" } as const;

// Battery sections follow the Commission's "data point by category"; the source numbers fall in them in order.
const general = section("General battery and manufacturer information");
const labels = section("Symbols, labels and conformity");
const footprint = section("Carbon footprint");
const materials = section("Battery materials and composition");
const circularity = section("Circularity and resource efficiency");
const performance = section("Performance and durability");
const metals = [["nickel", "Ni"], ["cobalt", "Co"], ["lithium", "Li"], ["lead", "Pb"]] as const;

export const battery: Template = {
  name: "battery",
  label: "Battery",
  fields: [
    general("R2", "commodity_code", "Commodity code (CN)", "code", B),
    general("2", "operator_identifier_information", "Operator identifier and information", "text", B),
    general("3", "manufacturer_identifier_information", "Manufacturer identifier and information", "text", S),
    general("3a", "manufacturer_contact", "Digital contact of manufacturer/importer (e-mail or web form)", "text", S),
    general("4", "manufacturing_place", "Manufacturing place", "text", S),
    general("5", "manufacturing_date", "Manufacturing date", "date", S, { hint: "YYYY-MM" }),
    general("7", "warranty_period", "Warranty period", "text", B),
    general("8", "battery_category", "Battery category", "code", S, { hint: "EV, LMT, SLI, industrial or portable" }),
    general("9", "battery_mass_kg", "Battery mass", "quantity", S, { unit: "kg", qualifiers: ["nominal", "maximum"] }),
    labels("14", "extinguishing_agent", "Extinguishing agent", "text", S),
    labels("15", "labels_meaning", "Meaning of labels and symbols", "text", B),
    footprint("18", "carbon_footprint_functional_unit", "Carbon footprint per functional unit", "quantity", S, { ...cf, ...star }),
    footprint("19", "cf_raw_material", "CF contribution: raw material acquisition and pre-processing", "quantity", S, cf),
    footprint("20", "cf_main_production", "CF contribution: main product production", "quantity", S, cf),
    footprint("21", "cf_distribution", "CF contribution: distribution", "quantity", S, cf),
    footprint("22", "cf_end_of_life", "CF contribution: end of life and recycling", "quantity", S, cf),
    materials("27", "battery_chemistry", "Battery chemistry", "code", S, { hint: "e.g. NMC811, NMC, LFP, NCA, Na-ion" }),
    materials("28", "critical_raw_materials", "Critical raw materials", "text", S),
    materials("29", "electrode_electrolyte_materials", "Materials used in cathode, anode and electrolyte", "text", S),
    materials("30", "hazardous_substances", "Hazardous substances", "text", S),
    materials("31", "substance_impact", "Impact of substances on environment, human health, safety", "text", S),
    circularity("33", "component_part_numbers", "Part numbers for components", "text", S),
    circularity("34", "spare_parts_postal_address", "Postal address of sources for spare parts", "text", B),
    circularity("35", "spare_parts_email", "E-mail address of sources for spare parts", "text", B),
    circularity("36", "spare_parts_web", "Web address of sources for spare parts", "text", B),
    ...(["cobalt", "lithium", "nickel", "lead"] as const).map((m, i) =>
      circularity(`38${"abcd"[i]}`, `recycled_content_${m}`, `Recycled ${m} share`, "quantity", S, {
        ...pct, qualifiers: ["minimum"], ...star, hint: "pre- and post-consumer combined",
      })),
    ...metals.map(([m, sym], i) => circularity(String(39 + i), `pre_consumer_recycled_${m}`, `Pre-consumer recycled ${sym} share`, "quantity", S, pct)),
    ...metals.map(([m, sym], i) => circularity(String(43 + i), `post_consumer_recycled_${m}`, `Post-consumer recycled ${sym} share`, "quantity", S, pct)),
    circularity("47", "renewable_content_percent", "Renewable content share", "quantity", S, pct),
    circularity("47a", "eu_recycling_bonus", "EU-recycling bonus applied (planned)", "code", S, { hint: "yes or no" }),
    circularity("47b", "eu_recycler_share_percent", "Share of recycled input from EU recyclers (planned)", "quantity", S, pct),
    performance("51", "rated_capacity_ah", "Rated capacity", "quantity", S, { unit: "Ah", qualifiers: ["rated", "nominal", "minimum", "typical"] }),
    performance("53", "capacity_fade_percent", "Capacity fade", "quantity", S, pct),
    performance("56", "minimum_voltage_v", "Minimum voltage", "quantity", S, { unit: "V", qualifiers: ["minimum"] }),
    performance("57", "maximum_voltage_v", "Maximum voltage", "quantity", S, { unit: "V", qualifiers: ["maximum"] }),
    performance("58", "nominal_voltage_v", "Nominal voltage", "quantity", S, { unit: "V", qualifiers: ["nominal"] }),
    performance("59", "original_power_capability_w", "Original power capability", "quantity", S, { unit: "W", qualifiers: ["nominal", "maximum", "typical"] }),
    performance("61", "power_fade_percent", "Power fade", "quantity", S, pct),
    performance("62", "maximum_permitted_power_w", "Maximum permitted battery power", "quantity", S, { unit: "W" }),
    performance("63", "initial_round_trip_efficiency_percent", "Initial round trip energy efficiency", "quantity", S, { ...pct, qualifiers: ["nominal", "typical", "minimum"] }),
    performance("64", "round_trip_efficiency_half_life_percent", "Round trip energy efficiency at 50% of cycle-life", "quantity", S, pct),
    performance("66", "round_trip_efficiency_fade_percent", "Energy round trip efficiency fade", "quantity", S, pct),
    performance("68", "initial_internal_resistance_ohm", "Initial internal resistance of cell and pack", "quantity", S, {
      unit: "Ω", qualifiers: ["nominal", "typical", "maximum"], hint: "the pack value when both are given",
    }),
    performance("69", "internal_resistance_increase_percent", "Internal resistance increase of pack", "quantity", S, pct),
    performance("70", "expected_lifetime_years", "Expected lifetime in calendar years", "quantity", S, { unit: "years" }),
    performance("71", "expected_lifetime_cycles", "Expected lifetime: charge-discharge cycles", "quantity", S, { unit: "cycles", qualifiers: ["nominal", "minimum", "typical"] }),
    performance("73", "cycle_life_reference_test", "Cycle-life reference test", "text", S),
    performance("74", "cycle_life_c_rate", "C-rate of relevant cycle-life test", "quantity", S, { unit: "A/Ah", hint: "1C = 1 A/Ah" }),
    performance("77", "capacity_threshold_exhaustion_percent", "Capacity threshold for exhaustion", "quantity", S, pct),
    performance("79", "idle_temperature_lower_c", "Idle temperature range, lower boundary", "quantity", S, { unit: "°C", qualifiers: ["minimum"] }),
    performance("80", "idle_temperature_upper_c", "Idle temperature range, upper boundary", "quantity", S, { unit: "°C", qualifiers: ["maximum"] }),
  ],
};

// Textile sections are the source's 2.1 to 2.6.
const ident = section("Product identification");
const substances = section("Materials and substances");
const durability = section("Durability");
const care = section("Care and repair");
const endOfLife = section("End of life and circularity");
const env = section("Environmental footprint");

export const textile: Template = {
  name: "textile",
  label: "Textile",
  fields: [
    ident("2.1.2", "gtin", "Product unique identifier (GTIN/SKU)", "code", B),
    ident("2.1.3", "brand_name", "Brand / trade name", "text", B),
    ident("2.1.4", "manufacturer_identifier", "Unique manufacturer identifier", "code", S),
    ident("2.1.5", "facility_identifier", "Manufacturing facility identifier (final assembly)", "code", S),
    ident("2.1.6", "country_of_final_assembly", "Country of final assembly", "code", S, { hint: "ISO 3166 alpha-2, e.g. PT" }),
    ident("2.1.7", "product_category", "Product category (garment / footwear type)", "text", S),
    ident("2.1.8", "product_mass_kg", "Product mass", "quantity", S, { unit: "kg" }),
    ident("2.1.9", "date_placed_on_market", "Date placed on market", "date", B, { hint: "YYYY-MM" }),
    ident("2.1.10", "declaration_of_conformity_id", "EU declaration of conformity identifier", "code", B),
    ident("2.1.11", "size", "Size system / size", "text", B),
    substances("2.2.1", "fibre_composition", "Fibre composition per fibre type (whole-number %, adds to 100)", "composition", S, {
      ...pct, ...star, hint: "{ fibre: percent by mass }",
    }),
    substances("2.2.2", "recycled_content_percent", "Recycled fibre content", "quantity", S, { ...pct, qualifiers: ["minimum"], ...star }),
    substances("2.2.3", "recycled_content_origin", "Recycled content origin (pre-/post-consumer)", "code", S, { hint: "pre-consumer or post-consumer" }),
    substances("2.2.4", "animal_origin_parts", "Presence of non-textile parts of animal origin", "text", S),
    substances("2.2.5", "coatings_membranes_laminates", "Coatings, membranes and laminates", "text", S),
    substances("2.2.6", "substances_of_concern", "Substances of concern (identity, concentration range)", "text", S),
    substances("2.2.7", "pfas_presence", "Presence of PFAS", "text", S, star),
    substances("2.2.8", "dyeing_finishing_class", "Dyeing / finishing process class", "text", S),
    durability("2.3.1", "durability_class", "Physical durability score / class", "text", S),
    durability("2.3.2", "abrasion_resistance_cycles", "Abrasion resistance (Martindale cycles)", "quantity", S, { unit: "cycles" }),
    durability("2.3.3", "pilling_grade", "Pilling resistance grade (1–5)", "quantity", S, { unit: "grade" }),
    durability("2.3.4", "colour_fastness_washing_grade", "Colour fastness to washing grade (1–5)", "quantity", S, { unit: "grade" }),
    durability("2.3.5", "dimensional_stability_percent", "Dimensional stability after washing", "quantity", S, pct),
    durability("2.3.6", "microfibre_release_class", "Microfibre / microplastic release class", "text", S),
    durability("2.3.7", "expected_lifetime_wash_cycles", "Expected lifetime (wash cycles)", "quantity", S, { unit: "cycles" }),
    care("2.4.1", "care_instructions", "Care instructions (ISO 3758 symbol codes)", "text", S),
    care("2.4.2", "repairability_score", "Repairability score", "text", B),
    care("2.4.3", "spare_parts_availability", "Availability of spare parts", "text", B),
    care("2.4.4", "repair_instructions_link", "Repair instructions (link)", "text", B),
    care("2.4.5", "commercial_guarantee_months", "Commercial guarantee duration", "quantity", B, { unit: "months" }),
    endOfLife("2.5.1", "recyclability_class", "Recyclability score / class", "text", B),
    endOfLife("2.5.2", "disassembly_information_link", "Disassembly information (link)", "text", B),
    endOfLife("2.5.3", "take_back_scheme_link", "Take-back / collection scheme reference (link)", "text", B),
    endOfLife("2.5.4", "packaging_composition", "Packaging material composition", "text", B),
    env("2.6.1", "carbon_footprint", "Carbon footprint per product (PEF-based)", "quantity", B, { unit: "kg CO2e" }),
    env("2.6.2", "water_usage", "Water consumption per product", "quantity", B, { unit: "L" }),
    env("2.6.3", "pef_reference_link", "PEF study / methodology reference (link)", "text", B),
  ],
};

export const templates: Record<string, Template> = { battery, textile };

/** How values of each Field type are compared, for the Arbiter. */
export const rules: Record<FieldType, string> = {
  quantity: "Quantity: same unit after conversion, same qualifier, no tolerance.",
  composition: "Composition: same fibres, same shares, same qualifiers. No tolerance.",
  code: "Code: same code after normalising case, spaces and known synonyms (LiFePO4 = LFP).",
  text: "Text: same words, ignoring case and surrounding spaces.",
  date: "Date: the same month (YYYY-MM); a day the Document gives is kept but not compared.",
};
