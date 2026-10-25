// Shared by setup-wallets.ts and topup-wallets.ts: .env keys, friendbot, USDC trustline and the testnet DEX buy.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder, type xdr } from "@stellar/stellar-sdk";
import { addUsdc } from "../src/ledger.js";
import { HORIZON_TESTNET, USDC } from "../src/ledger/stellar.js";

export const ENV = process.env.ENV_FILE ?? ".env";
export const WALLETS = ["BRAND", "OP", "BASELINE_OP", "ARBITER", "ESCROW"] as const;
export const BUYS_USDC = new Set<string>(["BRAND", "OP", "BASELINE_OP"]); // they fund Bonds and Fees
export const horizon = new Horizon.Server(HORIZON_TESTNET);

export function readEnv(): Map<string, string> {
  return new Map(
    existsSync(ENV)
      ? readFileSync(ENV, "utf8")
          .split("\n")
          .filter((l) => l.includes("=") && !l.startsWith("#"))
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)] as [string, string])
      : [],
  );
}

export const writeEnv = (env: Map<string, string>) =>
  writeFileSync(ENV, [...env].map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });

export async function submit(kp: Keypair, op: xdr.Operation, extraSigner?: Keypair) {
  const tx = new TransactionBuilder(await horizon.loadAccount(kp.publicKey()), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(op)
    .setTimeout(60)
    .build();
  tx.sign(kp);
  if (extraSigner) tx.sign(extraSigner);
  return horizon.submitTransaction(tx);
}

/** Friendbot funds an account once (10,000 XLM); a 400 means it already exists. */
export async function friendbot(address: string): Promise<boolean> {
  const fb = await fetch(`https://friendbot.stellar.org/?addr=${address}`);
  if (!fb.ok && fb.status !== 400) throw new Error(`friendbot ${fb.status}: ${await fb.text()}`);
  return fb.ok;
}

/** Friendbot only funds new accounts, so fund a throwaway one and merge it into `kp`. */
export async function topUpXlm(kp: Keypair) {
  const temp = Keypair.random();
  await friendbot(temp.publicKey());
  await submit(temp, Operation.accountMerge({ destination: kp.publicKey() }));
}

export async function balances(address: string) {
  const acct = await horizon.loadAccount(address);
  const usdc = acct.balances.find((b) => "asset_code" in b && b.asset_code === "USDC" && b.asset_issuer === USDC.getIssuer());
  const xlm = acct.balances.find((b) => b.asset_type === "native")!.balance;
  return { xlm, usdc: usdc?.balance, hasTrustline: usdc !== undefined };
}

export const trustUsdc = (kp: Keypair) => submit(kp, Operation.changeTrust({ asset: USDC }));

/** Buy exactly `amount` testnet USDC with XLM on the DEX. Liquidity is not guaranteed; faucet.circle.com is the fallback. */
export const buyUsdc = (kp: Keypair, amount: string) =>
  submit(
    kp,
    Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: "500", destination: kp.publicKey(), destAsset: USDC, destAmount: amount }),
  );

/** Below this much XLM a wallet gets another friendbot round (fees and DEX buys spend XLM). */
const MIN_XLM = 1000;

/** What a wallet needs: more XLM, and how much USDC to buy to reach its target (null when none). */
export function topUpPlan(have: { xlm: string; usdc: string }, target: { usdc?: string }) {
  const short = target.usdc === undefined ? 0 : Number(target.usdc) - Number(have.usdc);
  return { xlm: Number(have.xlm) < MIN_XLM, buyUsdc: short > 0 ? addUsdc(short.toFixed(7)) : null };
}
