// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// A one-page fake pdf.js: enough for the viewer to lay out boxes over a 600 × 800 page.
vi.mock("pdfjs-dist", () => {
  const page = { getViewport: () => ({ width: 600, height: 800, scale: 1 }), render: () => ({ promise: Promise.resolve(), cancel() {} }) };
  return { GlobalWorkerOptions: {}, TextLayer: class {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => page }) }) };
});
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "" }));
globalThis.ResizeObserver ??= class { constructor(private cb: () => void) {} observe() { this.cb(); } disconnect() {} } as never;
Element.prototype.scrollTo ??= () => {};
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 700 });
const { DocumentViewer } = await import("../src/components/DocumentViewer.tsx");

afterEach(cleanup);
const rect = { x: 0.1, y: 0.2, w: 0.5, h: 0.02 };

test("a box several Fields share opens a picker listing them; picking one selects it", async () => {
  const onBoxClick = vi.fn();
  render(<DocumentViewer pdfUrl="/a.pdf" page={1} onPage={() => {}} onBoxClick={onBoxClick}
    boxes={[{ id: "minimum_voltage_v", page: 1, rects: [rect], kind: "quoted", title: "Minimum voltage", fields: [{ id: "minimum_voltage_v", label: "Minimum voltage" }, { id: "maximum_voltage_v", label: "Maximum voltage" }] }]} />);
  const box = await screen.findByTitle("Minimum voltage · Maximum voltage");
  fireEvent.click(box);
  expect(onBoxClick).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("menuitem", { name: "Maximum voltage" }));
  expect(onBoxClick).toHaveBeenCalledWith("maximum_voltage_v");
  expect(screen.queryByRole("menu")).toBeNull();
});

test("a Not stated Field with two quotes on one page draws both boxes without a key clash", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const onBoxClick = vi.fn();
  render(<DocumentViewer pdfUrl="/b.pdf" page={1} onPage={() => {}} onBoxClick={onBoxClick}
    boxes={[0.2, 0.5].map((y) => ({ id: "cap", page: 1, rects: [{ ...rect, y }], kind: "notStated" as const, title: "Rated capacity" }))} />);
  const drawn = await screen.findAllByTitle("Rated capacity");
  expect(drawn).toHaveLength(2);
  fireEvent.click(drawn[1]!);
  expect(onBoxClick).toHaveBeenCalledWith("cap");
  expect(error.mock.calls.flat().join(" ")).not.toMatch(/same key/);
  error.mockRestore();
});
