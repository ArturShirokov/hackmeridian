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
  expect(screen.getByText("Not stated · 1 Field")).toBeTruthy();
  expect(screen.getByText("1 from the Supplier · 0 Brand to provide")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy Supplier Request · 1 Field" })).toBeTruthy();
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
  expect(document.querySelector('[data-field="rated_capacity_ah"] [data-author]')!.textContent).toBe("Supplier");
  expect(screen.getByText("0 from the Supplier · 1 Brand to provide")).toBeTruthy();
  expect(document.querySelector(`[data-field="${ns.name}"] [data-author]`)!.textContent).toBe("Brand");
  expect(screen.queryByText("Copy Supplier Request")).toBeNull();
});

test("the Compare tab counts the differences and marks them", () => {
  render(<ReviewView d={doc()} config={config} offset={0} file={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: /Compare/ }));
  expect(screen.getByText("2 differences in 10 Fields. Click a row to see its quote.")).toBeTruthy();
  expect(screen.getAllByText("≠ Differs")).toHaveLength(2);
});

test("all four view tabs render for a delivered Document, for each Operator", () => {
  const d = doc();
  d.views[0]!.markdown = "# Voltaris NMC-800\n\n| Rated capacity | 220 Ah |";
  d.views[0]!.trace = [
    { id: "s1", label: "Original", view: "original", model: "Claude Code", result: "12 values", start: 0, end: 50 },
    { id: "s2", parent: "s1", label: "Table reader", view: "markdown", model: "script", start: 10, end: 20 },
  ];
  render(<ReviewView d={d} config={config} offset={0} file={vi.fn()} />);
  for (const op of ["Origyn", "Baseline"]) {
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(op) }));
    fireEvent.click(screen.getByRole("tab", { name: "JSON" }));
    expect(screen.getByTestId("json").textContent).toContain('"rated_capacity_ah"');
    expect(screen.getByText("Download .json").getAttribute("download")).toBe(`battery-01-voltaris-pack-spec.${op.toLowerCase()}.passport.json`);
    fireEvent.click(screen.getByRole("tab", { name: "Markdown" }));
    // Rendered tables by default; Raw shows the Markdown source.
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent).slice(0, 5)).toEqual(["Field", "Value", "Status", "Page", "Quote"]);
    expect(screen.getByRole("cell", { name: "Rated capacity" })).toBeTruthy();
    expect(screen.queryByTestId("markdown")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    expect(screen.getByTestId("markdown").textContent).toContain("| Rated capacity |");
    fireEvent.click(screen.getByRole("button", { name: "Rendered" }));
    expect(screen.queryByTestId("markdown")).toBeNull();
    expect(screen.getByText("Download .md").getAttribute("href")).toMatch(/^data:text\/markdown/);
    fireEvent.click(screen.getByRole("tab", { name: "Source Markdown" }));
    if (op === "Baseline") expect(screen.getByText(/Source Markdown is not available for Baseline/)).toBeTruthy();
    else expect(screen.getByTestId("source-markdown").textContent).toContain("# Voltaris NMC-800");
    fireEvent.click(screen.getByRole("tab", { name: "Trace" }));
    if (op === "Baseline") expect(screen.getByText("No Trace reported.")).toBeTruthy();
    else expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Originaloriginal · Claude Code · 12 values", "↳ Table readermarkdown · script"]);
    expect(screen.getByText("Self-reported; the Bond is the guarantee.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
  }
});

test("every Field row responds to a click, whatever its status", () => {
  const d = doc();
  const f = d.views[0]!.fields;
  f[0] = { name: f[0]!.name, label: f[0]!.label, section: f[0]!.section, author: "Supplier", tieBreak: false, status: "converging" };
  const scan = f[1]!;
  if ("evidence" in scan) scan.evidence = { ...scan.evidence, rects: [] };
  const volt = f.find((x) => x.name === "nominal_voltage_v")!;
  Object.assign(volt, { challenge: { id: "c2", status: "upheld", value: "360 V", page: 1, quote: "Nominal voltage 360 V" }, corrected: { was: "36 V" } });
  f.push({ name: "hazardous_substances", label: "Hazardous substances", section: "Battery materials and composition", author: "Supplier", tieBreak: false, status: "not stated", quotes: [], supplierRequest: "Hello" });
  const { container } = render(<ReviewView d={d} config={config} offset={0} file={vi.fn()} />);
  const click = (name: string) => fireEvent.click(container.querySelector(`[data-field="${name}"] > div`)!);

  click("manufacturing_place");
  expect(screen.getByText("Still converging")).toBeTruthy();
  click("manufacturing_date");
  expect(screen.getByText("quote not found in the PDF text (scan)")).toBeTruthy();
  expect(container.querySelector('[data-field="manufacturing_date"]')!.textContent).toContain("Date of manufacture February 2027");
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
  const d = doc();
  Object.assign(d.views[0]!.fields.find((f) => f.name === "initial_internal_resistance_ohm")!, { author: "Brand" });
  render(<ReviewView d={d} config={config} offset={0} template={tpl as never} file={vi.fn()} />);
  expect(screen.getAllByText("Brand to provide").length).toBeGreaterThan(0);
  expect(screen.queryByText("Copy Supplier Request")).toBeNull();
});

test("the Trace tab draws a Span tree, sub-agents nested under their parent", async () => {
  const { TraceView } = await import("../src/screens/brand/views.tsx");
  render(<TraceView spans={[{ label: "Extraction", view: "original", model: "claude", start: 0, end: 100, children: [{ label: "Table reader", view: "Markdown", model: "script", result: "3 tables", start: 10, end: 40 }] }]} />);
  expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Extractionoriginal · claude", "↳ Table readerMarkdown · script · 3 tables"]);
});

test("the Compare tab shows any number of Operators side by side, an outside Operator's column included", () => {
  const d = doc();
  const third = structuredClone(d.views[1]!);
  Object.assign(third, { pipeline: "GOUTSIDE", label: "Claude solo", operator: "GOUTSIDE" });
  third.fields = third.fields.map((f) => (f.name === "rated_capacity_ah" && "display" in f ? { ...f, value: 230, display: "230 Ah" } : f));
  d.views.push(third);
  render(<ReviewView d={d} config={config} offset={0} file={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: /Compare/ }));
  for (const v of d.views) expect(screen.getAllByText(v.label).length).toBeGreaterThan(0);
  expect(screen.getByText("230 Ah")).toBeTruthy();
});

test("arrow keys move between rows and C opens a Challenge on the selected Field", () => {
  render(<ReviewView d={doc()} config={config} offset={0} file={vi.fn()} />);
  fireEvent.keyDown(window, { key: "ArrowDown" });
  fireEvent.keyDown(window, { key: "c" });
  expect(screen.getByText("Origyn delivered")).toBeTruthy();
});

test("Compare: every differing cell without a Challenge has a Challenge button, which files against that Operator", async () => {
  const file = vi.fn().mockResolvedValue({ id: "c9" });
  render(<ReviewView d={doc()} config={config} offset={0} file={file} />);
  fireEvent.click(screen.getByRole("tab", { name: /Compare/ }));
  // Rated capacity differs (the Baseline's is already Challenged); internal resistance differs (ours is Not stated).
  expect(screen.getAllByRole("button", { name: /^Challenge / }).map((b) => b.getAttribute("aria-label"))).toEqual([
    "Challenge Origyn: Rated capacity", "Challenge Origyn: Initial internal resistance (pack)", "Challenge Baseline: Initial internal resistance (pack)",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Challenge Baseline: Initial internal resistance (pack)" }));
  expect(screen.getByText("Baseline delivered")).toBeTruthy();
  fireEvent.click(screen.getByText("pick a line"));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "0.135 ohm" } });
  fireEvent.click(screen.getByText("File Challenge"));
  await screen.findByText("Challenge filed");
  expect(file).toHaveBeenCalledWith(expect.objectContaining({ pipeline: "baseline", field: "initial_internal_resistance_ohm", value: 0.135, unit: "ohm" }));
});

test("a Not stated Field can be Challenged: the Document does state it after all", async () => {
  const file = vi.fn().mockResolvedValue({ id: "c9" });
  const tpl = (respond("/api/templates") as { name: string }[]).find((t) => t.name === "battery");
  render(<ReviewView d={doc()} config={config} offset={0} template={tpl as never} file={file} />);
  fireEvent.click(screen.getByRole("button", { name: "Challenge Origyn: Initial internal resistance (pack)" }));
  expect(screen.getByText("Origyn delivered")).toBeTruthy();
  expect(screen.getByText(/the Document does state it/i)).toBeTruthy();
  fireEvent.click(screen.getByText("pick a line"));
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "0.135 ohm" } });
  fireEvent.click(screen.getByText("File Challenge"));
  await screen.findByText("Challenge filed");
  expect(file).toHaveBeenCalledWith(expect.objectContaining({ pipeline: "ours", field: "initial_internal_resistance_ohm", value: 0.135 }));
});

test("a closed Challenge Window offers no Challenge, from any route", () => {
  const d = doc();
  for (const v of d.views) Object.assign(v.escrow!, { closesAt: Date.now() - 1000, msLeft: 0 });
  window.history.replaceState(null, "", "/documents/doc-1?challenge=1");
  render(<ReviewView d={d} config={config} offset={0} file={vi.fn()} />);
  window.history.replaceState(null, "", "/");
  expect(screen.queryByText("File Challenge")).toBeNull();
  expect(screen.queryAllByRole("button", { name: /^Challenge/ })).toHaveLength(0);
  fireEvent.click(screen.getByRole("tab", { name: /Compare/ }));
  expect(screen.queryAllByRole("button", { name: /^Challenge/ })).toHaveLength(0);
});

test("Field rows carry the Template's number and a High-stake mark", () => {
  const tpl = structuredClone((respond("/api/templates") as { name: string; fields: { name: string; highStake?: boolean }[] }[]).find((t) => t.name === "battery")!);
  tpl.fields = tpl.fields.map((f) => (f.name === "rated_capacity_ah" ? { ...f, highStake: true } : f));
  render(<ReviewView d={doc()} config={config} offset={0} template={tpl as never} file={vi.fn()} />);
  const row = document.querySelector('[data-field="rated_capacity_ah"]')!;
  expect(row.querySelector("[data-no]")!.textContent).toBe("51");
  expect(row.textContent).toContain("★ High-stake");
  expect(document.querySelector('[data-field="nominal_voltage_v"]')!.textContent).not.toContain("High-stake");
  expect(document.querySelector('[data-field="initial_internal_resistance_ohm"] [data-no]')!.textContent).toBe("68");
});

test("a rejected Challenge shows the Arbiter's note and the challenged quote struck through", () => {
  const d = doc();
  Object.assign(d.views[0]!.fields.find((f) => f.name === "nominal_voltage_v")!, {
    challenge: { id: "c3", status: "rejected", value: "36 V", page: 2, quote: "Module voltage 36 V", note: "That line is one module, not the pack." },
  });
  render(<ReviewView d={d} config={config} offset={0} file={vi.fn()} />);
  expect(screen.getByText("Rejected by the Arbiter: That line is one module, not the pack.")).toBeTruthy();
  expect(screen.getByText("p. 2 · “Module voltage 36 V”").style.textDecoration).toBe("line-through");
});
