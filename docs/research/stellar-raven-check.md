# Stellar code vs Stellar Raven (2026-10-25)

Checked the Ledger code on `spec-1-integration` (`src/ledger/*.ts`, `scripts/{setup,topup,smoke}-*.ts`,
`scripts/wallets.ts`, README "Ledger") against the Stellar Raven MCP (`https://raven.stellar.org`), then against the
live Trustless Work testnet Swagger (`https://dev.api.trustlesswork.com/docs-json`, API version 1.0) where Raven was
unclear or inconsistent.

Raven sources used:

- Skill `skills.trustless-work.trustless-work-dev` (pinned to
  `Trustless-Work/trustlesswork-skill@80e2467`): `SKILL.md` gotchas, `skills/api/multi-release-escrow.md`,
  `skills/api/types.md`, `skills/api/trustlines.md`, `skills/api/core-concepts.md`, `skills/protocol/v1.md`.
- Skills `skills.stellar-dev.assets` (trustlines), `skills.stellar-dev.agentic-payments` (USDC addresses),
  `skills.stellar-dev.dapp` (submission).
- Stellar Docs: lumens#minimum-balance, accounts#subentries, list-of-operations#account-merge,
  operations-and-transactions#memo, fee-bump-transactions, fee-sponsorship, signing-soroban-invocations,
  stellar-transaction#authorization-data, x402 quickstart (testnet USDC issuer).

**Verdict: no clear bug found; no code changed.** The test suite (56 tests) passes. Contradictions between sources are
posted on issue #7 rather than resolved here.

## Per topic

### USDC trustlines and reserves: OK

- Raven/docs: "An account must always maintain a minimum balance of two base reserves (currently 1 XLM). Every
  subentry after that requires an additional base reserve (currently 0.5 XLM)"; a trustline is one subentry.
- Our wallets get 10,000 XLM from friendbot and hold one trustline each, so reserves are not a concern.
  `topup-wallets.ts` keeps them above 1,000 XLM.
- `topUpXlm` merges a fresh friendbot account into the wallet. Raven: "A source account can only be merged once it
  holds no non-signer subentries". The throwaway account has none, so the merge is valid.
- Raven (TW skill): "every address that will receive tokens (receiver(s), platformAddress for fees,
  dispute-distribution addresses) needs it … Authority-only signatures don't require holding the asset."
  Brand and Operators receive, so they need trustlines and get them. The Arbiter only signs, so its trustline is
  harmless but not needed (issue #7 asks for one; see the #7 comment).

### Circle testnet USDC issuer: OK

`USDC_ISSUER = GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` matches the TW skill ("USDC Testnet"),
the Stellar x402 quickstart ("Testnet USDC Issuer") and the agentic-payments skill. Raven warns not to confuse it with
the testnet USDC SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`. We use the `G…` issuer for both
`new Asset("USDC", …)` and TW's `trustline.address`. That is correct: "`trustline.address` is always the issuer address
(starts with G), never the escrow Soroban contract address" and "the companion field is `symbol`, not `code`".

### Signing unsigned XDR and submitting it: OK, one thing to confirm in the spike

- TW flow (Raven): "Call API endpoint → Get unsigned XDR … Sign with the signer authorized for that operation …
  Submit via `/helper/send-transaction`". That is exactly what `act()` does, with `{ signedXdr }` as the body (the
  Swagger `SendTransaction` schema matches).
- `contractId` comes back from send-transaction after the deploy. The Swagger example response has `"contractId"`,
  and the skill types say `InitializeMultiReleaseEscrowResponse` carries `contractId`. So `openEscrow` reads it from the
  right place.
- Soroban auth: "When the transaction source account is the same as the address being authorized, the signature on the
  transaction itself implicitly authorizes the invocation—no separate auth entry signature is needed." This answers the
  README question "signing each XDR as the role's account is enough", **provided TW builds each XDR with the role's
  account as the transaction source**. The mocked tests can't show this; the live spike will. If it fails with an auth
  error, the cause is `SOROBAN_CREDENTIALS_ADDRESS` entries that need `authorizeEntry`.
- Plain payments: `TransactionBuilder` + `BASE_FEE` + `setTimeout(60)` + `sign` + `Horizon.submitTransaction` is
  the classic path Raven's dapp skill shows.

### Fee-bump / sponsored fees: not used, correctly

Raven: a fee-bump "enable[s] an account to pay the transaction fees for an existing transaction without having to
re-sign"; "the inner transaction still consumes the source account's sequence number." Every account we sign with
holds its own XLM, and issue #1 puts "sponsored fees" out of scope. Nothing to add. A fee-bump would only matter for
surge pricing on mainnet (the inner fee here is `BASE_FEE`).

### Payment memos (hash memo): OK

Raven/docs: "MEMO_HASH: A 32-byte hash." `memoHash()` passes a 64-hex sha256 through as 32 bytes and hashes anything
else. `operatorRecord` filters on `memo_type === "hash"` from `/accounts/:id/payments?join=transactions`.

### Trustless Work multi-release escrow: OK against the live Swagger

| Our call | Live Swagger (testnet) | Raven |
|---|---|---|
| `POST /deployer/multi-release`, `milestones[{description, amount, receiver}]`, no `status`/`approvedFlag` | same | same ("Do NOT include `approvedFlag` or `status` when deploying") |
| `amount` as number (`Number(addUsdc(...))`) | `number` | "`amount` is always a `number`" |
| `fund-escrow` twice (Operator Bond, Brand Fee) | `{contractId, signer, amount}` | "`fund-escrow` … does not require a single deposit to equal the configured amount"; "*anyone* holding the asset and its trustline may fund" |
| `change-milestone-status` → `approve-milestone` → `release-milestone-funds` | all three exist | protocol v1: completion ≠ approval; release by `releaseSigner` |
| `dispute-milestone` (signer = Brand) | **exists** | protocol v1 / gotchas: per-milestone dispute; `multi-release-escrow.md` instead names `dispute-escrow` (**wrong vs Swagger**) |
| `resolve-milestone-dispute` (disputeResolver = Arbiter) | **exists** | protocol v1 / gotchas: `resolve-milestone-dispute`; `multi-release-escrow.md` names `resolve-dispute` (**wrong vs Swagger**) |

### Milestone index: OK

"`milestoneIndex` is always a string: Pass `"0"` not `0`"; "Index of milestone (0-based, as string: "0", "1", ...)".
We send `"0"` for our only milestone. This closes the README question "`milestoneIndex` "0" vs "1"" (the Swagger
example value `"1"` is just an example).

### Role auth: OK

- Raven protocol v1: "Who may raise a dispute … `approver`, `serviceProvider`, `platformAddress`, `releaseSigner`, and
  the (milestone) `receiver`. The `disputeResolver` address is explicitly rejected." We dispute as the Brand
  (approver), so that is allowed.
- "One address may hold multiple roles by design." The Arbiter as both `releaseSigner` and `disputeResolver` is
  allowed. This closes that README question.
- Not a bug, worth knowing: `platformAddress` = Operator. Raven: "Only the existing `platformAddress` may call
  `update-escrow`" and before funding "the platform may update escrow properties". So the Operator could change the
  escrow between deploy and the Brand's Fee deposit. The Job Board holds every key and funds immediately, so this
  doesn't matter in the demo. Outside the demo, use a Job Board address as `platformAddress`.

### Dispute amounts and the 0.3% fee: contradiction, posted on #7

- Our code sends distributions that sum to the full milestone (Bond + Fee). The comment says "Amounts are gross:
  the contract takes its 0.3% fee out of each share."
- Raven protocol v1 (cites the contract source): distributions "must be positive, must **not exceed the milestone's
  amount**, and must not exceed the current contract balance — they do **not** have to equal the full balance."
  Under that rule our call is valid.
- Live Swagger `ResolveMilestoneDispute.distributions`: "Amounts should sum the remaining milestone funds (post-fees)."
  Under that rule our full-amount sum could be rejected, or leave the fee unpaid.
- Raven on the fee: "The protocol fee is currently a fixed **0.3%** on V1 mainnet"; on the testnet lineage "the
  Trustless Work fee address … is a call parameter". So whether testnet charges 0.3% at all is not settled (README
  already lists it).
- Issue #1 says "the Brand gets the Slashes". If a fee is taken from each share, the Brand gets the Slashes minus 0.3%.

### Raven inconsistency (no code impact)

`multi-release-escrow.md` says of approve-milestone: "Funds are released immediately upon approval." The same file,
the protocol file and the Swagger all have a separate `release-milestone-funds` by the release signer. The Swagger
release errors include "The milestone must be completed to release funds". We follow the Swagger.

## For the spike (`LEDGER=trustless-work npx tsx scripts/smoke-ledger.ts`)

1. If `resolve-milestone-dispute` fails on the amount, switch the distributions to post-fee amounts (Swagger reading).
2. If any action fails on auth, check that the unsigned XDR's source is the role's account.
3. Compare the Brand's received USDC after the Slash with 0.75 to see whether testnet takes 0.3%.
