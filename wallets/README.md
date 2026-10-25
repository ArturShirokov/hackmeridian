# Demo wallets (Stellar testnet)

Public addresses only. The secret keys are in `.env` at the repo root, which is gitignored: the repo is public, and a
committed testnet secret lets anyone drain the demo USDC. Create them with `npx tsx scripts/setup-wallets.ts`, top
them up with `npx tsx scripts/topup-wallets.ts`.

| Role | `.env` key | Address |
|---|---|---|
| Brand (approver, receives Slashes, pays the Fee) | `BRAND_SECRET` | [GB5QYOD56IOJBI5LK6BZCI2CYSUIVLSSDUJBYKCZAAQLVCSTMEBS4R55](https://stellar.expert/explorer/testnet/account/GB5QYOD56IOJBI5LK6BZCI2CYSUIVLSSDUJBYKCZAAQLVCSTMEBS4R55) |
| Operator `ours` (our Pipeline, posts its Bond) | `OP_SECRET` | [GDRALGICZP7N5TC7KMXN5CKDLNUQMJOLWDU6PYOIDNCZSS2OQIP36LAB](https://stellar.expert/explorer/testnet/account/GDRALGICZP7N5TC7KMXN5CKDLNUQMJOLWDU6PYOIDNCZSS2OQIP36LAB) |
| Operator `baseline` (one-pass Baseline, posts its Bond) | `BASELINE_OP_SECRET` | [GDO3MCOXQWZ3SGL7PGWRRWTDAABV4DCSX2XNW7CGYPEJQ6G2HCCEG3CK](https://stellar.expert/explorer/testnet/account/GDO3MCOXQWZ3SGL7PGWRRWTDAABV4DCSX2XNW7CGYPEJQ6G2HCCEG3CK) |
| Arbiter (release signer, dispute resolver) | `ARBITER_SECRET` | [GB3MFT5NHPLN2TJK7EHGZ7KFYH24HOO36ZPEZGHILHQ6XF25VXIOG362](https://stellar.expert/explorer/testnet/account/GB3MFT5NHPLN2TJK7EHGZ7KFYH24HOO36ZPEZGHILHQ6XF25VXIOG362) |
| Escrow account (plain-payments fallback only) | `ESCROW_SECRET` | [GBFFXTX63YSTX3TVYHFVMR4V7FCBIJDRWBYG6LGJPGMSCEPQKR7AF4IX](https://stellar.expert/explorer/testnet/account/GBFFXTX63YSTX3TVYHFVMR4V7FCBIJDRWBYG6LGJPGMSCEPQKR7AF4IX) |

Workers (the Claude Code, OpenCode and Pi sessions) have no wallet. They do Jobs for an Operator; the Operator's
Bond is what is at stake. Agents holding their own wallets is out of scope for the hackathon (spec #1).
