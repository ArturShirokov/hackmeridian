// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ApiDocumentSummary } from "../src/api.ts";
import { docRow, filterDocs, listTotals } from "../src/screens/brand/derive.ts";
import { DocumentsView } from "../src/screens/brand/Documents.tsx";

afterEach(cleanup);

type P = ApiDocumentSummary["pipelines"][string];
const p = (status: P["status"], extra: Partial<P> = {}, counts: Partial<P["counts"]> = {}): P => ({
  status, counts: { final: 0, converging: 0, notStated: 0, challenged: 0, ...counts }, ...extra,
});
const day = 86_400_000;
const now = new Date(2026, 9, 25, 12).getTime();
const doc = (id: string, supplier: string, template: string, pipelines: Record<string, P>, uploadedAt = now): ApiDocumentSummary =>
  ({ id, name: `${id}.pdf`, supplier, template, pages: 2, uploadedAt, pipelines });

const docs = [
  doc("new-cell", "Kestrel", "battery", { ours: p("processing", {}, { final: 3, converging: 30 }), baseline: p("delivered", { bond: "locked", closesAt: now + 60_000 }, { final: 20 }) }),
  doc("tee", "Linho Norte", "textile", {
    ours: p("delivered", { bond: "locked", closesAt: now + 120_000 }, { final: 10, notStated: 2, challenged: 1 }),
    baseline: p("delivered", { bond: "locked", closesAt: now + 90_000 }, { final: 11, notStated: 1 }),
  }, now - 2 * day),
  doc("helion", "Helion", "battery", {
    ours: p("settled", { bond: "released", closesAt: now - day }, { final: 30, notStated: 3 }),
    baseline: p("settled", { bond: "slashed", received: "0.9", closesAt: now - day }, { final: 31, notStated: 2, challenged: 1 }),
  }, new Date(2026, 8, 30).getTime()),
];

test("a row reads its status, the lead Pipeline's counts, Challenges on any Pipeline, the Bond, and where a click goes", () => {
  expect(docRow(docs[0]!)).toMatchObject({ status: "Processing", bond: "locked", href: "/documents/new-cell/pipeline", counts: { final: 3, notStated: 0, challenged: 0 } });
  expect(docRow(docs[1]!)).toMatchObject({ status: "Delivered", bond: "locked", closesAt: now + 120_000, href: "/documents/tee", counts: { final: 10, notStated: 2, challenged: 1 } });
  expect(docRow(docs[2]!)).toMatchObject({ status: "Settled", bond: "slashed", href: "/documents/helion", counts: { challenged: 1 } });
  expect(docRow(doc("x", "", "battery", { ours: p("processing") })).bond).toBeUndefined();
  expect(docRow(doc("y", "", "battery", { ours: p("awaiting arbiter", { bond: "locked" }) })).status).toBe("Delivered");
});

test("totals: Documents this month, Fields delivered, open Supplier Requests and USDC received from Slashes", () => {
  // tee and new-cell are this month; delivered lead Pipelines: tee (12 Fields, 2 Not stated) and helion (33, 3).
  expect(listTotals(docs, now)).toEqual({ thisMonth: 2, fieldsDelivered: 45, supplierRequests: 5, received: "0.90" });
});

test("filters by Template, Supplier and status, and search matches name or Supplier", () => {
  const ids = (f: Parameters<typeof filterDocs>[1]) => filterDocs(docs, f).map((d) => d.id);
  expect(ids({})).toEqual(["new-cell", "tee", "helion"]);
  expect(ids({ template: "battery" })).toEqual(["new-cell", "helion"]);
  expect(ids({ supplier: "Helion" })).toEqual(["helion"]);
  expect(ids({ status: "Delivered" })).toEqual(["tee"]);
  expect(ids({ q: "linho" })).toEqual(["tee"]);
  expect(ids({ q: "CELL" })).toEqual(["new-cell"]);
  expect(ids({ template: "textile", status: "Settled" })).toEqual([]);
});

const labels = { ours: "Origyn", baseline: "Baseline" };

test("the list: a row per Document with Operator chips and links by status; filters narrow it and say when nothing matches", () => {
  render(<DocumentsView docs={docs} labels={labels} now={now} />);
  const rows = screen.getAllByRole("link", { name: /\.pdf/ });
  expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/documents/new-cell/pipeline", "/documents/tee", "/documents/helion"]);
  expect(within(rows[0]!).getByText("Origyn")).toBeTruthy();
  expect(within(rows[0]!).getByText("Baseline")).toBeTruthy();
  expect(within(rows[2]!).getByText("Slashed")).toBeTruthy();
  expect(screen.getByLabelText("Documents this month").textContent).toBe("2");

  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "Settled" } });
  expect(screen.getAllByRole("link", { name: /\.pdf/ }).map((r) => r.getAttribute("href"))).toEqual(["/documents/helion"]);
  fireEvent.change(screen.getByLabelText("Search"), { target: { value: "nothing like this" } });
  expect(screen.queryAllByRole("link", { name: /\.pdf/ })).toEqual([]);
  expect(screen.getByText("No Documents match these filters.")).toBeTruthy();
});

test("no Documents yet: the empty state asks for a first upload", () => {
  render(<DocumentsView docs={[]} labels={labels} now={now} />);
  expect(screen.getByText("Upload your first Supplier Document.")).toBeTruthy();
});
