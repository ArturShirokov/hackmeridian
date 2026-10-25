// Convergence: normalise each extraction Sieve's value per Field type, check its quote, and compare.
import type { FieldValue } from "./board.js";
import type { Field, Template } from "./templates.js";

export type FieldStatus = "converging" | "final" | "disagreeing" | "not stated";
export type Quote = { page: number; quote: string };
export type FieldResult =
  | (FieldValue & { status: "final" })
  | { field: string; status: "disagreeing" }
  /** Still split after the tie-break: every competing quote, for the Supplier Request. */
  | { field: string; status: "not stated"; notStated: true; quotes: Quote[] };

/** Factor from each accepted unit to the canonical one, keyed by spelling() of the canonical unit. */
const units: Record<string, Record<string, number>> = {
  Ah: { Ah: 1, mAh: 0.001 },
  Wh: { Wh: 1, kWh: 1000, mWh: 0.001 },
  V: { V: 1, mV: 0.001, kV: 1000 },
  W: { W: 1, kW: 1000 },
  kg: { kg: 1, g: 0.001, t: 1000 },
  ohm: { ohm: 1, mohm: 0.001 },
  "%": { "%": 1 },
  cycles: { cycles: 1, cycle: 1 },
  "°C": { "°C": 1 },
  "kgCO2e/kWh": { "kgCO2e/kWh": 1, "gCO2e/kWh": 0.001, "kgCO2e/MWh": 0.001 },
  kgCO2e: { kgCO2e: 1, gCO2e: 0.001 },
  "g/m2": { "g/m2": 1, gsm: 1 },
  L: { L: 1, m3: 1000 },
};

/** One spelling per unit: no spaces, CO₂-eq as CO2e, Ω as ohm, degrees as °C. Case is kept (mWh is not MWh). */
const spelling = (u: string) =>
  u
    .replace(/\s+/g, "")
    .replace(/₂/g, "2")
    .replace(/CO2-?eq?/gi, "CO2e")
    .replace(/Ω/g, "ohm")
    .replace(/^(º|deg)?C$/, "°C")
    .replace(/^m²$/, "m2")
    .replace(/\/m²$/, "/m2");

/** Canonical codes, looked up by the code upper-cased without spaces, hyphens or underscores. */
const codes: Record<string, string> = {
  LFP: "LFP", LIFEPO4: "LFP", NCA: "NCA", LMO: "LMO", LCO: "LCO", LTO: "LTO",
  NAION: "Na-ion", SODIUMION: "Na-ion", PBACID: "Pb-acid", LEADACID: "Pb-acid", NIMH: "NiMH",
  EV: "EV", LMT: "LMT", SLI: "SLI", INDUSTRIAL: "industrial", PORTABLE: "portable",
};

function code(raw: string): string {
  const k = raw.toUpperCase().replace(/\s+/g, "");
  const bare = k.replace(/[-_]/g, "");
  const nmc = /^(NMC|NCM)(\d{3})?$/.exec(bare);
  return nmc ? `NMC${nmc[2] ?? ""}` : (codes[bare] ?? k);
}

const round = (x: number) => Number(x.toPrecision(12)); // float noise from unit factors, not a tolerance

/** The canonical value of one stated value, or undefined when it can't be normalised (counts as disagreement). */
function canonical(f: Field, v: Extract<FieldValue, { value: unknown }>): unknown {
  switch (f.type) {
    case "quantity": {
      const factor = units[spelling(f.unit!)]?.[spelling(v.unit ?? "")];
      return factor === undefined ? undefined : round((v.value as number) * factor);
    }
    case "code":
      return code(v.value as string);
    case "composition": {
      // ponytail: fibre names only case-folded; #11 adds the fibre alias map (PES -> polyester).
      const entries = Object.entries(v.value as Record<string, number>).map(([k, p]) => [k.trim().toLowerCase(), Math.round(p * 10) / 10] as const);
      const sum = Math.round(entries.reduce((s, [, p]) => s + p, 0) * 10) / 10;
      return sum === 100 ? Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b))) : undefined;
    }
    case "text":
      return (v.value as string).trim().toLowerCase();
    case "date":
      return (v.value as string).trim();
  }
}

const fold = (s: string) => s.replace(/\s+/g, " ").trim();

/** Comparison key of a value, or undefined when it can't converge (unnormalisable, or quote not in the text). */
function key(f: Field, v: FieldValue, text: string): string | undefined {
  if (!("value" in v)) return "not stated";
  // ponytail: a scan has no text layer, so every quote fails here; #9 checks against the checked Markdown instead.
  if (!text.includes(fold(v.quote))) return undefined;
  const c = canonical(f, v);
  return c === undefined ? undefined : JSON.stringify([c, v.qualifier ?? null]);
}

/** What the Brand sees once a value converged: quantities in the canonical unit, codes in canonical form. */
function shown(f: Field, v: FieldValue): FieldValue {
  if (!("value" in v)) return v;
  if (f.type === "quantity") return { ...v, value: canonical(f, v) as number, unit: f.unit! };
  if (f.type === "code") return { ...v, value: canonical(f, v) as string };
  return v;
}

/**
 * Converge the extraction Sieves' results (one FieldValue[] per Sieve, in Pipeline order) Field by Field.
 * A single Sieve (the Baseline) is delivered as is. The first two must agree, else the Field is disagreeing.
 * A third result is the tie-break and holds only the disagreeing Fields: a normal Field is final when it agrees
 * with either earlier value, a high-stake Field only when it agrees with both (never 2 of 3). Else Not stated.
 */
export function converge(template: Template, results: FieldValue[][], pages: string[]): FieldResult[] {
  const text = fold(pages.join(" "));
  return template.fields.map((f): FieldResult => {
    const values = results.map((r) => r.find((v) => v.field === f.name));
    if (values.length === 1) return { ...values[0]!, status: "final" };
    const [a, b, tie] = values as [FieldValue, FieldValue, FieldValue | undefined];
    const [ka, kb] = [key(f, a, text), key(f, b, text)];
    if (ka !== undefined && ka === kb) return { ...shown(f, a), status: "final" };
    if (values.length === 2) return { field: f.name, status: "disagreeing" };
    const kt = tie && key(f, tie, text);
    const agreed = kt !== undefined && (f.highStake ? kt === ka && kt === kb : kt === ka || kt === kb);
    if (agreed) return { ...shown(f, tie!), status: "final" };
    const quotes = values.flatMap((v) => (v && "quote" in v ? [{ page: v.page, quote: v.quote }] : []));
    return { field: f.name, status: "not stated", notStated: true, quotes };
  });
}
