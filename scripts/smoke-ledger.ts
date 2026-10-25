// Opens two escrows on testnet, settles one clean and one with a Slash and two Challenge Deposits, and prints explorer links.
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

console.log(`\nSlashed, Brand Deposits of 0.1 on one upheld and one rejected Challenge, Arbiter Fee 0.05:`);
console.log(`  Brand 0.7, Arbiter 0.05, Operator 1.75 (gross, from the escrow); Brand 0.1 back and Arbiter 0.1 (from the deposit account)`);
const slashed = await ledger.openEscrow(req("slashed"));
console.log(`  escrow ${slashed.link ?? slashed.escrowId}`);
for (let i = 0; i < 2; i++) await ledger.lockDeposit(slashed.escrowId, { challenger: "brand", amount: "0.1" });
await ledger.settleWithSlashes(
  slashed.escrowId,
  ["0.75"],
  [
    { challenger: "brand", amount: "0.1", upheld: true },
    { challenger: "brand", amount: "0.1", upheld: false },
  ],
  "0.05",
);

console.log(`\nOperator record:`, await ledger.operatorRecord("ours"));
