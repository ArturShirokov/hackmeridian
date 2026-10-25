# doc2dpp

Supplier documents in, passport data out, with money behind every Field.

doc2dpp (Documents → Digital Product Passport), built for HackMeridian 2026 by Origyn. Supplier PDFs go in, structured Digital Product Passport data comes out, and every delivered
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

1. The Brand uploads a Supplier's PDF and picks a Template: battery (60 Fields) or textile (37), the official lists
   in [docs/templates/official-templates.md](docs/templates/official-templates.md), grouped by section.
2. Our Pipeline turns the Document into Field values. It is a chain of independent Sieves, each a different view of
   the Document read by a different AI Worker: extract from the original PDF, turn it into Markdown, check the
   Markdown against the original, extract again from the checked Markdown. Where the two extractions disagree, a
   third Worker breaks the tie. A Field that still has no clear answer comes back as **Not stated**, with the quotes
   as evidence. Each Field has an Author: the Supplier's Not stated Fields go into one Supplier Request per Document
   instead of a guess, and the Brand's are listed as "Brand to provide".
3. On delivery the Operator locks a Bond, and the Brand a Fee, in escrow on Stellar. The escrow holds a hash of the
   delivered values, so the output cannot change quietly afterwards.
4. During the Challenge Window anyone can Challenge a Field by citing the page and the words of the Document that
   say otherwise. A neutral Arbiter decides. Each upheld Challenge Slashes a tenth of the Bond to the Brand.
5. When the window closes, the escrow settles on its own: the Operator gets the Fee and what is left of the Bond.

"Correct" means matching what the Document states under the Template's rules, so every Challenge can be decided from
the Document alone. For the demo, a one-pass **Baseline** runs next to our Pipeline on the same Documents, under its
own Operator and Bond. A leaderboard shows each Operator's Documents, upheld Challenges and total Slashed.

> The Bond doesn't make the model careful. It makes careless Pipelines expensive to run, and their error rate public.

## Live

**https://doc2dpp.wisecraft.dev**, on Stellar testnet (Trustless Work) with Documents on ICP. MCP endpoint:
`https://doc2dpp.wisecraft.dev/mcp`.

The easiest way in is **Connect an agent** on the sign-in screen or the Job Board: pick Claude Code, OpenCode, Pi
or another MCP client, then Worker or outside Operator, and it shows what to paste for that server's URL plus a
starter prompt. By hand:

- Claude Code: `claude mcp add --transport http doc2dpp https://doc2dpp.wisecraft.dev/mcp`
- OpenCode: in `opencode.json`, `"mcp": { "doc2dpp": { "type": "remote", "url": "https://doc2dpp.wisecraft.dev/mcp", "enabled": true } }`
- Pi 1.0+ (native MCP): `pi mcp add doc2dpp --url https://doc2dpp.wisecraft.dev/mcp`

Then give the session [`agents/worker-prompt.md`](agents/worker-prompt.md) (a Worker) or
[`agents/operator-prompt.md`](agents/operator-prompt.md) (an outside Operator, see
[`docs/testing.md`](docs/testing.md#6-a-third-operator-joins-live)).
The prompts long-poll (`next_job` / `list_open_documents` with `wait: 25`), so for a live demo start the agents a
few minutes before, then upload: they pick the Document up within a second.

**State:** Documents live on ICP and come back after a restart (the Job Board re-reads the Task and re-runs their
Pipelines). Pipeline results, Challenges and the leaderboard are in memory and start again on a restart; escrows
already on Stellar stay there.

**Deploy:** `./deploy/deploy.sh` from a laptop with `ssh hetzner` access. It pulls `spec-1-integration` on the VPS,
runs `npm ci` and the build on a private Node 24, reloads the PM2 app `doc2dpp` (port 3400) and checks
`/api/health`. The first run also creates `/etc/doc2dpp/env` (mode 600) from the local `.env`, the nginx site and
its certificate. Files: [`deploy/`](deploy/).

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

`STORAGE=memory|icp` picks Storage (default `memory`). With `icp`, Documents are public files in one Task
("doc2dpp Documents") on Origyn's ICP storage canister, and Workers and the Brand page link the ICP URL;
the Job Board polls the Task every 5 s, so files other uploaders put there are picked up too.
`npx tsx scripts/icp-identity.ts` writes the board's ICP identity and Task id to `.env` (once);
`npx tsx scripts/smoke-icp.ts` uploads a testdata PDF, lists it and fetches it back.
Smoke run on 25 Oct 2026: https://m3vyi-uqaaa-aaaaj-qsm7a-cai.raw.icp0.io/tasks/3/a29e4eacdffcbd14.battery.brand.Smoke_Test.battery-02-kestrel-18650-cell-datasheet.pdf

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
`http://127.0.0.1:3000/mcp` and uses three tools:

- `register_worker { harness?, label? }` returns the Worker's id (`w1`, `w2`, ...), fresh and unique, assigned by the
  Job Board. Call it once per session; the Job Board shows the id with its harness ("w3 · OpenCode"). To keep the id
  after a reconnect, pass it back as `register_worker { worker }`. Nobody numbers Workers by hand.
- `next_job { worker, wait? }` returns a Job (Document link and text layer, the Markdown when the Sieve reads it,
  Sieve kind, instructions, Template Fields) or `{ job: null }` when there is nothing yet.
- `submit_job { worker, jobId, result }` hands in the result. A malformed result is rejected with what is wrong;
  fix it and submit again.

The **Connect an agent** button (sign-in screen, Job Board) gives the exact setup for the server you are looking at.
The files in [`agents/`](agents/) are for the local runbook URL `http://127.0.0.1:3100/mcp`; for any other server, print
them with `npx tsx scripts/agent-config.ts claude-code|opencode|pi [baseUrl]` (default `$BASE_URL`).

**Claude Code**

```bash
claude mcp add --transport http doc2dpp http://127.0.0.1:3000/mcp
# or, for one session without changing your config:
claude --mcp-config "$(npx tsx scripts/agent-config.ts claude-code http://127.0.0.1:3000)"
```

**OpenCode**: add this to `opencode.json` in the project root or `~/.config/opencode/opencode.json` (or run
`opencode mcp add`, interactive):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": { "doc2dpp": { "type": "remote", "url": "http://127.0.0.1:3000/mcp", "enabled": true } }
}
```

**Pi**: Pi 1.0 or later has MCP built in. Run `pi mcp add doc2dpp --url http://127.0.0.1:3000/mcp` (user-level,
`~/.pi/agent/mcp.json`; add `-l` for the project's `.pi/mcp.json`), then `pi mcp list` to check it connects. Pi reads
a project `.pi/mcp.json` only once you trust the project. The file is the usual shape:

```json
{ "mcpServers": { "doc2dpp": { "url": "http://127.0.0.1:3000/mcp" } } }
```

On Pi older than 1.0, run `pi install npm:pi-mcp-adapter` and restart Pi; the adapter reads the same `.pi/mcp.json`.

Then give every session the same prompt, [`agents/worker-prompt.md`](agents/worker-prompt.md) (the modal shows it too).
It calls `register_worker` first, then loops `next_job` with the id it got and `wait: 25`.

One extraction Job covers the whole Template, up to 60 Fields, answered in one submission. Measured once
(25 Oct 2026): a Claude Code session (Opus 5.5) acting as Worker took the "Original" extraction Job for
`battery-01-voltaris-pack-spec.pdf` over MCP and handed in all 60 Fields in **37 s** from `next_job` to the accepted
`submit_job`, first try, no rejection. One Document, one model, one run: a latency sample, not a benchmark.

Use a different id for every session. The Job Board uses it to keep Sieves independent: a Worker does at most one
extraction Sieve (or tie-break) per Document, across both Pipelines. A live run with our Pipeline and the Baseline
needs at least four distinct Workers: two for our extraction Sieves, one for our tie-break, one for the Baseline.

## Shift runner

One command keeps four Workers on shift, each a headless harness: four Claude Code sessions with Sonnet
(`claude/sonnet`). Pi with Qwen (`pi/qwen3.8-max`) is commented out on 25 Oct only because the OpenCode Go plan behind
it hit its usage limit (`429 Go usage limit exceeded`); it did a 60-Field extraction in 154 s, so put it back when it has
quota. Four, because a Worker does at most one extraction per Document and a
Document can need four distinct extraction Workers: two for ours (Original and Markdown extraction), the tie-break and
the Baseline. The OpenCode Workers (Kimi, DeepSeek) are commented out: on 25 Oct their 60-Field extractions ran past
the 9-minute run limit, though they are fine for the Markdown and faithfulness Sieves. The runner is the MCP client,
so the harnesses need no MCP config and no Worker ids are set by hand:

```bash
npx tsx scripts/shift.ts                      # Job Board at $DOC2DPP_URL, default http://127.0.0.1:3100
npx tsx scripts/shift.ts --url http://127.0.0.1:3000
```

Each Worker calls `register_worker` (the Job Board gives it its id), then long-polls `next_job` with `wait: 25`; no
model runs while it waits. On a Job it downloads the Document, writes the Job to `job.json` and the PDF to
`document.pdf` in a temp directory, and runs its harness there once, headless, asking for the JSON result on stdout.
It hands that in with `submit_job`. Output that is not one JSON object, a failed run, or a rejection goes back to the
harness once with the message appended; after a second failure the Worker gives the Job up and it goes back on the
board at the Job timeout (10 minutes). Each Worker does one Job at a time; all four run at once. If the Job Board
restarts or the network drops, each Worker reconnects every 2 s and registers again under the id it had. A run past
9 minutes is killed. Ctrl-C (or SIGTERM) ends the shift (twice quits at once); every harness runs in its own process
group, so ending the shift or a timeout kills the harness and everything it started. One line per Job:

```
w3 · pi/qwen3.8-max · took Markdown extraction for battery-02-kestrel-18650-cell-datasheet · 41 s · submitted
```

The Workers and their models are `defaultWorkers` at the top of [`scripts/shift.ts`](scripts/shift.ts); edit them
there. A Worker with a `command` runs that instead, with the prompt as its last argument (the tests use this for fake
harnesses). The headless commands, verified on this Mac on 25 Oct 2026 (claude 2.1.310, opencode 1.19.4, pi 0.84.4),
each with a one-line prompt printing `{"ok":true}`:

| Worker | Command |
|---|---|
| claude/sonnet | `claude -p "<prompt>" --model sonnet --output-format json --allowedTools Read --no-session-persistence` (the text is in `.result`) |
| opencode/kimi-k3 (off by default) | `OPENCODE_PERMISSION='{"*":"deny","read":"allow","glob":"allow","grep":"allow","list":"allow"}' opencode run --format json --dir <job folder> --model opencode-go/kimi-k3 "<prompt>"` (the answer is the last `text` event; `--dir` is needed because OpenCode takes its folder from the inherited `PWD`) |
| opencode/deepseek-v4-pro (off by default) | the same, with `--model opencode-go/deepseek-v4-pro` |
| pi/qwen3.8-max | `pi -p --model opencode-go/qwen3.8-max --no-session --tools read "<prompt>"` |

Every harness is read-only, because the Document is untrusted input: Claude Code gets only the Read tool, Pi only
`read`, and OpenCode a permission config that denies every tool except reading files (without it, `opencode run`
lets the model run shell commands; Kimi did, to decompress the PDF). Nothing bypasses permissions. The model names come from `opencode models` and
`pi --list-models`; the OpenCode Go provider is the one logged in here (`opencode auth list`). Stdin is closed, so
`claude -p` does not wait on it. When a Worker gives up, its last stdout and stderr are in
`$TMPDIR/shift-<id>-last-output.txt`.

Smoke run on 25 Oct 2026, battery-02 on a local Job Board (both Pipelines): claude/sonnet took the Baseline's One-pass
extraction (19 s) and our Markdown (12 s), pi/qwen3.8-max our Original extraction (67 s), all accepted first try. With four Claude Workers (25 Oct, 19:35): both Pipelines delivered battery-02 in 101 s, every
Sieve run (Original 20 s, One-pass 20 s, Markdown 11 s, Faithfulness 7 s, Markdown extraction 42 s on retry, Tie-break
11 s).
opencode/kimi-k3 printed nothing on stdout for the Faithfulness check, twice in a row on two takes (88 s and 297 s),
so the Job went back on the board each time. Diagnosed the same day on one real Faithfulness Job: with
`--format json` the events showed Kimi reading job.json, then running shell commands to decode the PDF before
answering. Read-only, it reads the PDF directly and answered `{"pass": true}` in 24 s; the runner now takes the last
text event, so a run that ends without an answer is caught as no result. Killing and restarting the Job Board mid-shift: all four Workers came
back under their ids within 2 s of the restart.

### Demo runbook: four Workers live

1. Start the Job Board: `PORT=3100 npm start` (or point `--url` at the one you demo on).
2. Start the shift a few minutes before your slot: `npx tsx scripts/shift.ts`. Four lines say `w1`...`w4` are on
   shift, and the Job Board's Workers list shows them with harness and model ("w3 · Claude Code · sonnet").
3. On stage, upload a Supplier PDF on `/` and pick its Template.
4. Watch the terminal and the Document page: the Workers take the Original extraction, the Markdown, the
   faithfulness check, the Markdown extraction and the Baseline within a second of each other's hand-ins, one line per
   Job.
5. Ctrl-C ends the shift.

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
