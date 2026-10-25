import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { checkExpected } from "./check.mjs";

const dir = (p) => new URL(`../${p}/`, import.meta.url);
const fields = JSON.parse(readFileSync(new URL("../fields.json", import.meta.url)));
const pdfs = readdirSync(dir("documents")).filter((f) => f.endsWith(".pdf"));

test("every Document has an expected-values file and vice versa", () => {
  const expected = readdirSync(dir("expected")).map((f) => f.replace(/\.json$/, ".pdf"));
  assert.deepEqual(expected.sort(), pdfs.sort());
});

for (const pdf of pdfs) {
  test(`${pdf}: expected values cover every Template Field and every quote is in the Document`, async () => {
    const expected = JSON.parse(readFileSync(new URL(pdf.replace(/\.pdf$/, ".json"), dir("expected"))));
    assert.equal(expected.document, pdf);
    const doc = await getDocumentProxy(new Uint8Array(readFileSync(new URL(pdf, dir("documents")))));
    const { text } = await extractText(doc, { mergePages: false });
    assert.deepEqual(checkExpected(expected, fields[expected.template], text), []);
  });
}
