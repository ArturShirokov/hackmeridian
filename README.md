# Bonded document-to-passport Pipeline on Stellar

HackMeridian 2026. Supplier PDFs go in, structured Digital Product Passport data comes out, and every delivered
Document has money behind it: a Bond in testnet USDC on Stellar that pays the Brand when a Field is wrong.
Terms (Brand, Field, Sieve, Bond, Slash and so on) are defined in [GLOSSARY.md](GLOSSARY.md).

![Demo GIF: upload, side-by-side, Challenge, Slash, leaderboard](docs/demo.gif)

> **Demo GIF: placeholder.** `docs/demo.gif` is recorded from the demo replay (see [docs/demo.md](docs/demo.md)).

**Accuracy: X% Correct on N Fields** (our Pipeline, on the six test Documents in `testdata/`). Placeholder until the
live run with real Workers; the number is the measured one, not a target.

## The problem

A Brand that sells batteries or textiles in the EU must publish a Digital Product Passport for every product. The
data comes from Suppliers as spec sheets, test reports and certificates, each in its own layout. Today someone at the
Brand retypes them by hand. That is slow and error-prone, and nobody downstream knows how far to trust the result. AI
extraction tools exist, but when a value is wrong the Brand carries the cost and often finds out from an auditor.

## How it works

1. The Brand uploads a Supplier's PDF and picks a Template (battery or textile).
2. Our Pipeline turns the Document into Field values. It is a chain of independent Sieves, each a different view of
   the Document read by a different AI Worker: extract from the original PDF, turn it into Markdown, check the
   Markdown against the original, extract again from the checked Markdown. Where the two extractions disagree, a
   third Worker breaks the tie. A Field that still has no clear answer comes back as **Not stated**, with the quotes
   as evidence, and becomes a Supplier Request instead of a guess.
3. On delivery the Operator locks a Bond, and the Brand a Fee, in escrow on Stellar. The escrow holds a hash of the
   delivered values, so the output cannot change quietly afterwards.
4. During the Challenge Window anyone can Challenge a Field by citing the page and the words of the Document that
   say otherwise. A neutral Arbiter decides. Each upheld Challenge Slashes a tenth of the Bond to the Brand.
5. When the window closes, the escrow settles on its own: the Operator gets the Fee and what is left of the Bond.

"Correct" means matching what the Document states under the Template's rules, so every Challenge can be decided from
the Document alone. For the demo, a one-pass **Baseline** runs next to our Pipeline on the same Documents, under its
own Operator and Bond. A leaderboard shows each Operator's Documents, upheld Challenges and total Slashed.

> The Bond doesn't make the model careful. It makes careless Pipelines expensive to run, and their error rate public.

## Run it

```bash
npm install
npm start          # Brand page at http://127.0.0.1:3000/, MCP endpoint at http://127.0.0.1:3000/mcp
npm test
npm run typecheck
```

Set `HOST=0.0.0.0` and `BASE_URL=http://<your-ip>:3000` to let Workers on other machines connect.
`CHALLENGE_WINDOW_MIN` sets the Challenge Window (default 5 minutes). `LEDGER=fake|payments|trustless-work` picks
the Ledger (default `fake`, nothing on chain); the Stellar ones read the testnet keys from `.env` (see
[Wallets](#wallets)), and the Document page then links the escrow and its settlement on stellar.expert. Pages: `/` (upload and Documents),
`/documents/<id>` (Pipeline and Baseline side by side), `/arbiter`, `/leaderboard`.

### Demo replay: no models, no network

```bash
npm run demo       # replays testdata/runs/scripted-demo.json on http://127.0.0.1:3000/
```

This starts the web app with the fake Ledger and replays a cached run, so all six test Documents arrive already
delivered by both Pipelines. The Brand page, the side-by-side view, a Challenge, the Arbiter page and the leaderboard
all work offline. The Challenge Window is 3 minutes in demo mode (`CHALLENGE_WINDOW_MIN` changes it); the leaderboard
counts a Slash once the window closes and the escrow settles.

> **The current cache is scripted, not a live run.** `testdata/runs/scripted-demo.json` comes from
> `scripts/scripted-run.ts`: scripted Workers hand in the expected values from `testdata/expected`, and the Baseline's
> Worker takes the planted error on battery-04 (16 % recycled lithium, the 2031 roadmap target, instead of the 6 %
> this lot has). Replace it with a live run cache: `DEMO_REPLAY=testdata/runs/<timestamp>.json npm run demo`.

Replaying a live cache adds the run's length to every Challenge Window, so each Document has at least the full window
left when the demo starts.

## Connect a Worker

A Worker is any AI session that speaks MCP. It connects to the Job Board over streamable HTTP at
`http://127.0.0.1:3000/mcp` and uses two tools:

- `next_job { worker }` returns a Job (Document link and text layer, the Markdown when the Sieve reads it,
  Sieve kind, instructions, Template Fields) or `{ job: null }` when there is nothing yet.
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

Use a different id for every session. The Job Board uses it to keep Sieves independent: a Worker does at most one
extraction Sieve (or tie-break) per Document, across both Pipelines. A live run with our Pipeline and the Baseline
needs at least four distinct Workers: two for our extraction Sieves, one for our tie-break, one for the Baseline.

## Testnet transactions

Every link opens on stellar.expert (Stellar testnet).

| What | Link |
|---|---|
| Plain-payments fallback: a transaction from the smoke run (`LEDGER=payments npx tsx scripts/smoke-ledger.ts`) | https://stellar.expert/explorer/testnet/tx/6e3015f7a996196b533659944a3d813edf68d281eedeaee5a9e2569b77a600fa |
| Trustless Work escrow (Bond + Fee, output hash in the milestone) | _TODO: link from `LEDGER=trustless-work npx tsx scripts/smoke-ledger.ts`_ |
| Trustless Work clean settle (approve, release) | _TODO_ |
| Trustless Work Slashed settle (dispute, resolve with the Slash to the Brand) | _TODO_ |

The demo wallets (Brand, our Operator, the Baseline's Operator, Arbiter, fallback escrow account) are testnet
accounts the Job Board holds. In a real product the Brand never holds crypto.

## Accuracy report

Runs our Pipeline and the Baseline over `testdata/documents` and compares the delivered Field values with
`testdata/expected` (Correct = equal after the same normalising as convergence; Not stated against Not stated is
Correct). It prints, per Operator, the share of Correct Fields, the number of Fields, the number Not stated, and each
incorrect Field.

**Live run, with real Workers:**

```bash
npx tsx scripts/accuracy.ts      # its own Job Board (fake Ledger, in-memory Storage) on port 3000; stop npm start first
```

It uploads every test Document under both Operators and serves MCP at `http://127.0.0.1:3000/mcp`. Connect at least
four distinct Workers as in [Connect a Worker](#connect-a-worker). The script prints the report when every Document is
delivered by both Pipelines; Ctrl+C reports on what is delivered so far. Every Job taken and every accepted
submission is written as it happens to `testdata/runs/<timestamp>.json`, which is also a demo replay cache.

**Replay a cached run:**

```bash
npx tsx scripts/accuracy.ts --replay testdata/runs/<timestamp>.json
```

The replay feeds the same takes and submissions through a fresh Job Board, so it reports what the live run delivered.
After `testdata/expected` changes, the replay scores the same run against the new values.

## Ledger on Stellar testnet

Two adapters implement the `Ledger` interface (`src/ledger.ts`):

- `src/ledger/trustless-work.ts`: one Trustless Work multi-release escrow per (Document, Operator), one milestone of
  Bond + Fee, output hash in the milestone. Operator = service provider, Brand = approver, Arbiter = release signer
  and dispute resolver. Clean settle = mark done, approve, release. Slashed settle = dispute, then resolve with the
  Slashes to the Brand and the rest to the Operator. Requests are spaced 1.3 s apart (under the 50 a minute limit).
- `src/ledger/stellar-payments.ts`: the fallback. The Job Board holds one escrow account; Bond and Fee are paid in and
  out as plain USDC payments with the output hash in the memo. Trust sits with the Job Board.

**Decision: pending.** Trustless Work or the fallback is decided by Artur's 30-minute spike with a real API key. The
fallback has run end to end on testnet; the Trustless Work adapter is tested only against a mocked API.

### Wallets

1. Create the wallets, fund them with XLM, add USDC trustlines and buy 20 testnet USDC each for the Brand and both
   Operators on the testnet DEX: `npx tsx scripts/setup-wallets.ts`. Secrets go to `.env` (gitignored). Safe to run
   again. If the DEX buy fails, get USDC at https://faucet.circle.com (Stellar Testnet, paste the printed address).
2. Before a demo, top them up: `npx tsx scripts/topup-wallets.ts`. It reads the keys from `.env` (or `ENV_FILE`),
   gives any wallet under 1,000 XLM another 10,000 from friendbot, and buys USDC on the DEX up to `USDC_EACH`
   (default 20) for the Brand and both Operators. It prints addresses and balances, never secrets.
3. Trustless Work API key: open https://dapp.trustlesswork.com, connect a Stellar wallet (Freighter), go to Settings,
   fill in your profile (the use case field is required), then API Keys > Testnet > Request. The key is shown once.
   Add `TW_API_KEY=...` to `.env`.

### Smoke test

```bash
LEDGER=trustless-work npx tsx scripts/smoke-ledger.ts   # needs TW_API_KEY
LEDGER=payments       npx tsx scripts/smoke-ledger.ts   # plain-payments fallback
```

It opens two escrows, settles one clean and one with a Slash, and prints stellar.expert links.

Check in the Trustless Work spike: `milestoneIndex` "0" vs "1"; that signing each XDR as the role's account is enough
(no separate Soroban auth entries); that one address may be both release signer and dispute resolver; the 0.3% fee on
testnet. If the testnet resets, run the setup script again.
