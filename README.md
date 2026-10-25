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
`CHALLENGE_WINDOW_MIN` sets the Challenge Window length (default 5 minutes).

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

## Ledger on Stellar testnet

Two adapters implement the `Ledger` interface (`src/ledger.ts`):

- `src/ledger/trustless-work.ts`: one Trustless Work multi-release escrow per (Document, Operator), one milestone
  of Bond + Fee, output hash in the milestone. Operator = service provider, Brand = approver, Arbiter = release
  signer and dispute resolver. Clean settle = mark done, approve, release. Slashed settle = dispute, resolve with
  the Slashes to the Brand and the rest to the Operator. Requests are spaced 1.3 s apart (under the 50/min limit).
- `src/ledger/stellar-payments.ts`: the fallback. The Job Board holds one escrow account; Bond and Fee are paid in
  and paid out as plain USDC payments with the output hash in the memo. Trust sits with the Job Board.

**Decision: pending.** Trustless Work or the fallback is decided by Artur's 30-minute spike with a real API key.
The fallback has run end to end on testnet; the Trustless Work adapter is tested only against a mocked API.

### Setup

1. Wallets, XLM, USDC trustlines and 20 testnet USDC each for Brand and both Operators (bought on the testnet DEX):
   `npx tsx scripts/setup-wallets.ts`. Secrets go to `.env` (gitignored). Safe to run again. If the DEX buy fails,
   get USDC at https://faucet.circle.com (Stellar Testnet, paste the address printed by the script).
2. Trustless Work API key: open https://dapp.trustlesswork.com, connect a Stellar wallet (Freighter), go to Settings,
   fill in your profile (the use case field is required), then API Keys > Testnet > Request. The key is shown once.
   Add `TW_API_KEY=...` to `.env`.

### Smoke test

```bash
LEDGER=trustless-work npx tsx scripts/smoke-ledger.ts   # needs TW_API_KEY
LEDGER=payments       npx tsx scripts/smoke-ledger.ts   # plain-payments fallback
```

It opens two escrows, settles one clean and one with a Slash, and prints stellar.expert links.

Check in the Trustless Work spike: `milestoneIndex` "0" vs "1"; that signing each XDR as the role's account is
enough (no separate Soroban auth entries); that one address may be both release signer and dispute resolver; the
0.3% fee on testnet. If the testnet resets, run the setup script again.
