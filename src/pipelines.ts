// Pipeline configuration as data: each Pipeline is an ordered list of Sieves.
export type SieveKind = "extract";
export type View = "original";

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

export const baseline: Pipeline = {
  name: "baseline",
  sieves: [{ kind: "extract", view: "original", instructions: extractFromOriginal }],
};

/** Our Pipeline. Sieves run in order, each Job posted when the previous Sieve is handed in. */
export const ours: Pipeline = {
  name: "ours",
  sieves: [
    { kind: "extract", view: "original", instructions: extractFromOriginal },
    { kind: "extract", view: "original", instructions: extractFromOriginal }, // #9 switches this to the checked Markdown
  ],
};
