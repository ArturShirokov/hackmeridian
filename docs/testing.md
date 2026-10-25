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

## What to report back

- Did every harness see the tools and get a Job?
- Rejected `submit_job` messages, verbatim.
- Fields that came out wrong, against `testdata/expected/battery-02-kestrel-18650-cell-datasheet.json`.
- Anything on the page that doesn't make sense.
