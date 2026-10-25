// Print a harness's MCP config for any Job Board, so no config has to hard-code a URL.
//   npx tsx scripts/agent-config.ts claude-code|opencode|pi [baseUrl]   (default $BASE_URL, else http://127.0.0.1:3100)
//   claude --mcp-config "$(npx tsx scripts/agent-config.ts claude-code https://doc2dpp.wisecraft.dev)"
//   npx tsx scripts/agent-config.ts opencode https://doc2dpp.wisecraft.dev > opencode.json
import { configFile, mcpUrl } from "../src/connect.js";

const [harness, base = process.env.BASE_URL ?? "http://127.0.0.1:3100"] = process.argv.slice(2);
if (harness !== "claude-code" && harness !== "opencode" && harness !== "pi") {
  console.error("usage: agent-config.ts claude-code|opencode|pi [baseUrl]");
  process.exit(1);
}
console.log(JSON.stringify(configFile(harness, mcpUrl(base)), null, 2));
