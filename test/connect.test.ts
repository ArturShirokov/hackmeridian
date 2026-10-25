import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { configFile, mcpUrl, setup } from "../src/connect.js";

const PROD = "https://doc2dpp.wisecraft.dev";

test("the MCP URL is the Job Board's base URL plus /mcp, trailing slash or not", () => {
  expect(mcpUrl(PROD)).toBe("https://doc2dpp.wisecraft.dev/mcp");
  expect(mcpUrl("http://127.0.0.1:3100/")).toBe("http://127.0.0.1:3100/mcp");
});

test("each harness gets what to paste for the URL it is given", () => {
  const url = mcpUrl(PROD);
  expect(setup("claude-code", url).map((b) => b.text)).toEqual(["claude mcp add --transport http doc2dpp https://doc2dpp.wisecraft.dev/mcp"]);
  const [oc] = setup("opencode", url);
  expect(JSON.parse(oc!.text)).toEqual({
    $schema: "https://opencode.ai/config.json",
    mcp: { doc2dpp: { type: "remote", url: "https://doc2dpp.wisecraft.dev/mcp", enabled: true } },
  });
  expect(setup("pi", url).map((b) => b.text)).toEqual([
    "pi mcp add doc2dpp --url https://doc2dpp.wisecraft.dev/mcp",
    JSON.stringify({ mcpServers: { doc2dpp: { url: "https://doc2dpp.wisecraft.dev/mcp" } } }, null, 2),
  ]);
  expect(setup("other", url).map((b) => b.text)).toEqual(["https://doc2dpp.wisecraft.dev/mcp"]);
});

test("the checked-in agent configs are the local runbook's URL, in the same shape the modal hands out", () => {
  const local = mcpUrl("http://127.0.0.1:3100");
  const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
  expect(read("agents/claude-code/mcp.json")).toEqual(configFile("claude-code", local));
  expect(read("agents/opencode/opencode.json")).toEqual(configFile("opencode", local));
  expect(read("agents/pi/.pi/mcp.json")).toEqual(configFile("pi", local));
});

test("the Worker starter prompt registers first and holds no Worker id", () => {
  const worker = readFileSync("agents/worker-prompt.md", "utf8");
  expect(worker.indexOf("register_worker")).toBeLessThan(worker.indexOf("next_job"));
  expect(worker).toContain("wait: 25");
  expect(worker).not.toMatch(/WORKER_ID|\bw\d+\b/);
  const operator = readFileSync("agents/operator-prompt.md", "utf8");
  for (const s of ["list_open_documents", "claim_document", "deliver", "submit_signed", "scripts/outside-operator.ts sign"]) expect(operator).toContain(s);
});
