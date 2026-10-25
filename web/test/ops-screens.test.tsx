// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// pdf.js doesn't load in jsdom; the evidence view's page is checked in the browser.
vi.mock("../src/components/DocumentViewer.tsx", () => ({ DocumentViewer: () => null }));
import { Arbiter } from "../src/screens/ops/Arbiter.tsx";
import { Jobs } from "../src/screens/ops/Jobs.tsx";
import { Leaderboard } from "../src/screens/ops/Leaderboard.tsx";

const config = {
  now: Date.now(), baseUrl: "http://127.0.0.1:3193", challengeWindowMs: 180_000, brand: { name: "Voltaris", reviewer: "Inês Duarte" },
  operators: [
    { pipeline: "ours", label: "Origyn", operator: "Origyn", bond: "10", fee: "1", sieves: [{ kind: "extract", label: "Original" }, { kind: "tiebreak", label: "Tie-break" }] },
    { pipeline: "baseline", label: "Baseline", operator: "Baseline", bond: "10", fee: "1", sieves: [{ kind: "extract", label: "One-pass extraction" }] },
  ],
};
function serve(routes: Record<string, unknown>) {
  vi.stubGlobal("fetch", async (path: string) => {
    const body = { "/api/config": config, ...routes }[path.split("?")[0]!];
    return new Response(JSON.stringify(body ?? { error: "no route" }), { status: body ? 200 : 404 });
  });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("with nothing open the Arbiter desk shows its record and the empty state", async () => {
  serve({ "/api/challenges": { open: [], decided: [], record: { decided: 3, upheld: 1, rejected: 2, earned: "2.1" } } });
  render(<Arbiter />);
  expect(await screen.findByText("No open Challenges.")).toBeTruthy();
  expect(screen.getByText("Bonds are settling automatically.")).toBeTruthy();
  expect(screen.getByText("Decided").nextSibling?.textContent).toBe("3");
  expect(screen.getByText("Upheld").nextSibling?.textContent).toBe("1");
  expect(screen.getByText("Rejected").nextSibling?.textContent).toBe("2");
  expect(screen.getByText("Earned · USDC").nextSibling?.textContent).toBe("2.10");
});

test("the Job Board shows a timed-out take as its own row, the Sieves of each Pipeline and the real MCP command", async () => {
  const job = { documentId: "d", documentName: "Cell spec.pdf", pipeline: "ours", sieve: "Original", postedAt: 0 };
  serve({
    "/api/workers": [{ name: "Pi", lastSeen: Date.now(), live: true, doneToday: 2 }, { name: "Old", lastSeen: 0, live: false, doneToday: 0 }],
    "/api/jobs": [{ ...job, id: "j1", status: "open" }, { ...job, id: "j1~1", status: "timed out", worker: "Pi", takenAt: 0 }],
  });
  render(<Jobs />);
  expect(await screen.findByText("timed out · back on board")).toBeTruthy();
  expect(screen.getByText("Connected Workers · 1")).toBeTruthy();
  expect(screen.queryByText("Old")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Connect an agent" }));
  fireEvent.click(screen.getByRole("button", { name: "Claude Code" }));
  fireEvent.click(screen.getByRole("button", { name: /Worker in our Pipeline/ }));
  expect(await screen.findByText("claude mcp add --transport http doc2dpp http://127.0.0.1:3193/mcp")).toBeTruthy();
  expect(screen.getByText("Tie-break")).toBeTruthy();
  expect(screen.getByText("No cross-check, no tie-break.")).toBeTruthy();
});

test("with no Workers the Job Board says Jobs wait", async () => {
  serve({ "/api/workers": [], "/api/jobs": [] });
  render(<Jobs />);
  expect(await screen.findByText(/No Workers connected/)).toBeTruthy();
});

test("Leaderboard numbers open their Stellar proof; a zero has no link", async () => {
  const account = "https://stellar.expert/explorer/testnet/account/GOPS";
  const settle = "https://stellar.expert/explorer/testnet/tx/918d8b13";
  const row = { operator: "Baseline", label: "Baseline", sieves: 1, documents: 2, fieldsDelivered: 37, challengesUpheld: 1, totalSlashed: "5", bondsLocked: "0", link: account,
    series: [{ documentId: "a", short: "Cellworks", balance: "10" }, { documentId: "b", short: "Hunan", balance: "5", settlementLink: settle }] };
  serve({ "/api/leaderboard": [row] });
  render(<Leaderboard />);
  await screen.findByText("37");
  const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href");
  expect(href("Documents delivered: 2")).toBe(account);
  expect(href("Challenges upheld: 1")).toBe(settle);
  expect(href("Total Slashed: 5.00 USDC")).toBe(settle);
  expect(screen.queryByRole("link", { name: /Bonds locked/ })).toBeNull();
  expect(screen.queryByRole("link", { name: /Fields delivered/ })).toBeNull();
});

test("the Leaderboard shows every column, a Slash on the chart and the one-Operator note", async () => {
  const row = { operator: "Baseline", label: "Baseline", sieves: 1, documents: 2, fieldsDelivered: 37, challengesUpheld: 1, totalSlashed: "5", bondsLocked: "10",
    accuracy: { correct: 30, fields: 40 }, series: [{ documentId: "a", short: "Cellworks", balance: "10" }, { documentId: "b", short: "Hunan", balance: "5" }] };
  serve({ "/api/leaderboard": [row] });
  render(<Leaderboard />);
  expect(await screen.findByText("37")).toBeTruthy();
  expect(screen.getByText("75.0 %")).toBeTruthy();
  expect(screen.getAllByText("5.00").length).toBeGreaterThan(0);
  expect(screen.getByText(/Only one Operator so far/)).toBeTruthy();
  expect(screen.getByText("−5.00")).toBeTruthy();
  expect(screen.getByText("Hunan")).toBeTruthy();
});

test("the Operator sidebar lights Pipelines, not the Job Board, on /jobs#pipelines", async () => {
  serve({ "/api/workers": [], "/api/jobs": [], "/api/session": { user: { id: "origyn", name: "Origyn", role: "operator" } } });
  history.replaceState(null, "", "/jobs#pipelines");
  Element.prototype.scrollIntoView = () => {};
  const { App } = await import("../src/Shell.tsx");
  const { container } = render(<App />);
  await screen.findByText("Pipelines");
  expect([...container.querySelectorAll(".om-nav.active")].map((a) => a.textContent)).toEqual(["Pipelines"]);
});
