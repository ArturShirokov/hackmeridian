// What an agent harness needs to reach the Job Board over MCP, for any base URL (local or https://doc2dpp.wisecraft.dev).
// Pure, so the web modal and scripts/agent-config.ts hand out the same thing. No node imports: the web bundles it.

export type Harness = "claude-code" | "opencode" | "pi" | "other";
export type AgentRole = "worker" | "operator";

export const mcpUrl = (baseUrl: string) => `${baseUrl.replace(/\/+$/, "")}/mcp`;

/** The config file each harness reads: `claude --mcp-config`, `opencode.json`, Pi's `.pi/mcp.json`. */
export function configFile(harness: Exclude<Harness, "other">, url: string): object {
  if (harness === "claude-code") return { mcpServers: { doc2dpp: { type: "http", url } } };
  if (harness === "opencode") return { $schema: "https://opencode.ai/config.json", mcp: { doc2dpp: { type: "remote", url, enabled: true } } };
  return { mcpServers: { doc2dpp: { url } } };
}

const json = (o: object) => JSON.stringify(o, null, 2);

/** What to paste, in order; each block gets its own Copy button. */
export function setup(harness: Harness, url: string): { label: string; text: string }[] {
  switch (harness) {
    case "claude-code":
      return [{ label: "Run in your project", text: `claude mcp add --transport http doc2dpp ${url}` }];
    case "opencode":
      return [{ label: "opencode.json in the project root (or run `opencode mcp add`, interactive)", text: json(configFile("opencode", url)) }];
    case "pi":
      return [
        { label: "Pi 1.0+, native MCP: run once", text: `pi mcp add doc2dpp --url ${url}` },
        { label: "or put this in .pi/mcp.json (project, after you trust it) or ~/.pi/agent/mcp.json", text: json(configFile("pi", url)) },
      ];
    case "other":
      return [{ label: "MCP server URL (streamable HTTP)", text: url }];
  }
}

/** A role's starter prompt (agents/worker-prompt.md or agents/operator-prompt.md) with the Worker id filled in. */
export const starterPrompt = (template: string, workerId: string) => template.replaceAll("WORKER_ID", workerId);
