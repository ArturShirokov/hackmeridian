// The public Documents (testdata/public): fetched, not committed. Each check is skipped when its PDF isn't downloaded
// (npx tsx scripts/fetch-public-testdata.ts from the repo root).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { checkExpected } from "./check.mjs";

const dir = new URL("../public/", import.meta.url);
const fields = JSON.parse(readFileSync(new URL("../fields.json", import.meta.url)));
const sources = JSON.parse(readFileSync(new URL("sources.json", dir)));

test("public: every source has an expected-values file and vice versa", () => {
  const expected = readdirSync(new URL("expected/", dir)).map((f) => f.replace(/\.json$/, ".pdf"));
  assert.deepEqual(expected.sort(), sources.map((s) => s.file).sort());
});

for (const { file } of sources) {
  const pdf = new URL(`documents/${file}`, dir);
  test(`public ${file}: every Template Field covered, every quote on its cited page`, { skip: !existsSync(pdf) && "PDF not downloaded" }, async () => {
    const expected = JSON.parse(readFileSync(new URL(`expected/${file.replace(/\.pdf$/, ".json")}`, dir)));
    assert.equal(expected.document, file);
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(readFileSync(pdf))), { mergePages: false });
    assert.deepEqual(checkExpected(expected, fields[expected.template], text), []);
  });
}
