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

test("the Compare tab counts the differences and marks them", () => {
  render(<ReviewView d={doc()} config={config} offset={0} file={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: /Compare/ }));
  expect(screen.getByText("2 differences in 12 Fields. Click a row to see its quote.")).toBeTruthy();
  expect(screen.getAllByText("≠ Differs")).toHaveLength(2);
});

test("all four view tabs render for a delivered Document, for each Operator", () => {
  const d = doc();
  d.views[0]!.markdown = "# Voltaris NMC-800\n\n| Rated capacity | 220 Ah |";
  render(<ReviewView d={d} config={config} offset={0} file={vi.fn()} />);
  for (const op of ["Origyn Pipeline", "Baseline"]) {
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(op) }));
    fireEvent.click(screen.getByRole("tab", { name: "JSON" }));
    expect(screen.getByTestId("json").textContent).toContain('"rated_capacity_ah"');
    expect(screen.getByText("Download .json").getAttribute("download")).toBe(`battery-01-voltaris-pack-spec.${op === "Baseline" ? "baseline" : "ours"}.passport.json`);
    fireEvent.click(screen.getByRole("tab", { name: "Markdown" }));
    expect(screen.getByTestId("markdown").textContent).toContain("| Rated capacity |");
    expect(screen.getByText("Download .md").getAttribute("href")).toMatch(/^data:text\/markdown/);
    fireEvent.click(screen.getByRole("tab", { name: "Source Markdown" }));
    if (op === "Baseline") expect(screen.getByText(/Source Markdown is not available for Baseline/)).toBeTruthy();
    else expect(screen.getByTestId("source-markdown").textContent).toContain("# Voltaris NMC-800");
    fireEvent.click(screen.getByRole("tab", { name: "Trace" }));
    expect(screen.getByText("No Trace reported.")).toBeTruthy();
    expect(screen.getByText("Self-reported; the Bond is the guarantee.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
  }
});

test("every Field row responds to a click, whatever its status", () => {
  const d = doc();
  const f = d.views[0]!.fields;
  f[0] = { name: f[0]!.name, label: f[0]!.label, tieBreak: false, status: "converging" };
  const scan = f[1]!;
  if ("evidence" in scan) scan.evidence = { ...scan.evidence, rects: [] };
  const volt = f.find((x) => x.name === "nominal_voltage_v")!;
  Object.assign(volt, { challenge: { id: "c2", status: "upheld", value: "360 V", page: 1, quote: "Nominal voltage 360 V" }, corrected: { was: "36 V" } });
  f.push({ name: "hazardous_substances", label: "Hazardous substances", tieBreak: false, status: "not stated", quotes: [], supplierRequest: "Hello" });
  const { container } = render(<ReviewView d={d} config={config} offset={0} file={vi.fn()} />);
  const click = (name: string) => fireEvent.click(container.querySelector(`[data-field="${name}"] > div`)!);

  click("name");
  expect(screen.getByText("Still converging")).toBeTruthy();
  click("battery_identifier");
  expect(screen.getByText("quote not found in the PDF text (scan)")).toBeTruthy();
  expect(container.querySelector('[data-field="battery_identifier"]')!.textContent).toContain("Battery identifier BAT-EU-2027-000214");
  click("rated_capacity_ah");
  expect(screen.getByText(/Highlighted: Rated capacity/)).toBeTruthy();
  click("nominal_voltage_v");
  expect(screen.getByText(/Highlighted: Nominal voltage/)).toBeTruthy();
  fireEvent.click(container.querySelector('[data-field="hazardous_substances"]')!);
  expect(screen.getByText("Not stated in this Document.")).toBeTruthy();
  fireEvent.click(container.querySelector('[data-field="initial_internal_resistance_ohm"]')!);
  expect(screen.getByText(/Highlighted: Initial internal resistance/)).toBeTruthy();

  // The Baseline's Challenged row.
  fireEvent.click(screen.getByRole("tab", { name: /Baseline/ }));
  click("rated_capacity_ah");
  expect(screen.getByText(/Highlighted: Rated capacity — “80”/)).toBeTruthy();
});

test("a Not stated Field the Brand provides says so instead of offering a Supplier Request", () => {
  const tpl = structuredClone((respond("/api/templates") as { name: string; fields: { name: string }[] }[]).find((t) => t.name === "battery")!);
  tpl.fields = tpl.fields.map((f) => (f.name === "initial_internal_resistance_ohm" ? { ...f, author: "Brand" } : f));
  render(<ReviewView d={doc()} config={config} offset={0} template={tpl as never} file={vi.fn()} />);
  expect(screen.getByText("Brand to provide")).toBeTruthy();
  expect(screen.queryByText("Copy Supplier Request")).toBeNull();
});

test("the Trace tab draws a Span tree, sub-agents nested under their parent", async () => {
  const { TraceView } = await import("../src/screens/brand/views.tsx");
  render(<TraceView spans={[{ label: "Extraction", view: "original", model: "claude", start: 0, end: 100, children: [{ label: "Table reader", view: "Markdown", model: "script", result: "3 tables", start: 10, end: 40 }] }]} />);
  expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Extractionoriginal · claude", "↳ Table readerMarkdown · script · 3 tables"]);
});

test("arrow keys move between rows and C opens a Challenge on the selected Field", () => {
  render(<ReviewView d={doc()} config={config} offset={0} file={vi.fn()} />);
  fireEvent.keyDown(window, { key: "ArrowDown" });
  fireEvent.keyDown(window, { key: "c" });
  expect(screen.getByText("Origyn Pipeline delivered")).toBeTruthy();
});
