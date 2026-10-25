// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { respond } from "../src/fixtures.ts";
import { ApiFailure, type ApiConfig, type ApiDocument } from "../src/api.ts";

// pdf.js needs a real canvas; the viewer is stubbed to expose pick mode as a button.
vi.mock("../src/components/DocumentViewer.tsx", () => ({
  DocumentViewer: ({ pick, caption }: { pick?: { onPick(p: { page: number; quote: string }): void }; caption?: string }) => (
    <div>
      <span>{caption}</span>
      {pick && <button onClick={() => pick.onPick({ page: 1, quote: "Rated capacity 220 Ah" })}>pick a line</button>}
    </div>
  ),
}));
const { ReviewView } = await import("../src/screens/brand/Review.tsx");

afterEach(cleanup);
const doc = () => structuredClone(respond("/api/documents/doc-1")) as ApiDocument;
const config = respond("/api/config") as ApiConfig;

test("a Challenge the server rejects shows its error inline, and the quote must be picked again", async () => {
  const file = vi.fn().mockRejectedValue(new ApiFailure(400, "Quote not found on p. 1"));
  const { container } = render(<ReviewView d={doc()} config={config} offset={0} file={file} />);
  fireEvent.click(container.querySelector('[data-field="rated_capacity_ah"] button')!);
  fireEvent.click(screen.getByText("File Challenge"));
  expect(screen.getByRole("alert").textContent).toBe("Pick the line on the Document that states the value first.");

  fireEvent.click(screen.getByText("pick a line"));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "220 Ah" } });
  fireEvent.click(screen.getByText("File Challenge"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Quote not found on p. 1. Click the table row or sentence that holds the value."));
  expect(file).toHaveBeenCalledWith(expect.objectContaining({ pipeline: "ours", field: "rated_capacity_ah", page: 1, quote: "Rated capacity 220 Ah", value: 220, unit: "Ah" }));
  expect(screen.getByText(/Click the region on the Document/)).toBeTruthy();
});

test("a filed Challenge confirms with the challenged value and page", async () => {
  const file = vi.fn().mockResolvedValue({ id: "c1" });
  render(<ReviewView d={doc()} config={config} offset={0} file={file} />);
  fireEvent.click(screen.getAllByText("Challenge")[0]!);
  fireEvent.click(screen.getByText("pick a line"));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "220 Ah" } });
  fireEvent.click(screen.getByText("File Challenge"));
  await screen.findByText("Challenge filed");
  expect(screen.getByText("220 Ah").tagName).toBe("B");
  expect(screen.queryByText("pick a line")).toBeNull();
});

test("Copy Supplier Request opens the message and copies it", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<ReviewView d={doc()} config={config} offset={0} file={vi.fn()} />);
  expect(screen.getByText("Not stated · 1")).toBeTruthy();
  fireEvent.click(screen.getByText("Copy Supplier Request"));
  expect(screen.getByRole("dialog", { name: "Supplier Request · Voltaris Mobility" })).toBeTruthy();
  fireEvent.click(screen.getByText("Copy message"));
  await screen.findByText("Copied");
  expect(writeText.mock.calls[0]![0]).toMatch(/^Hello Voltaris Mobility team/);
});

test("rows sit under their Template section; a Brand-authored Not stated Field is Brand to provide, with no Supplier Request", () => {
  const d = doc();
  const ns = d.views[0]!.fields.find((f) => f.status === "not stated")!;
  Object.assign(ns, { author: "Brand", supplierRequest: undefined });
  Object.assign(d.views[0]!, { supplierRequest: undefined, brandToProvide: [ns.name] });
  render(<ReviewView d={d} config={config} offset={0} file={vi.fn()} />);
  expect(screen.getByText("Performance and durability · 3")).toBeTruthy();
  expect(screen.getByText("Brand to provide · 1")).toBeTruthy();
  expect(screen.getByText("Author: Brand")).toBeTruthy();
  expect(screen.queryByText("Copy Supplier Request")).toBeNull();
});

test("the Compare tab counts the differences and marks them", () => {
  render(<ReviewView d={doc()} config={config} offset={0} file={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: /Compare/ }));
  expect(screen.getByText("2 differences in 10 Fields. Click a row to see its quote.")).toBeTruthy();
  expect(screen.getAllByText("≠ Differs")).toHaveLength(2);
});

test("arrow keys move between rows and C opens a Challenge on the selected Field", () => {
  render(<ReviewView d={doc()} config={config} offset={0} file={vi.fn()} />);
  fireEvent.keyDown(window, { key: "ArrowDown" });
  fireEvent.keyDown(window, { key: "c" });
  expect(screen.getByText("Origyn Pipeline delivered")).toBeTruthy();
});
