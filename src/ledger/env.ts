// Picks the Ledger from LEDGER=fake|payments|trustless-work (default fake). The Stellar ones read testnet keys
// from .env (or ENV_FILE), as written by scripts/setup-wallets.ts. Operator ids are the Pipeline names, the Brand is "brand".
import { existsSync } from "node:fs";
import { Horizon, Keypair } from "@stellar/stellar-sdk";
import { FakeLedger, type Ledger } from "../ledger.js";
import { StellarPaymentsLedger } from "./stellar-payments.js";
import { DepositAccount, HORIZON_TESTNET } from "./stellar.js";
import { TrustlessWorkLedger } from "./trustless-work.js";

export function ledgerFromEnv(kind = process.env.LEDGER ?? "fake", onTx?: (action: string, hash: string) => void): Ledger {
  if (kind === "fake") return new FakeLedger();
  const file = process.env.ENV_FILE ?? ".env";
  if (existsSync(file)) process.loadEnvFile(file);
  const key = (name: string) => {
    const s = process.env[name];
    if (!s) throw new Error(`${name} missing from ${file}; run scripts/setup-wallets.ts`);
    return Keypair.fromSecret(s);
  };
  const horizon = new Horizon.Server(HORIZON_TESTNET);
  const common = {
    brands: { brand: key("BRAND_SECRET") },
    operators: { ours: key("OP_SECRET"), baseline: key("BASELINE_OP_SECRET") },
    arbiter: key("ARBITER_SECRET"),
    onTx,
  };
  if (kind === "trustless-work") {
    const apiKey = process.env.TW_API_KEY;
    if (!apiKey) throw new Error(`TW_API_KEY missing from ${file} (dapp.trustlesswork.com > Settings > API Keys)`);
    // The fallback's escrow account doubles as the deposit account for Challenge Deposits.
    return new TrustlessWorkLedger({ ...common, apiKey, deposits: new DepositAccount({ horizon, account: key("ESCROW_SECRET"), ...(onTx && { onTx }) }) });
  }
  if (kind === "payments")
    return new StellarPaymentsLedger({ ...common, escrow: key("ESCROW_SECRET"), horizon });
  throw new Error(`LEDGER must be fake, payments or trustless-work, not ${kind}`);
}
