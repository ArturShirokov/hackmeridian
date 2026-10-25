# HackMeridian submission texts

Paste-ready for the form. Numbers in here are measured (`npx tsx scripts/accuracy.ts --replay testdata/runs/scripted-demo.json`),
not targets: **100 % Correct on 314 Fields** for our Pipeline, Bond **10 USDC**, Fee **1 USDC**, Slash **1/10 of the Bond** per upheld Challenge.

---

## Project title

doc2dpp

## Tagline (≤120 chars)

Supplier documents in, passport data out — with a Bond in USDC behind every Field, slashed to the Brand if it's wrong.

(118 chars.)

## Description (≤8000 chars, markdown)

# doc2dpp

Supplier documents in, passport data out, with money behind every Field.

A Brand that sells batteries or textiles in the EU must publish a Digital Product Passport for every product. The data arrives from Suppliers as spec sheets, test reports and certificates, each in its own layout, and today someone retypes it by hand. AI extraction tools exist — but when a value is wrong, the Brand carries the cost and often finds out from an auditor. **doc2dpp turns those documents into passport data where every answer carries money: a Bond in testnet USDC on Stellar that pays the Brand when a Field is wrong.**

## How it works

1. **Upload.** The Brand drops a Supplier PDF on [doc2dpp.wisecraft.dev](https://doc2dpp.wisecraft.dev) and picks a Template — battery (60 Fields) or textile (37), the official EU lists grouped by section.
2. **The Pipeline.** A chain of independent Sieves, each a different AI Worker with a different view of the same Document: extract from the original PDF, turn it into Markdown, check the Markdown against the original, extract again from the checked Markdown. Where the two extractions disagree, a third Worker breaks the tie. Anything still unclear comes back as **Not stated**, with the quotes as evidence, and becomes a Supplier Request instead of a guess. Disagreement — not AI vibes — routes to review.
3. **The Bond.** On delivery the Operator locks a 10 USDC Bond, and the Brand pays a 1 USDC Fee, in escrow on Stellar (Trustless Work, Soroban). The escrow holds a hash of the delivered values, so the output cannot quietly change afterwards.
4. **The Challenge Window.** Anyone can Challenge a Field by citing the page and the words of the Document that say otherwise. A neutral Arbiter decides from the Document alone. Each upheld Challenge Slashes a tenth of the Bond to the Brand.
5. **Settle.** When the window closes, the escrow settles on its own: the Operator gets the Fee and what is left of the Bond.

## It is an open market, not our pipeline

Workers are ordinary AI sessions — Claude Code, OpenCode, Pi — connected to our Job Board over MCP. Any agent in the room can claim jobs and run its own Pipeline, under its own Operator name, with its own Bond. A one-pass Baseline Pipeline runs in the demo next to ours on the same Documents, with its own Operator and Bond. The leaderboard makes every Operator's error rate and slashing history public: a per-agent track record nobody has to trust us to keep.

## What we measured

- **100.0 % Correct (314 of 314 Fields)** for our Pipeline on the six test Documents in `testdata/`, against hand-labelled gold Fields.
- On one Document we planted a plausible error into the Baseline: it reported 16 % recycled lithium — the number printed large in the doc's own highlight box — but that is the 2031 roadmap target for the lot; page 2 gives 6 %. `6 %` is not an easily correctable downside if the Baseline's Field was wrong: we filed the Challenge with the page and quote, the Arbiter upheld it, and **1 USDC was Slashed to the Brand on testnet**, visible on stellar.expert.
- The demo is honest about this: the planted error is announced on stage and in the README. What is live, not staged: extraction, both Pipelines, escrow lock, hash, challenge, arbiter decision, slash, release, leaderboard.

The Bond doesn't make the model careful. It makes careless Pipelines expensive to run, and their error rate public.

## What is live and what is mocked

Live: PDF and Markdown Sieve chain with real Workers over MCP, escrow lock and settlement on Stellar testnet, Challenges decided by an Arbiter, slashed USDC on stellar.expert, documents on ICP. Mocked: Brands' procurement reality, real labs, third-party Operators — the escrow rules those would work under are implemented.

## Why Stellar

Escrow with automatic, rule-based settlement; fees in fractions of a cent per Field; every Bond, hash and Slash on a public ledger that doubles as each Operator's track record. Trustless Work's Soroban escrow API holds the Bond; the challenge-and-slash rules are ours, and `src/ledger/` runs three swap-in backends (`fake`, `payments`, `trustless-work`) behind one interface.

## Links

- Demo: https://doc2dpp.wisecraft.dev (Stellar testnet; MCP endpoint at `/mcp`; `npm run demo` runs it offline)
- Repository: https://github.com/ArturShirokov/hackmeridian
- Terms are defined in GLOSSARY.md; the challenge flow is in docs/demo.md

## Problem solved

Brands selling batteries or textiles in the EU must publish a Digital Product Passport per product. The data comes from Suppliers as PDFs — spec sheets, test reports, certificates — in every layout imaginable. Today someone at the Brand retypes each one by hand, and later, AI extraction tools are faster but nobody trusts them: when a delivered value is wrong, the Brand finds out from an auditor. doc2dpp helps by (1) extracting with a multi-view Sieve chain whose disagreements route to a third tie-breaking Worker and to a *Not stated* result with quotes rather than a guess, and (2) putting money behind every delivered Field — a Bond in escrow the Brand collects from when its Field is proven wrong. Trust does not have to be requested, it is priced.

## What was difficult to build and how we worked through it

- **Disagreement means real disagreement only if values are normalised.** Two Workers "agreeing" that 1.40 and 140 differ slightly kill the routing. We built the normalisation into the Sieve chain: values, units, number formats, multi-value cells.
- **Making the money mechanics real, not conceptual.** Soroban escrow that locks, holds a hash of delivered Fields, slashes a tenth per upheld Challenge and settles itself required wrapping Trustless Work's escrow in our rules; we kept one Ledger interface with three backends so testnet outages never stop the demo.
- **Arbiter incentives.** A rejected Challenge never pays the Arbiter out of nothing: the Arbiter's Fee is capped inside the slashed tenth of the Bond, so a wrong-everything Arbiter earns nothing (challenge-deposit and settlement tests cover the split).
- **Operators are untrusted parties.** Workers connect over MCP and long-poll the Job Board; Documents live on ICP and survive server restarts (the Job Board re-reads the Task and re-runs the Pipelines), while funds already in escrow stay on Stellar — coverage: long-poll delivery, restart, outside-Operator and timeout tests (25 Vitest suites).
- **Demo reality.** Latency, wifi and replay caching: a scripted replay runs the full UI offline (same routes, fake Ledger); `CHALLENGE_WINDOW_MIN` shrinks the Challenge Window to minutes so a Slash lands during the talk; the tie-break, timeout, long-poll, outside-operator challenges are now live demonstrations tested with real Workers.

## What's next

1. **Third-party Operators.** Open the Operator seat outside our own Pipelines; an outside Operator already joined live during testing (docs/testing.md §6), delivering rival Pipelines in the leaderboard.
2. **Turn "Not stated" into economics.** Supplier Requests priced per Field, so Suppliers fix their papers once and the Brand keeps its money.
3. **Per-field stakes, not per-document.** Field-level Bonds so the pricing follows the risk of a wrong answer, and the public track record per Field history.
4. **Custody and payments.** The escrow with automatic splitting stays on Stellar; the Brand-facing deposits settle through a licensed partner (the Brand already pays by invoice today, in euros — the chain stays invisible).
5. **Regulation.** EU battery passports from February 2027, textiles around 2029; the EU anti-greenwashing rules already apply (Directive 2024/825, from September 2026), so buyers need sourced evidence now.

## Tech stack (comma-separated)

TypeScript, Node.js, React, Hono, Stellar SDK, Soroban (Trustless Work escrow), MCP, ICP (Origyn), Vite, Vitest, pdfjs-dist

## Prior work disclosure

Built for HackMeridian during the build days. Pre-existing infrastructure: Origyn's production ICP storage canister (used as the Document store) and Origyn's DPP product context; the official battery (60) and textile (37) Templates are transcriptions of the official EU lists. The Pipeline, Sieve chain, escrow rules, Challenge flow, Job Board (MCP), web app, demo tooling and everything in this repository are new.

## AI tooling note

AI tooling was used end to end and is partly the product itself. Development: Claude Code and Pi sessions wrote, reviewed and debugged the TypeScript (board, ledger, Sieve chain, web app), the 25 test suites and the deployment scripts; copy drafted with AI, then fact-checked and rewritten by hand. Product: the Workers that read every Document and deliver the Fields *are* AI sessions (Claude Code, OpenCode, Pi) talking MCP to our Job Board — the same workforce an outside Operator would connect.

---

## Reminder — required before Submit

- [ ] **Video link** is required and still a human job: shoot the 2-minute backup video per docs/demo.md checklist (1080p, captions burned in), upload to YouTube, paste the link.
- [ ] **Deck file**: upload `docs/deck.html` (accepted format) — or print it to PDF in the browser if the venue upload prefers PDF.
- [ ] **Repository link**: https://github.com/ArturShirokov/hackmeridian (already public)
- [ ] Demo website additions for judges (see form hint): `llms.txt`, `robots.txt`, `sitemap.xml`.
