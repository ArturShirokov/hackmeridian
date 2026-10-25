// Live check of ICP Storage: uploads one testdata PDF, lists it, fetches it back by its public URL and checks the hash.
// Needs ICP_IDENTITY in .env (scripts/icp-identity.ts). Writes one public file to the Task.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { icpStorageFromEnv } from "../src/storage/icp.js";

const file = process.argv[2] ?? "battery-02-kestrel-18650-cell-datasheet.pdf";
const bytes = new Uint8Array(readFileSync(new URL(`../testdata/documents/${file}`, import.meta.url)));
const storage = await icpStorageFromEnv();
const before = new Date(Date.now() - 60_000);
const meta = await storage.put(bytes, { template: file.split("-")[0]!, uploader: "brand", name: file, supplier: "Smoke Test" });
console.log("put", meta.id, meta.link);
const listed = await storage.listSince(before);
if (!listed.some((m) => m.id === meta.id)) throw new Error("not listed");
const got = await storage.get(meta.id);
const hash = createHash("sha256").update(got!.bytes).digest("hex");
if (hash !== createHash("sha256").update(bytes).digest("hex")) throw new Error("hash mismatch");
console.log(`ok: listed (${listed.length} since ${before.toISOString()}), fetched ${got!.bytes.length} bytes, sha256 ${hash}`);
