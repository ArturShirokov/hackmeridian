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

export const templates: Record<string, Template> = { battery };
