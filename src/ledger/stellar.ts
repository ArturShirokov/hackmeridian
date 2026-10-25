// Shared by the two Stellar Ledger adapters: testnet constants and the in-memory escrow terms (both) and Operator
// record (Trustless Work only; the payments adapter reads its record from Horizon).
import { createHash } from "node:crypto";
import { Asset, BASE_FEE, Memo, Networks, Operation, StrKey, TransactionBuilder, type Keypair, type Transaction } from "@stellar/stellar-sdk";
import { addUsdc, type EscrowRequest, type OperatorRecord } from "../ledger.js";

export const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"; // Circle testnet
export const USDC = new Asset("USDC", USDC_ISSUER);
export const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
export const explorer = (kind: "tx" | "account" | "contract", id: string) =>
  `https://stellar.expert/explorer/testnet/${kind}/${id}`;

// ponytail: in-memory, lost on restart, so an escrow opened before a restart can't be settled by this process.
export class Escrows {
  private open = new Map<string, EscrowRequest>();
  private slashes = new Map<string, string[]>();

  add(escrowId: string, req: EscrowRequest) {
    this.open.set(escrowId, req);
  }

  get(escrowId: string): EscrowRequest {
    const req = this.open.get(escrowId);
    if (!req) throw new Error(`unknown escrow ${escrowId}`);
    return req;
  }

  slashed(escrowId: string, slashes: string[]) {
    this.slashes.set(escrowId, slashes);
  }

  record(operator: string): OperatorRecord {
    const mine = [...this.open].filter(([, r]) => r.operator === operator).map(([id]) => id);
    const s = mine.flatMap((id) => this.slashes.get(id) ?? []);
    return { documents: mine.length, challengesUpheld: s.length, totalSlashed: addUsdc(...s) };
  }
}

export function keyFor(keys: Record<string, Keypair>, role: string, id: string) {
  const kp = keys[id];
  if (!kp) throw new Error(`no key for ${role} ${id}`);
  return kp;
}

/** The two Horizon.Server methods we use. */
export interface HorizonLike {
  loadAccount(id: string): Promise<ConstructorParameters<typeof TransactionBuilder>[0]>;
  submitTransaction(tx: Transaction): Promise<{ hash: string }>;
}

/** A memo hash is 32 bytes: use the output hash as is when it is sha256 hex, else hash it. */
export const memoHash = (h: string) =>
  /^[0-9a-f]{64}$/i.test(h) ? Buffer.from(h, "hex") : createHash("sha256").update(h).digest();

/** An unsigned USDC payment transaction from `from`, one operation per non-zero payment, the output hash in the memo. */
export async function paymentTx(horizon: HorizonLike, from: string, payments: [string, string][], outputHash: string) {
  const b = new TransactionBuilder(await horizon.loadAccount(from), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET });
  for (const [destination, amount] of payments)
    if (Number(amount) > 0) b.addOperation(Operation.payment({ destination, asset: USDC, amount }));
  return b.addMemo(Memo.hash(memoHash(outputHash))).setTimeout(60).build();
}

/**
 * Where Challenge Deposits sit: a plain account the Job Board holds. Trustless Work can't hold them: a v1 multi-release
 * resolve pays out exactly the milestone amount, fixed at deploy to Bond + Fee, so a Deposit funded into the contract
 * later could never be paid out. A Deposit is a USDC payment from the challenger with the escrow's output hash in the memo.
 */
export class DepositAccount {
  /** Hashes of the Deposit transactions handed out by prepare(); a signature doesn't change a transaction's hash. */
  private prepared = new Set<string>();

  constructor(private readonly o: { horizon: HorizonLike; account: Keypair; onTx?: (action: string, hash: string) => void }) {}

  get address() {
    return this.o.account.publicKey();
  }

  async prepare(challenger: string, amount: string, outputHash: string) {
    if (!StrKey.isValidEd25519PublicKey(challenger)) throw new Error(`challenger "${challenger}" is not a Stellar address`);
    const tx = await paymentTx(this.o.horizon, challenger, [[this.address, amount]], outputHash);
    this.prepared.add(Buffer.from(tx.hash()).toString("hex"));
    return { xdr: tx.toXDR() };
  }

  /** Lock with the challenger's key, or with its signed transaction from prepare(); throws if not locked. */
  async lock(by: Keypair | { signedXdr: string }, amount: string, outputHash: string) {
    let tx: Transaction;
    if ("signedXdr" in by) {
      if (!by.signedXdr) throw new Error("sign the Deposit transaction from prepareDeposit and pass it as depositXdr");
      tx = TransactionBuilder.fromXDR(by.signedXdr, Networks.TESTNET) as Transaction;
      const hash = Buffer.from(tx.hash()).toString("hex");
      if (!this.prepared.has(hash)) throw new Error("not a Deposit transaction from prepareDeposit");
      this.prepared.delete(hash);
    } else {
      tx = await paymentTx(this.o.horizon, by.publicKey(), [[this.address, amount]], outputHash);
      tx.sign(by);
    }
    const { hash } = await this.o.horizon.submitTransaction(tx);
    this.o.onTx?.("deposit", hash);
    return { link: explorer("tx", hash) };
  }

  /** Pays Deposits out (back to challengers, or to the Arbiter) in one transaction. */
  async payOut(payments: [string, string][], outputHash: string) {
    if (!payments.length) return;
    const tx = await paymentTx(this.o.horizon, this.address, payments, outputHash);
    tx.sign(this.o.account);
    const { hash } = await this.o.horizon.submitTransaction(tx);
    this.o.onTx?.("deposits", hash);
  }
}
