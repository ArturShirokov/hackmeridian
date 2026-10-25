// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { FieldRow } from "../src/components/FieldRow.tsx";
import { Countdown, ProofLink } from "../src/components/ui.tsx";
import type { ApiField } from "../src/api.ts";

afterEach(cleanup);
const noop = () => {};
const row = (field: ApiField, challenge?: Parameters<typeof FieldRow>[0]["challenge"]) =>
  render(<FieldRow field={field} challenge={challenge} selected={false} expanded={false} tieBreak={false} canChallenge={false} onSelect={noop} onToggle={noop} onChallenge={noop} />);

test("a converging or withheld Field shows its status but never a value", () => {
  row({ name: "cap", label: "Rated capacity", section: "Performance", author: "Supplier", tieBreak: false, status: "converging" });
  row({ name: "volt", label: "Nominal voltage", section: "Performance", author: "Supplier", tieBreak: false, status: "final", withheld: true });
  expect(screen.getAllByText("· · ·")).toHaveLength(2);
  expect(screen.getByText("Converging")).toBeTruthy();
  expect(screen.getByText("Final")).toBeTruthy();
});

test("a filed Challenge turns the row Challenged and names the challenged value", () => {
  row(
    { name: "cap", label: "Rated capacity", section: "Performance", author: "Supplier", tieBreak: false, status: "final", value: 80, unit: "Ah", display: "80 Ah", evidence: { page: 1, quote: "80 Ah", rects: [] } },
    { id: "c1", status: "filed", value: "220 Ah (rated)", page: 1, quote: "Rated capacity 220 Ah" },
  );
  expect(screen.getByText("Challenged")).toBeTruthy();
  expect(screen.getByText("220 Ah (rated)")).toBeTruthy();
});

test("Countdown counts down from the server's clock", () => {
  vi.useFakeTimers({ now: 1_000_000 });
  // The server is 10 s ahead, so 70 s on the server's clock is 60 s left.
  render(<Countdown closesAt={1_070_000} windowMs={180_000} serverOffsetMs={10_000} settled={false} />);
  expect(screen.getByText("00:01:00")).toBeTruthy();
  act(() => void vi.advanceTimersByTime(5_000));
  expect(screen.getByText("00:00:55")).toBeTruthy();
  vi.useRealTimers();
});

test("a paused Countdown holds its time and says why, with the demo label", () => {
  vi.useFakeTimers({ now: 1_000_000 });
  render(<Countdown closesAt={1_070_000} msLeft={120_000} paused="challenge open" windowMs={180_000} serverOffsetMs={0} settled={false} note="3 min demo · 48 h live" />);
  act(() => void vi.advanceTimersByTime(5_000));
  expect(screen.getByText("00:02:00")).toBeTruthy();
  expect(screen.getByText(/paused while a Challenge is open/i)).toBeTruthy();
  expect(screen.getByText("3 min demo · 48 h live")).toBeTruthy();
  vi.useRealTimers();
});

test("ProofLink renders nothing without a link", () => {
  const { container } = render(<ProofLink hash="a3f9000000000000c21e" />);
  expect(container.innerHTML).toBe("");
  render(<ProofLink href="https://x.test" hash="a3f9000000000000c21e" />);
  expect(screen.getByText("View on Stellar ↗ a3f9…c21e")).toBeTruthy();
});
