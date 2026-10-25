// Fixture responses for every route in src/api.ts, used only when built with VITE_FIXTURES=1.
// doc-1 is delivered (battery-01, Window open, one Baseline Field Challenged); doc-2 is still processing.
import { templates } from "../../src/templates.ts";
import type {
  ApiArbiter, ApiChallenge, ApiConfig, ApiDocument, ApiDocumentSummary, ApiField, ApiJob, ApiLeaderRow, ApiQuote,
  ApiStation, ApiTemplate, ApiWorker, Rect,
} from "../../src/api.ts";

const t0 = Date.now();
const min = 60_000;
const windowMs = 180 * min;

const config: ApiConfig = {
  now: t0,
  baseUrl: "http://127.0.0.1:3000",
  challengeWindowMs: windowMs,
  brand: { name: "Voltaris", reviewer: "Inês Duarte" },
  operators: [
    {
      pipeline: "ours", label: "Origyn Pipeline", operator: "Origyn", bond: "50", fee: "5",
      sieves: [
        { kind: "extract", label: "Original" }, { kind: "markdown", label: "Markdown" }, { kind: "faithfulness", label: "Faithfulness check" },
        { kind: "extract", label: "Markdown extraction" }, { kind: "tiebreak", label: "Tie-break" },
      ],
    },
    { pipeline: "baseline", label: "Baseline", operator: "Baseline", bond: "50", fee: "5", sieves: [{ kind: "extract", label: "One-pass extraction" }] },
  ],
};

const examples: Record<string, string[]> = {
  battery: ["Rated capacity · Ah", "Recycled cobalt · %", "Carbon footprint · kg CO2e/kWh"],
  textile: ["Fibre composition · %", "Certificate number", "Country of manufacture"],
};
const templateList: ApiTemplate[] = Object.values(templates).map((t) => ({
  name: t.name, label: t.label, fields: t.fields.map((f) => ({ ...f, qualifiers: f.qualifiers, highStake: f.highStake })), examples: examples[t.name] ?? [],
}));

const q = (page: number, quote: string, rect?: Rect, mark?: string): ApiQuote => ({ page, quote, rects: rect ? [rect] : [], ...(mark && { mark }) });
const r = (x: number, y: number, w: number, h = 0.011): Rect => ({ x, y, w, h });
const final = (name: string, label: string, display: string, value: number | string, evidence: ApiQuote, extra: Partial<ApiField> = {}): ApiField =>
  ({ name, label, tieBreak: false, status: "final", value, display, evidence, ...extra }) as ApiField;

const ours: ApiField[] = [
  final("name", "Battery model name", "Voltaris NMC-800 EV Battery Pack", "Voltaris NMC-800 EV Battery Pack", q(1, "Voltaris NMC-800 EV Battery Pack", r(0.084, 0.086, 0.381, 0.017))),
  final("battery_identifier", "Battery identifier", "BAT-EU-2027-000214", "BAT-EU-2027-000214", q(1, "Battery identifier BAT-EU-2027-000214", r(0.084, 0.169, 0.41), "BAT-EU-2027-000214")),
  final("manufacturing_place", "Place of manufacture", "Komorniki, Poland", "Komorniki, Poland", q(1, "Place of manufacture Komorniki, Poland", r(0.084, 0.245, 0.382), "Komorniki, Poland")),
  final("manufacturing_date", "Date of manufacture", "2027-02", "2027-02", q(1, "Date of manufacture February 2027", r(0.084, 0.264, 0.356), "February 2027")),
  final("rated_capacity_ah", "Rated capacity", "220 Ah (rated)", 220, q(1, "Rated capacity 220 Ah", r(0.084, 0.319, 0.471), "220 Ah"), { unit: "Ah", qualifier: "rated", tieBreak: true }),
  final("nominal_voltage_v", "Nominal voltage", "360 V (nominal)", 360, q(1, "Nominal voltage 360 V", r(0.084, 0.338, 0.462), "360 V"), { unit: "V", qualifier: "nominal" }),
  final("expected_lifetime_cycles", "Expected lifetime", "2500 cycles (nominal)", 2500,
    q(1, "Expected lifetime (nominal) 2500 cycles (IEC 62660-1, 25 °C, 1C/1C, 100% DoD)", r(0.084, 0.452, 0.798), "2500 cycles"), { unit: "cycles", qualifier: "nominal" }),
  final("battery_mass_kg", "Battery mass", "482 kg (nominal)", 482, q(1, "Nominal mass 482 kg", r(0.084, 0.507, 0.468), "482 kg"), { unit: "kg", qualifier: "nominal" }),
  {
    name: "initial_internal_resistance_ohm", label: "Initial internal resistance (pack)", tieBreak: true, status: "not stated",
    quotes: [q(1, "Initial internal resistance (nominal) cell 0.0012 ohm, pack 0.135 ohm", r(0.084, 0.433, 0.655))],
    supplierRequest: "Hello Voltaris Mobility team,\n\nFor the Voltaris NMC-800 EV Battery Pack we need one value for our EU battery passport:\n\nInitial internal resistance of the pack (ohm), with the document and page that states it.\n\nThank you,\nInês Duarte\nVoltaris",
  },
  final("battery_chemistry", "Battery chemistry", "NMC811", "NMC811", q(2, "Lithium nickel manganese cobalt oxide (NMC 811), graphite anode", r(0.336, 0.069, 0.472), "NMC 811")),
  final("carbon_footprint_functional_unit", "Carbon footprint per kWh", "41.8 kg CO2e/kWh", 41.8,
    q(2, "Life-cycle carbon footprint per kWh of total energy over the service life: 41.8 kg CO2e/kWh", r(0.084, 0.181, 0.672, 0.012), "41.8 kg CO2e/kWh"), { unit: "kg CO2e/kWh", tieBreak: true }),
  final("recycled_content_cobalt", "Recycled cobalt share", "22 %", 22, q(2, "Cobalt 22 %", r(0.084, 0.274, 0.288), "22 %"), { unit: "%" }),
];

const baseline: ApiField[] = ours.map((f) => {
  const b = { ...f, tieBreak: false } as ApiField;
  if (f.name === "rated_capacity_ah")
    return final(f.name, f.label, "80 Ah", 80, q(1, "80 kWh lithium-ion traction battery pack for mid-size electric passenger vehicles.", r(0.084, 0.114, 0.597, 0.012), "80"), {
      unit: "Ah", challenge: { id: "ch-1", status: "filed", value: "220 Ah (rated)", page: 1, quote: "Rated capacity 220 Ah" },
    });
  if (f.name === "initial_internal_resistance_ohm")
    return final(f.name, f.label, "0.0012 ohm", 0.0012, q(1, "cell 0.0012 ohm, pack 0.135 ohm", r(0.504, 0.433, 0.235), "0.0012 ohm"), { unit: "ohm" });
  return b;
});

const station = (index: number, kind: ApiStation["kind"], label: string, state: ApiStation["state"], meta: string, worker?: string): ApiStation =>
  ({ index, kind, label, state, meta, attempt: 1, ...(worker && { worker }), postedAt: t0 - 9 * min, ...(state !== "wait" && { takenAt: t0 - 8 * min }), ...(state === "done" && { doneAt: t0 - 7 * min }) });

const escrow = (operator: string, upheld: number, hash: string) => ({
  operator, bond: "50", bondLeft: String(50 - upheld * 5), fee: "5", outputHash: hash, status: "delivered" as const,
  openedAt: t0 - 2 * min, closesAt: t0 - 2 * min + windowMs, upheld, link: "https://stellar.expert/explorer/testnet",
});

const counts = (fs: ApiField[]) => ({
  final: fs.filter((f) => f.status === "final").length,
  converging: fs.filter((f) => f.status === "converging").length,
  notStated: fs.filter((f) => f.status === "not stated").length,
});

const doc1: ApiDocument = {
  id: "doc-1", name: "battery-01-voltaris-pack-spec.pdf", supplier: "Voltaris Mobility", template: "battery", pages: 2, uploadedAt: t0 - 10 * min,
  pipelines: {
    ours: { status: "delivered", closesAt: t0 - 2 * min + windowMs, counts: counts(ours) },
    baseline: { status: "delivered", closesAt: t0 - 2 * min + windowMs, counts: counts(baseline) },
  },
  fileUrl: "/fixtures/battery-01-voltaris-pack-spec.pdf",
  views: [
    {
      pipeline: "ours", label: "Origyn Pipeline", operator: "Origyn", deliveredAt: t0 - 2 * min, fields: ours,
      escrow: escrow("Origyn", 0, "e4b1c0ffee00000000000000000000000000000000000000000000000090af"),
      stations: [
        station(0, "extract", "Original", "done", "12 values stated", "Claude Code"),
        station(1, "markdown", "Markdown", "done", "2 pages · 1 table", "OpenCode"),
        station(2, "faithfulness", "Faithfulness check", "done", "pass", "Pi"),
        station(3, "extract", "Markdown extraction", "done", "12 values · 9 agree", "Claude Code"),
        station(4, "tiebreak", "Tie-break", "done", "2 resolved · 1 Not stated", "Pi"),
      ],
    },
    {
      pipeline: "baseline", label: "Baseline", operator: "Baseline", deliveredAt: t0 - 6 * min, fields: baseline,
      escrow: escrow("Baseline", 0, "7c02beef00000000000000000000000000000000000000000000000000e91b"),
      stations: [station(0, "extract", "One-pass extraction", "done", "12 values stated", "OpenCode")],
    },
  ],
  differs: ["rated_capacity_ah", "initial_internal_resistance_ohm"],
};

const converging = (f: ApiField, i: number): ApiField =>
  i < 3 ? { name: f.name, label: f.label, tieBreak: false, status: "final", withheld: true } : { name: f.name, label: f.label, tieBreak: i % 4 === 0, status: "converging" };
const doc2Ours = ours.map(converging);
const doc2Base = ours.map((f) => ({ name: f.name, label: f.label, tieBreak: false, status: "final", withheld: true }) as ApiField);
const doc2: ApiDocument = {
  id: "doc-2", name: "battery-02-kestrel-18650-cell-datasheet.pdf", supplier: "Kestrel Cells", template: "battery", pages: 2, uploadedAt: t0 - 3 * min,
  pipelines: { ours: { status: "processing", counts: counts(doc2Ours) }, baseline: { status: "processing", counts: counts(doc2Base) } },
  fileUrl: "/fixtures/battery-02-kestrel-18650-cell-datasheet.pdf",
  views: [
    {
      pipeline: "ours", label: "Origyn Pipeline", operator: "Origyn", fields: doc2Ours,
      stations: [
        station(0, "extract", "Original", "done", "11 values stated", "Claude Code"),
        station(1, "markdown", "Markdown", "done", "2 pages · 2 tables", "OpenCode"),
        station(2, "faithfulness", "Faithfulness check", "run", "working…", "Pi"),
        station(3, "extract", "Markdown extraction", "wait", "—"),
        station(4, "tiebreak", "Tie-break", "wait", "—"),
      ],
    },
    {
      pipeline: "baseline", label: "Baseline", operator: "Baseline", fields: doc2Base,
      stations: [station(0, "extract", "One-pass extraction", "done", "12 values stated", "OpenCode")],
    },
  ],
  differs: [],
};

const docs = [doc2, doc1];
const summary = ({ fileUrl, storageLink, views, differs, ...s }: ApiDocument): ApiDocumentSummary => s;

const challenge: ApiChallenge = {
  id: "ch-1", status: "filed", value: "220 Ah (rated)", page: 1, quote: "Rated capacity 220 Ah",
  documentId: "doc-1", documentName: doc1.name, supplier: doc1.supplier, brand: "Voltaris", pipeline: "baseline", operatorLabel: "Baseline",
  field: "rated_capacity_ah", fieldLabel: "Rated capacity", rule: "Quantity: same unit after conversion, same qualifier, no tolerance.",
  filedAt: t0 - 1 * min, closesAt: t0 - 2 * min + windowMs,
  delivered: { display: "80 Ah", evidence: (baseline[4] as Extract<ApiField, { evidence: ApiQuote }>).evidence },
  claim: { display: "220 Ah (rated)", evidence: q(1, "Rated capacity 220 Ah", r(0.084, 0.319, 0.471), "220 Ah") },
  slash: "5",
};
const arbiter: ApiArbiter = { open: [challenge], decided: [], record: { decided: 0, upheld: 0, rejected: 0 } };

const leaderboard: ApiLeaderRow[] = [
  {
    operator: "Origyn", label: "Origyn Pipeline", sieves: 5, documents: 1, fieldsDelivered: 25, challengesUpheld: 0, totalSlashed: "0", bondsLocked: "50",
    accuracy: { correct: 146, fields: 150 }, link: "https://stellar.expert/explorer/testnet", series: [{ documentId: "doc-1", short: "Voltaris pack", balance: "50" }],
  },
  {
    operator: "Baseline", label: "Baseline", sieves: 1, documents: 1, fieldsDelivered: 25, challengesUpheld: 0, totalSlashed: "0", bondsLocked: "50",
    accuracy: { correct: 127, fields: 150 }, link: "https://stellar.expert/explorer/testnet", series: [{ documentId: "doc-1", short: "Voltaris pack", balance: "50" }],
  },
];

const job = (id: string, d: ApiDocument, pipeline: string, sieve: string, status: ApiJob["status"], worker?: string, ago = 5): ApiJob => ({
  id, documentId: d.id, documentName: d.name, pipeline, sieve, status, postedAt: t0 - ago * min, ...(worker && { worker, takenAt: t0 - (ago - 1) * min }),
  ...(status === "done" && { doneAt: t0 - (ago - 2) * min }),
});
const jobs: ApiJob[] = [
  job("j-9", doc2, "ours", "Faithfulness check", "taken", "Pi", 2),
  job("j-8", doc2, "ours", "Markdown", "done", "OpenCode", 3),
  job("j-7", doc2, "baseline", "One-pass extraction", "done", "OpenCode", 3),
  job("j-6", doc2, "ours", "Original", "timed out", "Claude Code", 4),
  job("j-5", doc2, "ours", "Original", "done", "Claude Code", 3),
  job("j-4", doc1, "ours", "Tie-break", "done", "Pi", 4),
  job("j-3", doc1, "ours", "Markdown extraction", "done", "Claude Code", 6),
  job("j-2", doc1, "ours", "Faithfulness check", "done", "Pi", 7),
  job("j-1", doc1, "baseline", "One-pass extraction", "done", "OpenCode", 9),
];
const workers: ApiWorker[] = [
  { name: "Claude Code", lastSeen: t0, live: true, doneToday: 4 },
  { name: "OpenCode", lastSeen: t0, live: true, doneToday: 3 },
  { name: "Pi", lastSeen: t0, live: true, current: { jobId: "j-9", sieve: "Faithfulness check", documentName: doc2.name }, doneToday: 2 },
];

/** The fixture answer for a request to `path`. Writes succeed and change nothing. */
export function respond(path: string, init?: RequestInit): unknown {
  const p = path.split("?")[0]!;
  if (init?.method === "POST") return p.endsWith("/challenges") ? { id: "ch-new" } : { ok: true };
  const doc = p.match(/^\/api\/documents\/([^/]+)$/);
  if (doc) return docs.find((d) => d.id === doc[1]) ?? docs[1];
  const routes: Record<string, unknown> = {
    "/api/config": { ...config, now: Date.now() },
    "/api/templates": templateList,
    "/api/documents": docs.map(summary),
    "/api/challenges": arbiter,
    "/api/leaderboard": leaderboard,
    "/api/jobs": jobs,
    "/api/workers": workers,
  };
  if (!(p in routes)) throw new Error(`no fixture for ${path}`);
  return routes[p];
}

export async function fakeUpload(onProgress?: (f: number) => void) {
  for (let i = 1; i <= 10; i++) {
    await new Promise((res) => setTimeout(res, 80));
    onProgress?.(i / 10);
  }
  return { id: "doc-2" };
}
