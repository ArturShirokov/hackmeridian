// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
vi.mock("../src/components/DocumentViewer.tsx", () => ({ DocumentViewer: () => null }));
import { App } from "../src/Shell.tsx";

const users = [
  { id: "ines", name: "Inês Duarte", role: "brand", org: "Voltaris", sub: "Product Compliance, Voltaris", brand: "brand" },
  { id: "arbiter", name: "Arbiter desk", role: "arbiter", org: "Arbiter", sub: "Neutral third party" },
  { id: "origyn", name: "Origyn Operator", role: "operator", org: "Origyn", sub: "Runs our 5-Sieve Pipeline", operator: "ours" },
  { id: "baseline", name: "Baseline Operator", role: "operator", org: "Baseline", sub: "Runs the one-pass Baseline", operator: "baseline" },
];

/** A Job Board that knows only the session routes; every other route 404s, so the screens show their empty states. */
function serve(signedIn?: string) {
  let user = users.find((u) => u.id === signedIn) ?? null;
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    const p = path.split("?")[0];
    let body: unknown;
    if (p === "/api/users") body = users;
    else if (p === "/api/session" && init?.method === "POST") body = { user: (user = users.find((u) => u.id === JSON.parse(String(init.body)).user)!) };
    else if (p === "/api/session" && init?.method === "DELETE") body = { user: (user = null) };
    else if (p === "/api/session") body = { user };
    else if (p === "/api/balance" && user?.role === "brand") body = { usdc: "97.5", link: "https://stellar.expert/explorer/testnet/account/GB5Q" };
    return new Response(JSON.stringify(body ?? { error: "no route" }), { status: body ? 200 : 404 });
  });
}
const nav = () => within(screen.getByRole("navigation")).getAllByRole("link").map((a) => a.textContent);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState(null, "", "/"); });

test("signed out, Landing is the entry at /; Open demo leads to Sign in as", async () => {
  serve();
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Supplier documents in. Passport data out. Money on every answer." })).toBeTruthy();
  expect(screen.queryByRole("complementary")).toBeNull();
  fireEvent.click(screen.getAllByRole("link", { name: "Open demo" })[0]!);
  expect(await screen.findByRole("list", { name: "Sign in as" })).toBeTruthy();
  expect(location.pathname).toBe("/sign-in");
});

test("signed out, the public Leaderboard opens without signing in", async () => {
  serve();
  render(<App />);
  fireEvent.click((await screen.findAllByRole("link", { name: "Leaderboard" }))[0]!);
  expect(await screen.findByRole("heading", { name: "Leaderboard" })).toBeTruthy();
  expect(location.pathname).toBe("/leaderboard");
  expect(screen.queryByRole("list", { name: "Sign in as" })).toBeNull();
});

test("signed in, / and /sign-in go to the role's home", async () => {
  serve("arbiter");
  history.replaceState(null, "", "/sign-in");
  render(<App />);
  await waitFor(() => expect(location.pathname).toBe("/arbiter"));
});

test("on Sign in as, picking Inês opens the Brand's screens", async () => {
  serve();
  history.replaceState(null, "", "/sign-in");
  render(<App />);
  const list = await screen.findByRole("list", { name: "Sign in as" });
  expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([
    expect.stringContaining("Inês Duarte"), expect.stringContaining("Arbiter desk"),
    expect.stringContaining("Origyn Operator"), expect.stringContaining("Baseline Operator"),
  ]);
  fireEvent.click(within(list).getByText("Inês Duarte"));
  await waitFor(() => expect(nav()).toEqual(["Documents", "Upload", "Leaderboard"]));
  expect(location.pathname).toBe("/documents");
});

test.each([
  ["ines", ["Documents", "Upload", "Leaderboard"], "/arbiter", "/documents"],
  ["arbiter", ["Challenges"], "/documents", "/arbiter"],
  ["origyn", ["Job Board", "Pipelines", "Leaderboard"], "/upload", "/jobs"],
  ["baseline", ["Job Board", "Pipelines", "Leaderboard"], "/arbiter", "/jobs"],
])("%s sees only its own role's screens", async (id, links, other, home) => {
  serve(id);
  history.replaceState(null, "", other);
  render(<App />);
  await waitFor(() => expect(nav()).toEqual(links));
  await waitFor(() => expect(location.pathname).toBe(home));
  expect(within(screen.getByRole("complementary")).getByText(users.find((u) => u.id === id)!.name)).toBeTruthy();
});

test("the Brand sees its USDC balance with a View on Stellar link, and no wallet, key or crypto wording", async () => {
  serve("ines");
  render(<App />);
  expect(await screen.findByText("97.50 USDC")).toBeTruthy();
  expect(screen.getByRole("link", { name: /View on Stellar ↗/ }).getAttribute("href")).toBe("https://stellar.expert/explorer/testnet/account/GB5Q");
  expect(document.body.textContent).not.toMatch(/wallet|crypto|\bkeys?\b/i);
});

test("other roles see no balance, and Switch user goes back to the list", async () => {
  serve("arbiter");
  render(<App />);
  await waitFor(() => expect(nav()).toEqual(["Challenges"]));
  expect(screen.getByRole("complementary").textContent).not.toMatch(/USDC/);
  fireEvent.click(screen.getByRole("button", { name: "Switch user" }));
  expect(await screen.findByRole("list", { name: "Sign in as" })).toBeTruthy();
});

test.each(["Sign out", "doc2dpp"])("%s ends the session and leads to Landing", async (name) => {
  serve("ines");
  history.replaceState(null, "", "/documents");
  render(<App />);
  await waitFor(() => expect(nav()).toEqual(["Documents", "Upload", "Leaderboard"]));
  fireEvent.click(name === "doc2dpp" ? screen.getByRole("link", { name }) : screen.getByRole("button", { name }));
  expect(await screen.findByRole("heading", { name: /Passport data out/ })).toBeTruthy();
  expect(location.pathname).toBe("/");
  expect((await fetch("/api/session").then((r) => r.json())).user).toBeNull();
});
