# HackMeridian 2026: bonded document-to-passport Pipeline

A Brand uploads a Supplier's PDF Document and picks a Template. AI Workers connected to the Job Board turn it
into Field values. Terms are defined in [GLOSSARY.md](GLOSSARY.md).

## Run

```bash
npm install
npm start          # Brand page at http://127.0.0.1:3000/, MCP endpoint at http://127.0.0.1:3000/mcp
npm test           # Vitest
npm run typecheck
```

Set `HOST=0.0.0.0` and `BASE_URL=http://<your-ip>:3000` to let Workers on other machines connect.

## Connect a Worker

A Worker is any AI session that speaks MCP. It connects to the Job Board over streamable HTTP at
`http://127.0.0.1:3000/mcp` and uses two tools:

- `next_job { worker }` returns a Job (Document link and text layer, Sieve kind, instructions, Template Fields)
  or `{ job: null }` when there is nothing yet.
- `submit_job { worker, jobId, result }` hands in the result. A malformed result is rejected with what is wrong;
  fix it and submit again.

**Claude Code**

```bash
claude mcp add --transport http job-board http://127.0.0.1:3000/mcp
```

**OpenCode**: add this to `opencode.json` in the project root or `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": { "job-board": { "type": "remote", "url": "http://127.0.0.1:3000/mcp", "enabled": true } }
}
```

**Pi**: Pi 0.99 or later has MCP built in (`pi update self`, then `pi mcp add`). On older Pi, run
`pi install npm:pi-mcp-adapter`, restart Pi, and put this in `.mcp.json` in the project root:

```json
{ "mcpServers": { "job-board": { "url": "http://127.0.0.1:3000/mcp" } } }
```

Then give the session this prompt:

> You are Worker `<your-id>`. Call `next_job` with worker `<your-id>`. If there is no Job, wait 10 seconds and
> try again. Otherwise do the Job as its instructions say and hand it in with `submit_job`. Repeat.

Use a different id for every session. The Job Board uses it to keep Sieves independent.
