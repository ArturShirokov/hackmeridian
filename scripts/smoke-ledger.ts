// Opens two escrows on testnet, settles one clean and one with a Slash, and prints explorer links.
//   LEDGER=trustless-work npx tsx scripts/smoke-ledger.ts   (needs TW_API_KEY in .env)
//   LEDGER=payments       npx tsx scripts/smoke-ledger.ts   (plain-payments fallback)
// Run scripts/setup-wallets.ts first.
import { Horizon, Keypair } from "@stellar/stellar-sdk";
import type { Ledger } from "../src/ledger.js";
import { StellarPaymentsLedger } from "../src/ledger/stellar-payments.js";
import { explorer, HORIZON_TESTNET } from "../src/ledger/stellar.js";
import { TrustlessWorkLedger } from "../src/ledger/trustless-work.js";

process.loadEnvFile(".env");
const key = (name: string) => {
  const s = process.env[name];
  if (!s) throw new Error(`${name} missing from .env; run scripts/setup-wallets.ts`);
  return Keypair.fromSecret(s);
};

const kind = process.env.LEDGER ?? "trustless-work";
const onTx = (action: string, hash: string) => console.log(`  ${action.padEnd(48)} ${explorer("tx", hash)}`);
const common = { brand: key("BRAND_SECRET"), operators: { op: key("OP_SECRET") }, onTx };

let ledger: Ledger;
if (kind === "trustless-work") {
  const apiKey = process.env.TW_API_KEY;
  if (!apiKey) throw new Error("TW_API_KEY missing from .env (dapp.trustlesswork.com > Settings > API Keys)");
  ledger = new TrustlessWorkLedger({ ...common, apiKey, arbiter: key("ARBITER_SECRET") });
} else if (kind === "payments") {
  ledger = new StellarPaymentsLedger({ ...common, escrow: key("ESCROW_SECRET"), horizon: new Horizon.Server(HORIZON_TESTNET) });
} else throw new Error(`LEDGER must be trustless-work or payments, not ${kind}`);

const run = Date.now();
const req = (doc: string) => ({ documentId: `smoke-${doc}-${run}`, operator: "op", bond: 2, fee: 0.5, outputHash: `smoke ${doc} ${run}` });
const link = (id: string) => (id.startsWith("C") ? `  escrow ${explorer("contract", id)}` : `  escrow ${id}`);

console.log(`Ledger: ${kind}\n\nClean (Bond 2 + Fee 0.5 to the Operator):`);
const clean = await ledger.openEscrow(req("clean"));
console.log(link(clean.escrowId));
await ledger.settleClean(clean.escrowId);

console.log(`\nSlashed (one Slash of 0.75 to the Brand, 1.75 to the Operator):`);
const slashed = await ledger.openEscrow(req("slashed"));
console.log(link(slashed.escrowId));
await ledger.settleWithSlashes(slashed.escrowId, [0.75]);

console.log(`\nOperator record:`, await ledger.operatorRecord("op"));
