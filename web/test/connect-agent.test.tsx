// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConnectAgent } from "../src/components/ConnectAgent.tsx";

const config = { now: Date.now(), baseUrl: "https://doc2dpp.wisecraft.dev", challengeWindowMs: 180_000, brand: { name: "Voltaris", reviewer: "Inês" }, operators: [] };
let workers: unknown[] = [];
let leaderboard: unknown[] = [];
afterEach(() => { cleanup(); vi.unstubAllGlobals(); workers = []; leaderboard = []; });
function serve() {
  vi.stubGlobal("fetch", async (path: string) => {
    const body = { "/api/config": config, "/api/workers": workers, "/api/leaderboard": leaderboard }[path.split("?")[0]!];
    return new Response(JSON.stringify(body ?? { error: "no route" }), { status: body ? 200 : 404 });
  });
}
const row = (operator: string) => ({ operator, label: operator, sieves: 1, documents: 0, fieldsDelivered: 0, challengesUpheld: 0, totalSlashed: "0", bondsLocked: "0", series: [] });

test("Claude Code as a Worker: the command for the configured URL and a prompt that registers, then live with the assigned id", async () => {
  workers = [{ name: "w1", lastSeen: Date.now(), live: true, doneToday: 0 }];
  serve();
  render(<ConnectAgent />);
  fireEvent.click(screen.getByRole("button", { name: "Connect an agent" }));
  fireEvent.click(await screen.findByRole("button", { name: "Claude Code" }));
  fireEvent.click(screen.getByRole("button", { name: /Worker in our Pipeline/ }));
  expect(await screen.findByText("claude mcp add --transport http doc2dpp https://doc2dpp.wisecraft.dev/mcp")).toBeTruthy();
  expect(screen.queryByLabelText("Worker id")).toBeNull();
  const prompt = screen.getByLabelText("Starter prompt").textContent!;
  expect(prompt).toContain("register_worker");
  expect(prompt).not.toMatch(/WORKER_ID|\bw\d+\b/);
  expect(await screen.findByText(/Waiting for a new Worker/)).toBeTruthy();
  await new Promise((r) => setTimeout(r, 50));
  workers = [{ name: "w2", harness: "Claude Code", lastSeen: Date.now(), live: true, doneToday: 0 }, ...workers];
  expect(await screen.findByText(/w2 · Claude Code is connected/, {}, { timeout: 3000 })).toBeTruthy();
});

test("Pi as an outside Operator: native MCP command and file, the Operator prompt, live once a new Leaderboard row appears", async () => {
  leaderboard = [row("Origyn")];
  serve();
  render(<ConnectAgent />);
  fireEvent.click(screen.getByRole("button", { name: "Connect an agent" }));
  fireEvent.click(await screen.findByRole("button", { name: "Pi" }));
  fireEvent.click(screen.getByRole("button", { name: /outside Operator/ }));
  expect(await screen.findByText("pi mcp add doc2dpp --url https://doc2dpp.wisecraft.dev/mcp")).toBeTruthy();
  expect(screen.getByLabelText("Starter prompt").textContent).toContain("scripts/outside-operator.ts new");
  expect(screen.queryByLabelText("Worker id")).toBeNull();
  await new Promise((r) => setTimeout(r, 50));
  leaderboard = [row("Origyn"), row("GABC")];
  expect(await screen.findByText(/GABC is on the Leaderboard/, {}, { timeout: 3000 })).toBeTruthy();
});

test("another MCP client gets the URL only, and Back returns to the agent step", async () => {
  serve();
  render(<ConnectAgent />);
  fireEvent.click(screen.getByRole("button", { name: "Connect an agent" }));
  fireEvent.click(await screen.findByRole("button", { name: "Other MCP client" }));
  fireEvent.click(screen.getByRole("button", { name: /Worker in our Pipeline/ }));
  expect(await screen.findByText("https://doc2dpp.wisecraft.dev/mcp")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("button", { name: "OpenCode" })).toBeTruthy();
});
