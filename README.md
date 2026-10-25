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
| Trustless Work escrow (Bond + Fee, output hash in the milestone) | https://stellar.expert/explorer/testnet/contract/CA37O2SCL37MV2GGULIUCKPT7M7DJW73UCWG762A3W3KIELQ3VZJ4EC2 |
| Trustless Work clean settle (release to the Operator) | https://stellar.expert/explorer/testnet/tx/a0be21690885e29fc329bf351caeef1c834031ddc6f79c7c55490d33d45dc923 |
| Trustless Work Slashed escrow | https://stellar.expert/explorer/testnet/contract/CAMNN6FN5RUHJJRIGWXYS7LHLJ4QBKWA3MNHWMZD4WK7MC5MRP5WEXXQ |
| Trustless Work Slashed settle (resolve: the Slash to the Brand, the rest to the Operator) | https://stellar.expert/explorer/testnet/tx/918d8b13f9261aeb1de84e738e4c92e27d91ce5563cebdc5ff278a811d0e3213 |

The demo wallets (Brand, our Operator, the Baseline's Operator, Arbiter, fallback escrow account) are testnet
accounts the Job Board holds. In a real product the Brand never holds crypto.

## Accuracy report

Runs our Pipeline and the Baseline over `testdata/documents` and compares the delivered Field values with
`testdata/expected` (Correct = equal after the same normalising as convergence; Not stated against Not stated is
Correct). It prints, per Pipeline and its Operator, the share of Correct Fields, the number of Fields, the number Not stated, and each
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
  out as plain USDC payments with the output hash in the memo, one payment per Slash. Trust sits with the Job Board.

The leaderboard reads each Operator's record through the Ledger. The fallback rebuilds it from the escrow account's
payment history on Horizon, so it is read from Stellar. The Trustless Work adapter keeps it in memory for now: its
escrow query endpoints hold milestone flags, not the dispute split, so they can't give the Slashes.

**Decision: Trustless Work.** The spike on 25 Oct 2026 ran both settlements end to end on testnet on the first try
(links above), so the fallback is not needed. It stays as a working backup (`LEDGER=payments`).

What the spike settled:

- `milestoneIndex` is `"0"`. Signing each returned XDR as the role's account is enough; no separate Soroban auth
  entries. The Arbiter can be both release signer and dispute resolver.
- Resolve accepts the gross split (Slashes plus the rest, adding up to Bond + Fee).
- **Trustless Work takes 0.3% on testnet too**, from every release and every resolve. On a 2.5 USDC escrow, 0.0075
  went to Trustless Work. With a 0.75 Slash the Brand received 0.74775 and the Operator 1.74475. So the Brand gets
  the Slash minus 0.3%, not the full Slash as issue #1 says. To pay the Brand the full Slash, the Operator's share
  would have to cover the fee; that is not done yet.

### Challenge Deposit and Arbiter Fee

Anyone with a Stellar address can file a Challenge by locking a Challenge Deposit (`CHALLENGE_DEPOSIT`, default 1
USDC). The Arbiter earns the Arbiter Fee (`ARBITER_FEE`, default 0.1 USDC, never more than the Slash), always paid by
the losing side. Settlement pays out two pots, and each pays out exactly what it holds (`settlement()` in `src/ledger.ts`):

| Pot | Holds | Upheld Challenge | Rejected Challenge |
|---|---|---|---|
| Trustless Work escrow | Bond + Fee | Brand: Slash − Arbiter Fee; Arbiter: Arbiter Fee; Operator: the rest | Operator: all of it |
| Deposit account | the Deposits | back to the challenger | to the Arbiter |

- **Where the Deposit sits: the deposit account, not the escrow.** It is the `ESCROW` wallet, held by the Job Board.
  A v1 multi-release resolve pays out exactly the milestone amount, which is fixed at deploy to Bond + Fee. A
  Deposit funded into the contract later could never be paid out, and the number of Challenges is not known at deploy.
  A Deposit is a plain USDC payment with the escrow's output hash in the memo, so it is on Stellar next to the escrow.
- **The 0.3% fee:** the escrow split is gross and adds up to Bond + Fee exactly. Trustless Work takes 0.3% out of each
  share, so the Brand, the Arbiter and the Operator each get 99.7% of theirs. Deposits never touch the contract and are
  paid back, or to the Arbiter, in full.
- A Challenge with no upheld Slash still settles through the deposit account (the Deposits go to the Arbiter), then a
  clean release of Bond + Fee to the Operator.
- **Who signs the Deposit.** The Job Board holds the Brand's key and signs its Deposit. Any other challenger signs its
  own: `POST /api/documents/:id/challenges/deposit { challenger }` returns an unsigned payment, the challenger signs it
  and files the Challenge with `{ ..., challenger, depositXdr }`. Only a transaction handed out by that call is
  accepted (checked by its hash). With no Deposit locked, the Challenge is refused with 402.

Verified on testnet on 25 Oct 2026 (`scripts/smoke-ledger.ts`): two Brand Deposits locked, one upheld and one
rejected, the Deposits paid back and to the Arbiter, then a three-way resolve to the Brand, Arbiter and Operator. An
outside wallet's self-signed Deposit was locked and returned the same way.

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

If the testnet resets, run the setup script again.
