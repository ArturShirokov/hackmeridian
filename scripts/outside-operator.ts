// A wallet for an outside Operator, and the one thing it needs our code for: signing the transactions the Job Board
// hands it. The key stays in a gitignored file and is never printed.
//   npx tsx scripts/outside-operator.ts new       # create + fund (friendbot, USDC trustline, 12 USDC from the DEX); prints the address
//   npx tsx scripts/outside-operator.ts address   # print the address
//   npx tsx scripts/outside-operator.ts sign XDR  # print XDR signed with the key, for submit_signed
// OUTSIDE_KEY=<file> picks another key file (default .outside-operator.key), so several outside Operators can run.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { explorer } from "../src/ledger/stellar.js";
import { balances, buyUsdc, friendbot, trustUsdc } from "./wallets.js";

const file = process.env.OUTSIDE_KEY ?? ".outside-operator.key";
const load = () => {
  if (!existsSync(file)) throw new Error(`no key in ${file}; run: npx tsx scripts/outside-operator.ts new`);
  return Keypair.fromSecret(readFileSync(file, "utf8").trim());
};
const [cmd, arg] = process.argv.slice(2);

if (cmd === "new") {
  const kp = existsSync(file) ? load() : Keypair.random();
  if (!existsSync(file)) writeFileSync(file, kp.secret() + "\n", { mode: 0o600 });
  await friendbot(kp.publicKey());
  if (!(await balances(kp.publicKey())).hasTrustline) await trustUsdc(kp);
  const want = process.env.USDC ?? "12";
  if (Number((await balances(kp.publicKey())).usdc ?? 0) < Number(want))
    // ponytail: testnet DEX liquidity is not guaranteed; fall back to faucet.circle.com if this fails.
    await buyUsdc(kp, want).catch((e) => console.warn(`DEX buy failed (${e?.response?.data?.extras?.result_codes?.operations ?? e}), use faucet.circle.com`));
  const { usdc } = await balances(kp.publicKey());
  console.log(`${kp.publicKey()}  USDC ${usdc ?? "0"}  ${explorer("account", kp.publicKey())}\nKey in ${file} (gitignored).`);
} else if (cmd === "address") console.log(load().publicKey());
else if (cmd === "sign" && arg) {
  const tx = TransactionBuilder.fromXDR(arg, Networks.TESTNET);
  tx.sign(load());
  console.log(tx.toXDR());
} else {
  console.error("usage: outside-operator.ts new | address | sign <xdr>");
  process.exit(1);
}
