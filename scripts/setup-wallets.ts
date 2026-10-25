// Creates (or reuses) the testnet wallets, funds them with XLM from friendbot, adds USDC trustlines, buys some
// testnet USDC on the DEX, and writes the secrets to .env (gitignored). Safe to run again.
//   npx tsx scripts/setup-wallets.ts            # buys 20 USDC for Brand and each Operator
//   USDC_EACH=0 npx tsx scripts/setup-wallets.ts  # skip the DEX buy (use faucet.circle.com instead)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder, Asset } from "@stellar/stellar-sdk";
import { explorer, HORIZON_TESTNET, USDC } from "../src/ledger/stellar.js";

const ENV = ".env";
const WALLETS = ["BRAND", "OP", "BASELINE_OP", "ARBITER", "ESCROW"] as const;
const BUYS_USDC = new Set(["BRAND", "OP", "BASELINE_OP"]); // they fund Bonds and Fees
const usdcEach = process.env.USDC_EACH ?? "20";
const horizon = new Horizon.Server(HORIZON_TESTNET);

const env = new Map<string, string>(
  existsSync(ENV)
    ? readFileSync(ENV, "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)] as [string, string])
    : [],
);

async function submit(kp: Keypair, op: ReturnType<typeof Operation.changeTrust>) {
  const tx = new TransactionBuilder(await horizon.loadAccount(kp.publicKey()), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();
  tx.sign(kp);
  return horizon.submitTransaction(tx);
}

for (const name of WALLETS) {
  const key = `${name}_SECRET`;
  const kp = env.has(key) ? Keypair.fromSecret(env.get(key)!) : Keypair.random();
  env.set(key, kp.secret());
  writeFileSync(ENV, [...env].map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 }); // save before network calls

  const fb = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
  if (!fb.ok && fb.status !== 400) throw new Error(`friendbot ${fb.status}: ${await fb.text()}`); // 400 = already funded

  const acct = await horizon.loadAccount(kp.publicKey());
  const usdc = acct.balances.find((b) => "asset_code" in b && b.asset_code === "USDC" && b.asset_issuer === USDC.getIssuer());
  if (!usdc) await submit(kp, Operation.changeTrust({ asset: USDC }));

  if (BUYS_USDC.has(name) && Number(usdcEach) > 0 && Number(usdc?.balance ?? 0) < Number(usdcEach)) {
    // ponytail: testnet DEX liquidity is not guaranteed; fall back to faucet.circle.com if this fails.
    await submit(
      kp,
      Operation.pathPaymentStrictReceive({
        sendAsset: Asset.native(),
        sendMax: "500",
        destination: kp.publicKey(),
        destAsset: USDC,
        destAmount: usdcEach,
      }),
    ).catch((e) => console.warn(`${name}: DEX buy failed (${e?.response?.data?.extras?.result_codes?.operations ?? e}), use faucet.circle.com`));
  }

  const after = await horizon.loadAccount(kp.publicKey());
  const bal = after.balances.find((b) => "asset_code" in b && b.asset_code === "USDC")?.balance ?? "0";
  console.log(`${name.padEnd(12)} ${kp.publicKey()}  USDC ${bal}  ${explorer("account", kp.publicKey())}`);
}
console.log(`\nSecrets in ${ENV}. Add TW_API_KEY=... there for the Trustless Work adapter.`);
