// Download the public test Documents listed in testdata/public/sources.json into testdata/public/documents/ (gitignored)
// and check each against its sha256. We link to these PDFs, we don't redistribute them.
//   npx tsx scripts/fetch-public-testdata.ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = new URL("../testdata/public/", import.meta.url);
const out = new URL("documents/", dir);
const sources: { file: string; url: string; sha256: string }[] = JSON.parse(readFileSync(new URL("sources.json", dir), "utf8"));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
mkdirSync(out, { recursive: true });

const failures: string[] = [];
for (const s of sources) {
  const target = new URL(s.file, out);
  if (existsSync(target) && sha(readFileSync(target)) === s.sha256) {
    console.log(`ok (cached)  ${s.file}`);
    continue;
  }
  try {
    const res = await fetch(s.url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const got = sha(bytes);
    if (got !== s.sha256) throw new Error(`sha256 ${got.slice(0, 12)}…, want ${s.sha256.slice(0, 12)}… (the publisher changed or moved the file)`);
    writeFileSync(target, bytes);
    console.log(`ok           ${s.file}`);
  } catch (e) {
    failures.push(`${s.file}: ${(e as Error).message}  (${s.url})`);
  }
}
if (failures.length) {
  console.error(`\n${failures.length} of ${sources.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`\nAll ${sources.length} Documents in testdata/public/documents/.`);
