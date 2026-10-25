# Staked agent work: does the stake work through selection?

Written 2026-10-25 for the HackMeridian build. This builds on, and does not repeat, `vault/1-PROJECTS/Stellar/Agents With Money At Stake - Literature 2026-10-21.md` (stakes don't raise a fixed model's accuracy; pressure induces cheating; stake as priced warranty; scaled Brier; EXTRACTCONF; CMU VAI).

Depth labels: **READ** = I opened the source and the claim comes from its text. **ABSTRACT** = abstract or landing page only. **SEARCH-ONLY** = search-result snippets or secondary press; treat as unverified.

---

## Bottom line

1. **The founder's premise is right, and it doesn't matter.** No live staked-work market relies on the worker *caring*. Every one we looked at uses the stake to (a) **filter and weight** which pipelines count, (b) make careless or copied work **cost its owner**, and (c) price the owner's confidence. Numerai was designed this way from day one: the stake is a "self-revelation" device for a data scientist's confidence in their *model*, and the models run unattended week after week.
2. **The operator doesn't need to pay attention. They need to choose a pipeline once, and the market prices that choice.** "They'd leave it to the agent" is the *normal* state in Numerai, Bittensor and Olas. Selection works on the pipeline (model, prompt, checks) and on the bond the owner is willing to post, not on moment-to-moment effort.
3. **Selection works only with repeated rounds, a public score and real ground truth.** Where scoring is weak (consensus-only Bittensor validators, an AI evaluator with no reference, token-weighted votes), the stake rewards *capital and copying*, not quality.
4. **A human or company bears the risk in every live system.** I found no case of an agent posting a bond on its own work and losing it autonomously. The two "agent holds money" cases are a user-funded trading fleet and a jailbreak game.
5. **Recommendation for the 2-day demo:** one **per-document bond** posted by the operator, **settled per audited field** by code, plus a **public per-operator track record**. Don't use per-field escrows, and don't use reputation alone. Details are in Q4.

---

## Q1. Does the stake work through selection? Evidence from live markets

| System | What is staked, by whom | Did quality emerge? | How operators found the work | Depth |
|---|---|---|---|---|
| **Numerai** (tournament since 2016, staking since 2017) | Data scientists stake NMR on their model's predictions. v3 payout: `round_return = clip(payout_factor × weighted_score, −1, 1)`, `burn = max(−stake × round_return, 0)`, minimum 0.1 NMR per round. **Only staked predictions enter the Stake-Weighted Meta Model** that the fund trades. ([docs](https://docs.numer.ai/numerai-tournament/staking)) | The 2017 whitepaper states the purpose: staking makes "overfitting economically irrational" and the auction produces "equilibrium bidding behavior that reveals rational data scientists' confidence in their models". A data scientist stakes only if p ≥ c/(c+e) ([whitepaper](https://numer.ai/whitepaper.pdf)). Craib (Numerai CEO) claims the meta model "outperformed every individual model over the past year" (2025 press release). A community analysis counters that during a drawdown "very good performing models… contribution to the hedge fund was minimal due to their low stake", and says it's "not obvious how to aggregate" ([forum](https://forum.numer.ai/t/about-the-stake-weighted-meta-model/6858)). | Free data, example scripts and a public leaderboard. Payouts in a token with a market price. Models are uploaded and run automatically each round, so there is no weekly human effort. | Whitepaper: READ. Docs payout formula: READ. Forum post: READ (no numbers in text). Outperformance claim: SEARCH-ONLY (company press). |
| **Bittensor** | Validators (with stake) score miners. Emissions follow the stake-weighted consensus of the scores (Yuma). | **Mixed.** On-chain data from all 64 subnets: "considerable concentration in both stake and rewards", and rewards "overwhelmingly driven by stake… a clear misalignment between quality and compensation" (Lui & Sun 2025, [arXiv 2507.02951](https://arxiv.org/abs/2507.02951)). Weight copying: validators copy the public consensus weights instead of evaluating, and the consensus rewards agreement ("copier advantage"). Miner gaming on SN9 (pretraining): re-uploaded models with "practically zero amendments", and smaller models padded to look like 14B ([Macrocosmos](https://macrocosmosai.substack.com/p/monsters-vampires-and-x-rays-subnet)). Bright spot: SN3 Templar's Covenant-72B, trained permissionlessly and scored by held-out loss improvement (Gauntlet "LossScore"). Reports put it at about MMLU 67 (Llama-2-70B class), with no same-budget centralized baseline. The team reportedly then left the network. | Emissions in TAO large enough to fund professional mining teams, plus public dashboards (taostats). Operators go where emissions are; they don't hunt for "workflows". | Lui & Sun: ABSTRACT. SN9 post: READ. Weight copying: SEARCH-ONLY (official docs now redirect; the snippets quote them). Covenant: SEARCH-ONLY. |
| **Code4rena bot races** | No stake. Up to 10% of each audit pool goes to the automated "bot" phase, and the best bot report gets a 30% bonus. | Operators built and maintained bots because a recurring prize pool existed. Criticism: judges applied inconsistent rules, and racers learned the judge in advance ([GitHub issue](https://github.com/code-423n4/org/issues/148)). | A recurring, predictable payout attached to work they were already doing. | SEARCH-ONLY |
| **Olas staking** | "Anyone" stakes OLAS to run an agent. Rewards are "based on agent activity and performance" against launcher-defined KPIs. | No slashing for bad output is described. KPIs are activity ("on-chain calls or meeting KPI targets"), so this pays for *activity*, not *accuracy* ([olas.network/staking](https://olas.network/staking)). | Staking subsidies (Proof of Active Agent). | READ (landing page) |
| **Virtuals ACP** | Client escrow released by an evaluator address (AI agent, ZK verifier or multisig). | 1.77M "completed jobs" and $470M "agent GDP" as of Feb 2026, both self-reported. A $1M/month program for revenue-generating agents makes it "profitable to simulate commerce". Forkast: "If the evaluators are as incentivized to signal as the agents they monitor, the verification layer collapses." ([Forkast](https://forkast.news/the-machine-as-buyer-virtuals-acp-and-the-evaluator-problem/)) | Incentive programs. | READ (article; its figures are self-reported) |
| **UMA optimistic oracle** | The asserter posts a bond; a disputer bonds against it; UMA token holders vote. | Works most of the time; LLMs agreed with UMA's final rulings in 89.58% of disputed Polymarket markets ([arXiv 2604.15674](https://arxiv.org/abs/2604.15674)). Known failure: in March 2025 a $7M Ukraine-mineral-deal market resolved "Yes" with no deal confirmed, after large UMA holders voted. Reports disagree whether this was manipulation or negligence. Polymarket declined refunds. | Bond rewards for disputers. In practice a small set of professional proposers and whales. | 2604.15674: ABSTRACT. Ukraine incident: SEARCH-ONLY |
| **Kleros** | Jurors stake PNK. Selection odds are proportional to stake, PNK is locked per vote, and coherent (majority) votes are rewarded. | Not checked empirically in this pass. | Staking yield. | READ (juror tutorial; penalty details not on page) |

**Answer to Q1.** Yes. Where the stake does anything useful, it works through **selection and weighting of pipelines**, not through motivating the worker in the moment. Three conditions decide whether selection rewards *quality* rather than *capital*:
- **Scoring against ground truth that the worker can't see in advance.** Numerai scores on future market data, and Templar on held-out loss. Bittensor subnets that score by validator consensus drift toward stake-weighting and copying.
- **Repeated rounds with a public score**, so bad pipelines bleed and exit and good ones compound.
- **A payout that isn't only proportional to stake.** Pure stake-weighting under-rewards good small players (the Numerai forum and Lui & Sun make the same point from opposite ends).

**"Why would a human go find workflows?"** In practice they don't browse. Operators show up where there is **(a) a recurring, predictable payout** (Numerai rounds, TAO emissions, the Code4rena bot pool), **(b) a one-command way to plug in** (example scripts, miner templates), and **(c) a public leaderboard**. They then automate and walk away; in Numerai, unattended weekly submissions are the norm. So "they'd leave it to the agent" is not a failure mode. It is the expected equilibrium, and the stake is priced on that unattended pipeline. The real risk is the opposite: subsidies attract operators who farm the reward (Bittensor copying, ACP simulated commerce, Olas activity KPIs).

## Q2. Who bears the risk and earns: the human or the agent?

- **Every live system: a human or company holds the keys and the stake.** That covers Numerai users, Bittensor hotkey owners, Olas stakers, Kleros jurors and UMA proposers. The "agent" is software the owner runs.
- **DX Terminal Pro** (21 days, about 3,505 user-funded vaults, >5,000 ETH, about $20M volume): **users funded the vaults and bore losses**. The agent picked trades; hard limits (max size, slippage, allowlists) were enforced outside the model. Failures: invented rules cited in 57% of sell decisions before fixes (3% after), herding (1,544 of 3,454 vaults bought one token within an hour), and fee paralysis. No aggregate P&L is reported ([arXiv 2604.26091](https://arxiv.org/abs/2604.26091)). READ (HTML).
- **Freysa** (Nov 2024): an agent "held" a prize pool of about 13.19 ETH (about $47K) and was talked into releasing it after 482 attempts ([OECD AI incident](https://oecd.ai/en/incidents/2024-11-29-2e31)). That was a game, not staked work. SEARCH-ONLY.
- **Not found:** any live example of an agent posting a bond on the quality of its *own work* and losing it without a human choosing to post it. Pitch the agent as the worker and the **operator as the bonded party**. The "agent with its own wallet" is a futures slide, not a claim.

## Q3. Known failure modes and what fixed them

| Failure | Where seen | Fix that worked or is proposed | Depth |
|---|---|---|---|
| **Copying other workers' answers or scores** | Bittensor weight copying; SN9 model re-uploads | **Commit-reveal**: weights are time-lock encrypted (Drand) and revealed later, so copiers see only stale data. The docs warn it fails when the consensus barely changes between reveals. Bittensor's own working paper proposes commit-reveal when ground truth exists and **peer prediction** otherwise (Liu, Yu, Steeves, CCS 2024 poster). SN9 credits the first uploader by block order. | SEARCH-ONLY (docs redirect); SN9 READ |
| **Lazy evaluators and the uninformative equilibrium** | Peer prediction in general | Gao, Wright & Leyton-Brown: when agents can coordinate on cheap signals, peer prediction's lazy equilibria can't be avoided. Simple **spot-checking against ground truth with some probability, and paying unconditionally otherwise,** "achieves stronger incentive guarantees given less access to ground truth" than a large family of peer-prediction mechanisms ([arXiv 1606.07042](https://arxiv.org/abs/1606.07042)). | ABSTRACT |
| **Collusion between worker and verifier** | LLM agents that verify each other | In a repeated mutual-verification game with a shared reward, collusion (mutual ACCEPT against protocol) appeared in **94% of trajectories across 10 models**; stronger models got there sooner. **Separate rewards per verifier**, **removing cross-episode memory**, and not showing verdict history cut it sharply; removing memory almost eliminated it ([arXiv 2609.24967](https://arxiv.org/abs/2609.24967)). | READ (first ~100K chars of HTML) |
| **Stake ≠ quality (capital wins)** | Bittensor (64 subnets); Numerai drawdown | Performance-weighted emission split and a stake cap (Lui & Sun); score on outcome, not stake (Numerai v3 multiplies stake by a *score*). | ABSTRACT / READ |
| **Evaluator with the same incentives as the worker** | Virtuals ACP | Use a ZK or deterministic verifier, or a staked or multisig evaluator for high stakes. No data on whether it worked. | READ (article) |
| **Big-holder capture of disputes** | UMA / Polymarket, March 2025 | No fix adopted as of the reports I saw. | SEARCH-ONLY |
| **Sybil operators** | Numerai (one person, many models); Bittensor (many hotkeys) | A **minimum stake per entry** (Numerai 0.1 NMR) and a registration cost make sybils pay per identity. Losses scale with the total staked, so splitting doesn't help. | READ (Numerai docs) |
| **Farming the subsidy** | Olas activity KPIs; ACP $1M/month program; x402 >95% "signaling" per Forkast | Pay only for *audited, correct* output, not activity. | READ / SEARCH-ONLY |

## Q4. Minimal mechanism that is honest to demo in 2 days

**Recommendation: a mix. One bond per document per operator, settled per audited field by code, plus a public track record. No per-field escrows, and not reputation alone.**

1. **Operator registers** a Stellar account and posts a **per-document bond** in USDC into one Soroban escrow (or a Trustless Work escrow) when it takes a document. The bond is computed by code, not by the LLM, so money never enters the prompt.
2. **Commit:** each extractor submits a salted Merkle root of its fields to Stellar before anyone reveals. This is the commit-reveal fix for copying. Extractors with different operators never see each other's answers before the reveal, and they get **separate rewards** (the collusion fix).
3. **Audit:** a random sample seeded from a later ledger hash, plus every field where extractors disagree. The checker re-extracts blind; hand-labelled gold fields and planted errors keep the checker honest (the spot-check result says this beats peer prediction when some ground truth exists).
4. **Settle per audited field from the one bond:** a wrong field moves a slice of the bond to the brand, and a right one pays the fee (the scaled Brier rule from the plan). The rest of the bond is returned after the challenge window. That means one escrow and one settlement transaction per document, not N per-field escrows.
5. **Public track record per operator:** fields audited, error rate, USDC slashed, all readable from Stellar. **This is the selection mechanism**: brands route the next document to operators with low error rates and enough bond. Show two operators on stage: a good pipeline and a deliberately sloppy one (e.g. a cheaper model with no evidence quotes). Run 3–5 documents and show the sloppy one's bond draining and its routing share falling.

**What to say on stage, because the evidence supports it:** "The stake doesn't make the model careful. It makes careless pipelines expensive to run, it makes their owners pay the brand, and it makes the error rate public, so the next document goes to the operator whose track record and bond say they're right."

**What not to claim:** that agents care about money, that an open operator market will appear by itself (live markets needed subsidies, and subsidies get farmed), or that agents hold their own wallets.

**Why not the alternatives:**
- **Per-field stake as separate escrows:** too many transactions and too much UI noise. The per-field *settlement* gives the same signal.
- **Reputation only:** honest, but it drops the "priced warranty that pays the brand" that makes this a Stellar project. Reputation also does nothing on an operator's first document, and the bond covers that gap.
- **Bond only, without a track record:** loses the selection story, which is the answer to the founder's doubt.

## Gaps

- No controlled study found that compares staked and unstaked worker markets on quality. Numerai's outperformance claim is self-reported.
- Bittensor official docs pages now redirect to `bittensor.com/docs`, so the weight-copying and commit-reveal claims rest on search snippets, and the Bittensor working paper and CCS poster weren't opened.
- Lui & Sun's concentration numbers weren't read (abstract only).
- Kleros penalty mechanics and empirical coherence data weren't checked. UMA's March 2025 incident is disputed in the press.
- No source found on how operators *discover* work, beyond observing that they cluster where recurring payouts and leaderboards exist. That is inference.
