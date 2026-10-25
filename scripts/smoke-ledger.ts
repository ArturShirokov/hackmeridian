// Opens two escrows on testnet, settles one clean and one with a Slash, and prints explorer links.
//   LEDGER=trustless-work npx tsx scripts/smoke-ledger.ts   (needs TW_API_KEY in .env)
//   LEDGER=payments       npx tsx scripts/smoke-ledger.ts   (plain-payments fallback)
// Run scripts/setup-wallets.ts first.
import { ledgerFromEnv } from "../src/ledger/env.js";
import { explorer } from "../src/ledger/stellar.js";

const kind = process.env.LEDGER ?? "trustless-work";
if (kind === "fake") throw new Error("LEDGER must be trustless-work or payments");
const ledger = ledgerFromEnv(kind, (action, hash) => console.log(`  ${action.padEnd(48)} ${explorer("tx", hash)}`));

const run = Date.now();
const req = (doc: string) => ({ documentId: `smoke-${doc}-${run}`, operator: "ours", brand: "brand", bond: "2", fee: "0.5", outputHash: `smoke ${doc} ${run}` });

console.log(`Ledger: ${kind}\n\nClean (Bond 2 + Fee 0.5 to the Operator):`);
const clean = await ledger.openEscrow(req("clean"));
console.log(`  escrow ${clean.link ?? clean.escrowId}`);
await ledger.settleClean(clean.escrowId);

console.log(`\nSlashed (one Slash of 0.75 to the Brand, 1.75 to the Operator):`);
const slashed = await ledger.openEscrow(req("slashed"));
console.log(`  escrow ${slashed.link ?? slashed.escrowId}`);
await ledger.settleWithSlashes(slashed.escrowId, ["0.75"]);

console.log(`\nOperator record:`, await ledger.operatorRecord("ours"));
