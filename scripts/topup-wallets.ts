// Tops up the testnet wallets in .env before a demo: XLM from friendbot (via a throwaway account merged in, because
// friendbot funds each account only once) and testnet USDC bought on the DEX up to USDC_EACH for Brand and both
// Operators. Never creates keys; run scripts/setup-wallets.ts first. Prints addresses and balances, never secrets.
//   npx tsx scripts/topup-wallets.ts                  # USDC_EACH=20 by default
//   ENV_FILE=../.env npx tsx scripts/topup-wallets.ts # read keys from another .env
import { Keypair } from "@stellar/stellar-sdk";
import { explorer } from "../src/ledger/stellar.js";
import { balances, BUYS_USDC, buyUsdc, ENV, readEnv, topUpPlan, topUpXlm, trustUsdc, WALLETS } from "./wallets.js";

const usdcEach = process.env.USDC_EACH ?? "20";
const env = readEnv();
let failed = false;

for (const name of WALLETS) {
  const secret = env.get(`${name}_SECRET`);
  if (!secret) throw new Error(`${name}_SECRET missing from ${ENV}; run scripts/setup-wallets.ts`);
  const kp = Keypair.fromSecret(secret);
  let have = await balances(kp.publicKey());
  if (!have.hasTrustline) await trustUsdc(kp);
  const plan = topUpPlan({ xlm: have.xlm, usdc: have.usdc ?? "0" }, BUYS_USDC.has(name) ? { usdc: usdcEach } : {});
  if (plan.xlm) await topUpXlm(kp);
  if (plan.buyUsdc)
    await buyUsdc(kp, plan.buyUsdc).catch((e) => {
      failed = true;
      console.warn(`${name}: DEX buy of ${plan.buyUsdc} USDC failed (${e?.response?.data?.extras?.result_codes?.operations ?? e})`);
    });
  have = await balances(kp.publicKey());
  console.log(`${name.padEnd(12)} ${kp.publicKey()}  XLM ${have.xlm}  USDC ${have.usdc ?? "0"}  ${explorer("account", kp.publicKey())}`);
}
if (failed) console.log("\nFor USDC the DEX could not supply, use https://faucet.circle.com (Stellar Testnet) with the address above.");
