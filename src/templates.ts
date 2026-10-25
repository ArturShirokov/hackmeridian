// Templates as data. Battery Field names reuse the ids of Origyn's "Batteries" mint form.
export type FieldType = "code" | "quantity" | "composition" | "text" | "date";
export type Qualifier = "nominal" | "rated" | "minimum" | "maximum" | "typical";

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  /** Canonical unit, quantities and compositions only. */
  unit?: string;
  /** Qualifiers a value may carry. Omitted = the Field takes no qualifier. */
  qualifiers?: Qualifier[];
  /** Needs full agreement between Sieves, never a majority. */
  highStake?: true;
}

export interface Template {
  name: string;
  label: string;
  fields: Field[];
}

const q = (name: string, label: string, unit: string, qualifiers?: Qualifier[], highStake?: true): Field => ({
  name, label, type: "quantity", unit, ...(qualifiers && { qualifiers }), ...(highStake && { highStake }),
});

export const battery: Template = {
  name: "battery",
  label: "Battery",
  fields: [
    { name: "name", label: "Battery model name", type: "text" },
    { name: "battery_identifier", label: "Battery identifier", type: "code" },
    { name: "manufacturer_identifier_information", label: "Manufacturer (name, address, id)", type: "text" },
    { name: "manufacturing_place", label: "Place of manufacture", type: "text" },
    { name: "manufacturing_date", label: "Date of manufacture (YYYY-MM or YYYY-MM-DD)", type: "date" },
    { name: "battery_category", label: "Battery category (EV, LMT, industrial, SLI, portable)", type: "code" },
    { name: "battery_chemistry", label: "Battery chemistry (e.g. NMC811, LFP, NCA)", type: "code" },
    q("battery_mass_kg", "Battery mass", "kg", ["nominal", "maximum"]),
    { name: "critical_raw_materials", label: "Critical raw materials present", type: "text" },
    { name: "hazardous_substances", label: "Hazardous substances", type: "text" },
    q("rated_capacity_ah", "Rated capacity", "Ah", ["rated", "nominal", "minimum", "typical"]),
    q("nominal_voltage_v", "Nominal voltage", "V", ["nominal"]),
    q("minimum_voltage_v", "Minimum voltage", "V", ["minimum"]),
    q("maximum_voltage_v", "Maximum voltage", "V", ["maximum"]),
    q("original_power_capability_w", "Original power capability", "W", ["nominal", "maximum", "typical"]),
    q("initial_round_trip_efficiency_percent", "Initial round-trip energy efficiency", "%", ["nominal", "typical", "minimum"]),
    q("initial_internal_resistance_ohm", "Initial internal resistance (pack)", "ohm", ["nominal", "typical", "maximum"]),
    q("expected_lifetime_cycles", "Expected lifetime", "cycles", ["nominal", "minimum", "typical"]),
    q("idle_temperature_lower_c", "Idle temperature range, lower limit", "°C", ["minimum"]),
    q("idle_temperature_upper_c", "Idle temperature range, upper limit", "°C", ["maximum"]),
    q("carbon_footprint_functional_unit", "Carbon footprint per kWh", "kg CO2e/kWh", undefined, true),
    q("recycled_content_cobalt", "Recycled cobalt share (pre + post consumer)", "%", ["minimum"], true),
    q("recycled_content_lithium", "Recycled lithium share (pre + post consumer)", "%", ["minimum"], true),
    q("recycled_content_nickel", "Recycled nickel share (pre + post consumer)", "%", ["minimum"], true),
    q("recycled_content_lead", "Recycled lead share (pre + post consumer)", "%", ["minimum"], true),
  ],
};

export const textile: Template = {
  name: "textile",
  label: "Textile",
  fields: [
    { name: "product_name", label: "Product / article name", type: "text" },
    { name: "gtin", label: "GTIN / article number", type: "code" },
    { name: "manufacturer_name", label: "Manufacturer name and address", type: "text" },
    { name: "country_of_manufacture", label: "Country of manufacture (ISO 3166 alpha-2)", type: "code" },
    { name: "production_date", label: "Production / issue date (YYYY-MM or YYYY-MM-DD)", type: "date" },
    { name: "product_category", label: "Product category (e.g. T-shirt, denim trousers)", type: "text" },
    {
      name: "fibre_composition",
      label: "Fibre composition, { fibre: percent by mass }, adding up to 100",
      type: "composition",
      unit: "%",
      highStake: true,
    },
    q("recycled_content_percent", "Recycled content share of total mass", "%", ["minimum"], true),
    { name: "recycled_fibre_type", label: "Recycled fibre and source (pre/post-consumer)", type: "text" },
    q("carbon_footprint", "Carbon footprint per item", "kg CO2e", undefined, true),
    q("water_usage", "Water usage per item", "L"),
    q("fabric_weight", "Fabric weight", "g/m2", ["nominal", "typical"]),
    { name: "certification_scheme", label: "Certification scheme (GRS, OEKO-TEX 100, GOTS, bluesign)", type: "code" },
    { name: "certificate_number", label: "Certificate / licence number", type: "code" },
    { name: "certificate_valid_until", label: "Certificate expiry date (YYYY-MM-DD)", type: "date" },
    { name: "chemical_compliance", label: "Chemical compliance declaration (REACH SVHC, OEKO-TEX)", type: "text" },
    { name: "care_instructions", label: "Care instructions", type: "text" },
    { name: "durability_rating", label: "Durability rating / test result (e.g. pilling grade, Martindale cycles)", type: "text" },
  ],
};

export const templates: Record<string, Template> = { battery, textile };
