// The JSON contract between the Job Board (web.ts) and the front end (web/). Types only: web/ imports this file.
// Sieve independence: while any Pipeline for a Document is still extracting, no value, quote, rect, differs or export is served.
import type { SieveKind } from "./pipelines.js";
import type { FieldType } from "./templates.js";

export type { SieveKind, FieldType };

/** USDC decimal string, as in ledger.ts ("10", "2.5"). */
export type Usdc = string;
/** Milliseconds since the epoch. */
export type Ms = number;

/** GET /api/config */
export interface ApiConfig {
  /** Server clock, for the countdown offset. */
  now: Ms;
  baseUrl: string;
  challengeWindowMs: number;
  /** What a challenger locks to file a Challenge. */
  challengeDeposit: Usdc;
  /** What the Arbiter earns for an upheld Challenge, out of the Slash (at most the Slash). */
  arbiterFee: Usdc;
  brand: { name: string; reviewer: string };
  operators: { pipeline: string; label: string; operator: string; bond: Usdc; fee: Usdc; sieves: { kind: SieveKind; label: string }[] }[];
}

/** GET /api/templates */
export interface ApiTemplate {
  name: string;
  label: string;
  fields: { name: string; label: string; type: FieldType; unit?: string; qualifiers?: string[]; highStake?: boolean }[];
  /** Three example Field labels for the Upload card. */
  examples: string[];
}

/** processing: not delivered yet. delivered: Challenge Window open. awaiting arbiter: window shut, a Challenge undecided. */
export type DocStatus = "processing" | "delivered" | "awaiting arbiter" | "settled";

/** GET /api/documents (newest first) */
export interface ApiDocumentSummary {
  id: string;
  /** The uploaded file name. */
  name: string;
  supplier: string;
  template: string;
  pages: number;
  uploadedAt: Ms;
  pipelines: Record<string, { status: DocStatus; closesAt?: Ms; counts: { final: number; converging: number; notStated: number } }>;
}

/** Fractions of page width/height, top-left origin. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A quote on a page; rects are empty when it can't be found (or the page is a scan). mark: the value's words within the quote. */
export interface ApiQuote {
  page: number;
  quote: string;
  rects: Rect[];
  mark?: string;
}

export type ApiField = { name: string; label: string; tieBreak: boolean; challenge?: ApiChallengeSummary } & (
  /** Includes Sieves disagreeing: never any values while converging. */
  | { status: "converging" }
  | {
      status: "final";
      value: number | string | Record<string, number>;
      unit?: string;
      qualifier?: string;
      /** "220 Ah (rated)" */
      display: string;
      evidence: ApiQuote;
      /** Set when an upheld Challenge replaced the delivered value; `was` is the delivered display ("Not stated" if none). */
      corrected?: { was: string };
    }
  | { status: "not stated"; quotes: ApiQuote[]; supplierRequest: string }
  /** The status is known but its value is held back while another Sieve for this Document is still extracting. */
  | { status: "final" | "not stated"; withheld: true }
);

/** One station per Sieve of a Pipeline. meta is counts only, never values. */
export interface ApiStation {
  index: number;
  kind: SieveKind;
  label: string;
  state: "wait" | "run" | "done" | "fail";
  worker?: string;
  postedAt?: Ms;
  takenAt?: Ms;
  doneAt?: Ms;
  /** How many Jobs have been posted for this Sieve (a rerun makes 2). */
  attempt: number;
  meta: string;
}

export interface ApiEscrow {
  operator: string;
  bond: Usdc;
  /** Bond minus the Slashes of upheld Challenges so far. */
  bondLeft: Usdc;
  fee: Usdc;
  outputHash: string;
  status: DocStatus;
  openedAt: Ms;
  closesAt: Ms;
  /** Upheld Challenges so far (Slashes are paid at settlement). */
  upheld: number;
  slashes?: Usdc[];
  link?: string;
  settlementLink?: string;
}

export interface ApiPipelineView {
  pipeline: string;
  label: string;
  operator: string;
  stations: ApiStation[];
  deliveredAt?: Ms;
  escrow?: ApiEscrow;
  fields: ApiField[];
}

/** GET /api/documents/:id */
export interface ApiDocument extends ApiDocumentSummary {
  /** GET this for the PDF. */
  fileUrl: string;
  storageLink?: string;
  /** In Pipeline order. */
  views: ApiPipelineView[];
  /** Field names whose delivered canonical values differ between Pipelines (empty until all delivered). */
  differs: string[];
}

export interface ApiChallengeSummary {
  id: string;
  status: "filed" | "upheld" | "rejected";
  /** The claimed value, displayed. */
  value: string;
  page: number;
  quote: string;
}

export interface ApiChallenge extends ApiChallengeSummary {
  documentId: string;
  documentName: string;
  supplier: string;
  brand: string;
  pipeline: string;
  operatorLabel: string;
  field: string;
  fieldLabel: string;
  /** How the Template compares values of this Field's type. */
  rule: string;
  filedAt: Ms;
  decidedAt?: Ms;
  note?: string;
  /** When the Challenge Window of the escrow closes. */
  closesAt: Ms;
  delivered: { display: string; evidence?: ApiQuote };
  claim: { display: string; evidence: ApiQuote };
  /** Paid to the Brand at settlement if upheld, less the Arbiter Fee. */
  slash: Usdc;
  /** Who filed it: "brand", or the challenger's Stellar address. */
  challenger: string;
  /** The Challenge Deposit it locked: back to the challenger if upheld, to the Arbiter if rejected. */
  deposit: Usdc;
  /** Once decided: what the Arbiter earns for it (the Deposit if rejected, the Arbiter Fee if upheld). */
  arbiterFee?: Usdc;
}

/** GET /api/challenges */
export interface ApiArbiter {
  open: ApiChallenge[];
  decided: ApiChallenge[];
  /** earned: the Arbiter's fees from every decision, paid at settlement. */
  record: { decided: number; upheld: number; rejected: number; earned: Usdc };
}

/** GET /api/leaderboard */
export interface ApiLeaderRow {
  operator: string;
  label: string;
  sieves: number;
  documents: number;
  fieldsDelivered: number;
  challengesUpheld: number;
  totalSlashed: Usdc;
  bondsLocked: Usdc;
  /** Scored against the hand-checked test set; only in DEMO_REPLAY mode. */
  accuracy?: { correct: number; fields: number };
  link?: string;
  /** Bond left per delivered Document, in upload order. */
  series: { documentId: string; short: string; balance: Usdc }[];
}

export type JobStatus = "open" | "taken" | "done" | "timed out";

/** GET /api/jobs?limit=50 (newest first). A timed-out take is its own row. Metadata only. */
export interface ApiJob {
  id: string;
  documentId: string;
  documentName: string;
  pipeline: string;
  /** The Sieve label. */
  sieve: string;
  worker?: string;
  status: JobStatus;
  postedAt: Ms;
  takenAt?: Ms;
  doneAt?: Ms;
}

/** GET /api/workers. live: seen within 60 s. */
export interface ApiWorker {
  name: string;
  lastSeen: Ms;
  live: boolean;
  current?: { jobId: string; sieve: string; documentName: string };
  doneToday: number;
}

/** GET /api/documents/:id/export?pipeline=: the testdata/expected/*.json shape, corrections applied. */
export interface ApiExport {
  template: string;
  documentId: string;
  pipeline: string;
  operator: string;
  outputHash: string;
  fields: Record<string, { value: number | string | Record<string, number>; unit?: string; qualifier?: string; page: number; quote: string } | "Not stated">;
}

/** Routes:
 * GET  /api/config → ApiConfig            GET /api/templates → ApiTemplate[]
 * GET  /api/documents → ApiDocumentSummary[]
 * POST /api/documents (multipart file, template, supplier) → 201 { id } | 400 { error }
 * GET  /api/documents/:id → ApiDocument    GET /documents/:id/file → the PDF
 * GET  /api/documents/:id/export?pipeline= → ApiExport as an attachment | 409 before delivery
 * POST /api/documents/:id/challenges { pipeline, field, page, quote, value, unit?, qualifier?, challenger?, depositXdr? } → 201 { id }
 *      | 400/404/409 { error } | 402 { error } when the Challenge Deposit is not locked. challenger defaults to the Brand
 *      (the Job Board signs its Deposit); any other challenger is a Stellar address and signs its own:
 * POST /api/documents/:id/challenges/deposit { pipeline, challenger } → { xdr, amount }: sign xdr, pass it as depositXdr
 * GET  /api/challenges → ApiArbiter        POST /api/challenges/:id { decision: "upheld"|"rejected", note? } → 200 | 400/404/409
 * GET  /api/leaderboard → ApiLeaderRow[]   GET /api/jobs?limit=50 → ApiJob[]   GET /api/workers → ApiWorker[]
 */
export type ApiError = { error: string };
