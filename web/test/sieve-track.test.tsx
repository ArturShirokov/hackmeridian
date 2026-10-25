// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SieveTrack } from "../src/components/SieveTrack.tsx";
import type { ApiStation } from "../src/api.ts";

afterEach(cleanup);
const blackBox: ApiStation = { index: 0, kind: "extract", label: "Black box", state: "run", worker: "GABC", takenAt: 1, attempt: 1, meta: "" };

test("a Trace renders generically: top-level Spans as stations, sub-agent Spans nested inside, a running Span live", () => {
  const { container, rerender } = render(<SieveTrack label="Acme" sub="" stations={[blackBox]} trace={[
    { id: "plan", label: "Planner", view: "original", model: "claude-opus", start: 1 },
  ]} />);
  expect(screen.getByText("Planner")).toBeTruthy();
  expect(screen.getByText("working…")).toBeTruthy();
  expect(screen.queryByText("Black box")).toBeNull();

  rerender(<SieveTrack label="Acme" sub="" stations={[blackBox]} trace={[
    { id: "plan", label: "Planner", view: "original", model: "claude-opus", result: "split in 2", start: 1, end: 9 },
    { id: "tables", parent: "plan", label: "Table reader", view: "pdftotext output", model: "gpt-5", result: "3 tables", start: 2, end: 5 },
    { id: "ocr", parent: "tables", label: "OCR", view: "page 2 image", model: "tesseract", start: 3 },
  ]} />);
  expect(container.querySelectorAll("[data-state]")).toHaveLength(1);
  const tables = container.querySelector('[data-span="tables"]')!;
  expect(tables.textContent).toContain("gpt-5 · pdftotext output · 3 tables");
  expect(tables.querySelector('[data-span="ocr"]')!.textContent).toContain("tesseract · page 2 image");
});

test("no Trace shows the stations as they are: one Black box station", () => {
  const { container } = render(<SieveTrack label="Acme" sub="" stations={[blackBox]} />);
  expect(container.querySelectorAll("[data-state]")).toHaveLength(1);
  expect(screen.getByText("Black box")).toBeTruthy();
});
