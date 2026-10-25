// Creates (or reuses) the testnet wallets, funds them with XLM from friendbot, adds USDC trustlines, buys some
// testnet USDC on the DEX, and writes the secrets to .env (gitignored). Safe to run again.
//   npx tsx scripts/setup-wallets.ts            # buys 20 USDC for Brand and each Operator
//   USDC_EACH=0 npx tsx scripts/setup-wallets.ts  # skip the DEX buy (use faucet.circle.com instead)
// To top up wallets that already exist, use scripts/topup-wallets.ts.
import { Keypair } from "@stellar/stellar-sdk";
import { explorer } from "../src/ledger/stellar.js";
import { balances, BUYS_USDC, buyUsdc, ENV, friendbot, readEnv, trustUsdc, WALLETS, writeEnv } from "./wallets.js";

const usdcEach = process.env.USDC_EACH ?? "20";
const env = readEnv();

for (const name of WALLETS) {
  const key = `${name}_SECRET`;
  const kp = env.has(key) ? Keypair.fromSecret(env.get(key)!) : Keypair.random();
  env.set(key, kp.secret());
  writeEnv(env); // save before network calls

  await friendbot(kp.publicKey());
  const before = await balances(kp.publicKey());
  if (!before.hasTrustline) await trustUsdc(kp);

  if (BUYS_USDC.has(name) && Number(usdcEach) > 0 && Number(before.usdc ?? 0) < Number(usdcEach)) {
    // ponytail: testnet DEX liquidity is not guaranteed; fall back to faucet.circle.com if this fails.
    await buyUsdc(kp, usdcEach).catch((e) =>
      console.warn(`${name}: DEX buy failed (${e?.response?.data?.extras?.result_codes?.operations ?? e}), use faucet.circle.com`),
    );
  }

  const after = await balances(kp.publicKey());
  console.log(`${name.padEnd(12)} ${kp.publicKey()}  USDC ${after.usdc ?? "0"}  ${explorer("account", kp.publicKey())}`);
}
console.log(`\nSecrets in ${ENV}. Add TW_API_KEY=... there for the Trustless Work adapter.`);
