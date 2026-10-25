// Fallback Ledger with plain Stellar payments, if Trustless Work fails the spike. The Job Board holds one
// escrow account. Bond and Fee are paid into it; settlement pays out of it. Every payment carries the output
// hash in its memo, which is the on-chain record. Trust sits with the Job Board, not a contract.
import { createHash } from "node:crypto";
import { BASE_FEE, Keypair, Memo, Networks, Operation, TransactionBuilder, type Account, type Transaction } from "@stellar/stellar-sdk";
import type { EscrowRequest, Ledger } from "../ledger.js";
import { Escrows, split, USDC } from "./stellar.js";

/** The two Horizon.Server methods we use. */
export interface HorizonLike {
  loadAccount(id: string): Promise<Account>;
  submitTransaction(tx: Transaction): Promise<{ hash: string }>;
}

export interface StellarPaymentsOptions {
  horizon: HorizonLike;
  brand: Keypair;
  escrow: Keypair;
  operators: Record<string, Keypair>;
  onTx?: (action: string, hash: string) => void;
}

export class StellarPaymentsLedger implements Ledger {
  private escrows = new Escrows();

  constructor(private readonly o: StellarPaymentsOptions) {}

  async openEscrow(req: EscrowRequest) {
    const op = this.operator(req.operator);
    const to = this.o.escrow.publicKey();
    if (req.bond > 0) await this.pay("bond", op, req, [[to, req.bond]]);
    if (req.fee > 0) await this.pay("fee", this.o.brand, req, [[to, req.fee]]);
    const escrowId = `${req.documentId}-${req.operator}`;
    this.escrows.add(escrowId, req);
    return { escrowId };
  }

  async settleClean(escrowId: string) {
    const req = this.escrows.get(escrowId);
    await this.pay("settle", this.o.escrow, req, [[this.operator(req.operator).publicKey(), req.bond + req.fee]]);
  }

  async settleWithSlashes(escrowId: string, slashes: number[]) {
    const req = this.escrows.get(escrowId);
    const { toBrand, toOperator } = split(req, slashes);
    await this.pay("slash", this.o.escrow, req, [
      [this.o.brand.publicKey(), toBrand],
      [this.operator(req.operator).publicKey(), toOperator],
    ]);
    this.escrows.slashed(escrowId, slashes);
  }

  async operatorRecord(operator: string) {
    return this.escrows.record(operator);
  }

  private operator(id: string) {
    const kp = this.o.operators[id];
    if (!kp) throw new Error(`no key for Operator ${id}`);
    return kp;
  }

  private async pay(action: string, from: Keypair, req: EscrowRequest, payments: [string, number][]) {
    const b = new TransactionBuilder(await this.o.horizon.loadAccount(from.publicKey()), {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    });
    for (const [destination, amount] of payments)
      if (amount > 0) b.addOperation(Operation.payment({ destination, asset: USDC, amount: amount.toFixed(7) }));
    const tx = b.addMemo(Memo.hash(memoHash(req.outputHash))).setTimeout(60).build();
    tx.sign(from);
    const { hash } = await this.o.horizon.submitTransaction(tx);
    this.o.onTx?.(action, hash);
  }
}

/** A memo hash is 32 bytes: use the output hash as is when it is sha256 hex, else hash it. */
const memoHash = (h: string) =>
  /^[0-9a-f]{64}$/i.test(h) ? Buffer.from(h, "hex") : createHash("sha256").update(h).digest();
