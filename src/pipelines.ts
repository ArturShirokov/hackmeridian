// Pipeline configuration as data: each Pipeline is an ordered list of Sieves.
/** A tie-break is an extraction Sieve offered only for the Fields the earlier two left disagreeing. */
export type SieveKind = "extract" | "markdown" | "faithfulness" | "tiebreak";
/** original: the PDF and its text layer. markdown: the checked Markdown. mix: both, for checking one against the other. */
export type View = "original" | "markdown" | "mix";

export interface Sieve {
  kind: SieveKind;
  label: string;
  view: View;
  instructions: string;
}

export interface Pipeline {
  name: string;
  /** Shown to the Brand: "Origyn" (our Operator), "Baseline". */
  label?: string;
  sieves: Sieve[];
}

// One Job covers the whole Template (up to 60 Fields), so the rules are short and the answer is one list in one go.
const extractRules = `template.fields lists every Field (name, label, type, unit, qualifiers, hint), grouped by section.
Read the Document once, then hand in result.fields with exactly one entry per Field, in template order, in one submission:
- Stated: { field, value, unit, qualifier, page, quote }.
  value: a number for a quantity, { fibre: percent } for a composition, else a string (codes as the hint says, dates YYYY-MM).
  unit: the unit as printed (mAh, kW, g, m3, C for a C-rate: the Job Board converts it); if none is printed, the Field's unit.
  qualifier: only if the Field lists qualifiers and the Document uses one of those words; else leave it out.
  page: 1-based. quote: the shortest exact words from that page that hold the value; a table row reads its cells joined by spaces.
- Not stated: { field, notStated: true } when the Document does not clearly give this Field for this product.
  Most Documents state only some Fields, so Not stated is normal. Never guess, compute, or take a target, roadmap or example value.
If the submission is rejected, fix only the Fields the error names and submit again.`;

const extractFromOriginal = `Read the Document (open document.url; document.text is its text layer, one string per page).
${extractRules}`;

const extractFromMarkdown = `Read document.markdown, a checked Markdown version of the Document. Do not open document.url.
${extractRules}
page: from the <!-- page N --> marks. quote: the Document's words only, without Markdown syntax (| # * -).`;

const toMarkdown = `Open document.url and turn the whole Document into normalised Markdown.
Keep every fact, number, unit and qualifier exactly as written; tables become Markdown tables; start each page with <!-- page N -->.
Add nothing, summarise nothing, fix nothing. Hand in { markdown: "..." }.`;

const faithfulness = `Check document.markdown against the original (document.url, document.text) line by line.
Look for any value, unit, qualifier, name or table cell the Markdown drops, changes, moves to the wrong row or adds.
Hand in { pass: true } when it is faithful, or { pass: false, problems: ["..."] } naming each problem found.`;

export const baseline: Pipeline = {
  name: "baseline",
  label: "Baseline",
  sieves: [{ kind: "extract", label: "One-pass extraction", view: "original", instructions: extractFromOriginal }],
};

/** Our Pipeline. Sieves run in order, each Job posted when the previous Sieve is handed in. */
export const ours: Pipeline = {
  name: "ours",
  label: "Origyn",
  sieves: [
    { kind: "extract", label: "Original", view: "original", instructions: extractFromOriginal },
    { kind: "markdown", label: "Markdown", view: "original", instructions: toMarkdown },
    // A fail reruns the Markdown Sieve before it, once.
    { kind: "faithfulness", label: "Faithfulness check", view: "mix", instructions: faithfulness },
    { kind: "extract", label: "Markdown extraction", view: "markdown", instructions: extractFromMarkdown },
    { kind: "tiebreak", label: "Tie-break", view: "original", instructions: extractFromOriginal },
  ],
};
