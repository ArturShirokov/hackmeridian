// Pipeline configuration as data: each Pipeline is an ordered list of Sieves.
/** A tie-break is an extraction Sieve offered only for the Fields the earlier two left disagreeing. */
export type SieveKind = "extract" | "markdown" | "faithfulness" | "tiebreak";
/** original: the PDF and its text layer. markdown: the checked Markdown. mix: both, for checking one against the other. */
export type View = "original" | "markdown" | "mix";

export interface Sieve {
  kind: SieveKind;
  view: View;
  instructions: string;
}

export interface Pipeline {
  name: string;
  sieves: Sieve[];
}

const extractFromOriginal = `Read the Document (open document.url; document.text is its text layer, one string per page).
For every Field in template.fields, give exactly one entry in result.fields:
- { field, value, unit, qualifier, page, quote } when the Document clearly states it.
  value: a number for quantities, a string for codes, text and dates, { fibre: percent } for compositions.
  unit: the unit the Document uses. qualifier: only for quantities, one of the Field's qualifiers, using the word the Document uses.
  page: 1-based page number. quote: the exact words from that page that state the value.
- { field, notStated: true } when the Document does not clearly give it. Never guess.`;

const extractFromMarkdown = `Read document.markdown, a checked Markdown version of the Document. Do not open document.url.
${extractFromOriginal.split("\n").slice(1).join("\n")}
  page: from the <!-- page N --> marks in the Markdown. quote: the Document's words only, without Markdown syntax (| # * -).`;

const toMarkdown = `Open document.url and turn the whole Document into normalised Markdown.
Keep every fact, number, unit and qualifier exactly as written; tables become Markdown tables; start each page with <!-- page N -->.
Add nothing, summarise nothing, fix nothing. Hand in { markdown: "..." }.`;

const faithfulness = `Check document.markdown against the original (document.url, document.text) line by line.
Look for any value, unit, qualifier, name or table cell the Markdown drops, changes, moves to the wrong row or adds.
Hand in { pass: true } when it is faithful, or { pass: false, problems: ["..."] } naming each problem found.`;

export const baseline: Pipeline = {
  name: "baseline",
  sieves: [{ kind: "extract", view: "original", instructions: extractFromOriginal }],
};

/** Our Pipeline. Sieves run in order, each Job posted when the previous Sieve is handed in. */
export const ours: Pipeline = {
  name: "ours",
  sieves: [
    { kind: "extract", view: "original", instructions: extractFromOriginal },
    { kind: "markdown", view: "original", instructions: toMarkdown },
    // A fail reruns the Markdown Sieve before it, once.
    { kind: "faithfulness", view: "mix", instructions: faithfulness },
    { kind: "extract", view: "markdown", instructions: extractFromMarkdown },
    { kind: "tiebreak", view: "original", instructions: extractFromOriginal },
  ],
};
