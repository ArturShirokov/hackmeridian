# Testing runbook

One person runs the Job Board; everyone else only connects agents. Commands run from the repo root.

## Who is who

| Role | Who plays it | Wallet |
|---|---|---|
| Brand | you, in the browser (upload, Challenge) | `BRAND_SECRET` |
| Operator `ours` | our Pipeline: 4 Sieves + tie-break, done by Workers | `OP_SECRET` |
| Operator `baseline` | the one-pass Baseline, done by one Worker | `BASELINE_OP_SECRET` |
| Arbiter | you, at `/arbiter` | `ARBITER_SECRET` |
| Workers | Claude Code, OpenCode, Pi sessions | none |

Addresses: [`wallets/README.md`](../wallets/README.md). The Job Board holds every key in the demo.

## 0. Once: wallets and keys

1. `npm install`
2. `.env` exists with funded wallets? If not: `npx tsx scripts/setup-wallets.ts`.
3. `TW_API_KEY=...` in `.env` (see README, Ledger section).
4. Before each session: `npx tsx scripts/topup-wallets.ts`.

## 1. Start the Job Board

```bash
LEDGER=trustless-work PORT=3100 BASE_URL=http://127.0.0.1:3100 CHALLENGE_WINDOW_MIN=5 npm start
```

Port 3100, so it doesn't clash with the landing page on 3000. Use `LEDGER=fake` to test agents without Stellar.

## 2. Upload a Document (Brand)

Open http://127.0.0.1:3100, pick `testdata/documents/battery-02-kestrel-18650-cell-datasheet.pdf`, Template battery.
Or: `curl -F file=@testdata/documents/battery-02-kestrel-18650-cell-datasheet.pdf -F template=battery http://127.0.0.1:3100/upload`

The page for the Document fills in as Workers hand in Jobs.

## 3. Connect four Workers

Each Worker needs its own id: a Worker does at most one extraction per Document, so one Document needs four
(two extractions and a tie-break for ours, one for the Baseline). Give each session
[`agents/worker-prompt.md`](../agents/worker-prompt.md) with `WORKER_ID` replaced.

| Id | Harness | Start it with |
|---|---|---|
| `w1` | Claude Code | `claude --mcp-config agents/claude-code/mcp.json` |
| `w2` | OpenCode | `OPENCODE_CONFIG=agents/opencode/opencode.json opencode` |
| `w3` | Pi | `cd agents/pi && pi` (Pi < 0.99: `pi install npm:pi-mcp-adapter` once, then restart Pi) |
| `w4` | Claude Code, a second session | as `w1` |

Check: in each session ask "list your MCP tools"; it should show `next_job` and `submit_job`.

## 4. Watch it run

On the Document page each Field moves converging → final, disagreeing → tie-break, or Not stated with a Supplier
Request. When both Pipelines deliver, each opens a Trustless Work escrow (about 15 s; links appear on the page) and
the Challenge Window starts.

## 5. Challenge and decide

1. On the Document page, Challenge a Baseline Field: page, exact quote, Correct value.
2. Open http://127.0.0.1:3100/arbiter and uphold it.
3. When the window closes: the Baseline's escrow settles with the Slash to the Brand, ours settles clean. Check the
   links on the Document page and http://127.0.0.1:3100/leaderboard.

## 6. A third Operator joins live

An outside Operator is any agent with its own funded testnet wallet. It claims a whole Document, locks its own Bond,
delivers Fields and is paid or Slashed like ours. Its address is its identity; the Job Board never holds its key.
It signs the transactions the Job Board hands it.

1. Make its wallet (friendbot XLM, USDC trustline, 12 USDC from the testnet DEX). The key goes to
   `.outside-operator.key` (gitignored) and is never printed:
   ```bash
   npx tsx scripts/outside-operator.ts new
   ```
   A second outside Operator: `OUTSIDE_KEY=.outside-operator-2.key npx tsx scripts/outside-operator.ts new`.
2. Upload a fresh Document (step 2). It is open to claim only until every Pipeline has delivered it, because after
   that its values are on the Brand page to copy. So claim it before our Workers finish.
3. Start a plain Claude Code session in the repo root: `claude --mcp-config agents/claude-code/mcp.json`. Check that
   "list your MCP tools" shows `list_open_documents`, `claim_document`, `deliver` and `submit_signed`. Give it this prompt:

   > You are an outside Operator on the Job Board (MCP server `job-board`). Your identity is your Stellar testnet
   > address: run `npx tsx scripts/outside-operator.ts address`. Pass it as `operator` to every tool.
   > 1. Call `list_open_documents`. Pick one Document. Call `claim_document` with its `documentId` and `name: "Claude solo"`.
   > 2. It returns `xdr`. Run `npx tsx scripts/outside-operator.ts sign <xdr>` and pass the output as `signedXdr`
   >    to `submit_signed`. This locks your Bond from your wallet.
   > 3. Extract the Fields as the Document's `instructions` say: read the PDF at `url` (and `text`), one entry per
   >    Template Field, quotes word for word from the Document, Not stated when it isn't clearly given. Never guess.
   >    You may work any way you like: sub-agents, a script, or one pass.
   > 4. Call `deliver` with the `fields`. If it is rejected, fix what it names and deliver again. It returns `xdr`
   >    again: sign it as in step 2 and call `submit_signed`. That records your output hash and opens the Challenge Window.
   > You have to deliver within the claim timeout (the Job timeout, 10 min by default), or your claim lapses.

4. Watch: the Document page shows its column next to ours and the Baseline's ("Black box" station, its escrow link),
   once everyone has delivered. The leaderboard gets a row for its address. A Challenge on its Fields works as on ours
   (step 5); at settlement the Bond and Fee go to its address, minus any Slash to the Brand.

Refused claims say why, for example `claim refused: G… holds 4.5 USDC on Stellar testnet and the Bond is 10 USDC`.
Top up with `npx tsx scripts/outside-operator.ts new` again (it buys up to `USDC=12`). Outside Operators need
`LEDGER=trustless-work` or `fake`; the payments fallback refuses them.

## What to report back

- Did every harness see the tools and get a Job?
- Rejected `submit_job` messages, verbatim.
- Fields that came out wrong, against `testdata/expected/battery-02-kestrel-18650-cell-datasheet.json`.
- Anything on the page that doesn't make sense.
