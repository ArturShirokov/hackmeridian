import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { entryName, IcpStorage, parseEntryName } from "../src/storage/icp.js";
import { fakeCanister, makePdf, startBoard } from "./seam.js";

const sha = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const sha16 = sha.slice(0, 16);

describe("ICP entry names", () => {
  it("carry the hash, Template, uploader, supplier and file name, and read back", () => {
    const meta = { hash: sha, template: "battery", uploader: "brand", supplier: "Kestrel Cells", name: "Cell datasheet v2.pdf" };
    const name = entryName(meta);
    expect(name).toBe(`${sha16}.battery.brand.Kestrel_Cells.Cell_datasheet_v2.pdf`);
    expect(parseEntryName(name)).toEqual({ ...meta, hash: sha16 });
  });

  it("replace characters the URL path can't hold", () => {
    const name = entryName({ hash: sha, template: "battery", uploader: "brand", supplier: "Ünïon/Cells.Ltd", name: "a_b?.PDF" });
    expect(name).toBe(`${sha16}.battery.brand.-n-on-Cells-Ltd.a-b-.pdf`);
    expect(parseEntryName(name)).toMatchObject({ supplier: "-n-on-Cells-Ltd", name: "a-b-.pdf" });
  });

  it("fit the canister's 120 characters by shortening the file name", () => {
    const name = entryName({ hash: sha, template: "battery", uploader: "brand", supplier: "Voltaris", name: `${"x".repeat(200)}.pdf` });
    expect(name).toBe(`${sha16}.battery.brand.Voltaris.${"x".repeat(120 - 44)}.pdf`);
  });

  it("ignore files that are not ours", () => {
    expect(parseEntryName("screenshot_2026_10_25_task.png")).toBeUndefined();
  });
});

describe("ICP Storage", () => {
  it("stores a Brand upload on ICP and hands Workers the public ICP URL", async () => {
    const canister = fakeCanister();
    const { brand, worker } = startBoard({ storage: canister.storage() });
    const pdf = await makePdf([["Nominal voltage 3.6 V"]]);
    const id = await brand.upload(pdf, "battery", { name: "pack spec.pdf", supplier: "Voltaris" });

    const hash = createHash("sha256").update(pdf).digest("hex").slice(0, 16);
    const link = `https://files.test/tasks/7/${hash}.battery.brand.Voltaris.pack_spec.pdf`;
    expect(canister.files()).toEqual([expect.objectContaining({ entry_name: `${hash}.battery.brand.Voltaris.pack_spec.pdf`, url: link })]);
    expect((await brand.document(id)).storageLink).toBe(link);
    expect((await (await worker("w")).nextJob())!.document.url).toBe(link);
    // The board still serves the file itself, for the PDF viewer.
    expect((await brand.page(`/documents/${id}/file`)).status).toBe(200);
  });

  it("uploads in 1 MiB chunks and reads the bytes back by URL", async () => {
    const canister = fakeCanister();
    const storage = canister.storage();
    const bytes = new Uint8Array(2.5 * 1024 * 1024).map((_, i) => i % 251);
    const meta = await storage.put(bytes, { template: "battery", uploader: "brand", name: "big.pdf", supplier: "S" });
    expect(canister.chunks()).toBe(3);
    const got = await storage.get(meta.id);
    expect(got?.bytes).toEqual(bytes);
    expect(got?.meta).toEqual(meta);
  });

  it("refuses bytes that don't match the hash", async () => {
    const canister = fakeCanister();
    const storage = canister.storage();
    const meta = await storage.put(new Uint8Array([1, 2, 3]), { template: "battery", uploader: "brand", name: "x.pdf", supplier: "S" });
    canister.tamper(meta.link!);
    await expect(storage.get(meta.id)).rejects.toThrow(/hash/);
  });

  it("lists Documents added at or after a time, so the Job Board's poll picks up other uploaders' files", async () => {
    const canister = fakeCanister();
    const { brand, poll } = startBoard({ storage: canister.storage() });
    const pdf = await makePdf([["Rated capacity 50 Ah"]]);
    canister.addForeign("screenshot.png", new Uint8Array([0]));
    await canister.storage().put(pdf, { template: "battery", uploader: "brand", name: "other.pdf", supplier: "Helion" });
    await poll();
    expect((await brand.documents()).map((d) => [d.name, d.supplier])).toEqual([["other.pdf", "Helion"]]);
    expect(await canister.storage().listSince(new Date(Date.now() + 60_000))).toEqual([]);
  });
});
