// Fallback Ledger with plain Stellar payments, if Trustless Work fails the spike. The Job Board holds one
// escrow account. Bond and Fee are paid into it; settlement pays out of it. Every payment carries the output
// hash in its memo, which is the on-chain record. Trust sits with the Job Board, not a contract.
// The Operator record is read back from the escrow account's payment history on Horizon.
import { createHash } from "node:crypto";
import { BASE_FEE, Keypair, Memo, Networks, Operation, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { addUsdc, type EscrowRequest, type Ledger } from "../ledger.js";
import { Escrows, explorer, HORIZON_TESTNET, keyFor, split, USDC } from "./stellar.js";

/** The two Horizon.Server methods we use. */
export interface HorizonLike {
  loadAccount(id: string): Promise<ConstructorParameters<typeof TransactionBuilder>[0]>;
  submitTransaction(tx: Transaction): Promise<{ hash: string }>;
}

export interface StellarPaymentsOptions {
  horizon: HorizonLike;
  /** Brand id (as in EscrowRequest.brand) to its key. */
  brands: Record<string, Keypair>;
  escrow: Keypair;
  operators: Record<string, Keypair>;
  onTx?: (action: string, hash: string) => void;
  /** Horizon REST, for reading the escrow account's payment history. */
  horizonUrl?: string;
  fetch?: typeof fetch;
  pageSize?: number;
}

/** The fields we read from one record of Horizon's /accounts/:id/payments?join=transactions. */
interface PaymentRecord {
  type: string;
  from: string;
  to: string;
  amount: string;
  asset_code?: string;
  asset_issuer?: string;
  transaction_hash: string;
  transaction?: { memo_type: string };
}

export class StellarPaymentsLedger implements Ledger {
  /** Open escrows' terms, needed to settle them. The record does not depend on it. */
  private escrows = new Escrows();

  constructor(private readonly o: StellarPaymentsOptions) {}

  async openEscrow(req: EscrowRequest) {
    addUsdc(req.bond, req.fee); // reject bad amounts before touching the chain
    const op = this.operator(req.operator);
    const to = this.o.escrow.publicKey();
    const bond = Number(req.bond) > 0 ? await this.pay("bond", op, req, [[to, req.bond]]) : undefined;
    const fee = Number(req.fee) > 0 ? await this.pay("fee", this.brand(req.brand), req, [[to, req.fee]]) : undefined;
    const escrowId = `${req.documentId}-${req.operator}`;
    this.escrows.add(escrowId, req);
    const tx = bond ?? fee; // the Bond payment is the record the Brand wants to see
    return { escrowId, ...(tx && { link: explorer("tx", tx) }) };
  }

  async settleClean(escrowId: string) {
    const req = this.escrows.get(escrowId);
    const tx = await this.pay("settle", this.o.escrow, req, [[this.operator(req.operator).publicKey(), addUsdc(req.bond, req.fee)]]);
    return { link: explorer("tx", tx) };
  }

  async settleWithSlashes(escrowId: string, slashes: string[]) {
    const req = this.escrows.get(escrowId);
    const { toBrand, toOperator } = split(req, slashes);
    // One payment per Slash, so the history shows how many were upheld. Past Bond + Fee: one payment of the cap.
    const each = addUsdc(...slashes) === toBrand ? slashes : [toBrand];
    const brand = this.brand(req.brand).publicKey();
    const tx = await this.pay("slash", this.o.escrow, req, [
      ...each.map((s): [string, string] => [brand, s]),
      [this.operator(req.operator).publicKey(), toOperator],
    ]);
    return { link: explorer("tx", tx) };
  }

  /**
   * From the escrow account's USDC payments with a hash memo: a Bond paid in by the Operator is one Document;
   * in a payout to the Operator, every other payment is one Slash to the Brand.
   * ponytail: a zero Bond and Slashes past the cap ("0") make no payment, so they are not counted.
   */
  async operatorRecord(operator: string) {
    const op = this.operator(operator).publicKey();
    const escrow = this.o.escrow.publicKey();
    const ours = (p: PaymentRecord) =>
      p.type === "payment" && p.asset_code === USDC.getCode() && p.asset_issuer === USDC.getIssuer() && p.transaction?.memo_type === "hash";
    const byTx = new Map<string, PaymentRecord[]>();
    for (const p of (await this.history()).filter(ours)) byTx.set(p.transaction_hash, [...(byTx.get(p.transaction_hash) ?? []), p]);
    let documents = 0;
    const slashed: string[] = [];
    for (const pays of byTx.values()) {
      if (pays.some((p) => p.from === op && p.to === escrow)) documents++;
      if (pays.every((p) => p.from === escrow) && pays.some((p) => p.to === op))
        slashed.push(...pays.filter((p) => p.to !== op).map((p) => p.amount));
    }
    return { documents, challengesUpheld: slashed.length, totalSlashed: addUsdc(...slashed) };
  }

  /** Every payment to or from the escrow account, oldest first, page by page. */
  private async history(): Promise<PaymentRecord[]> {
    const limit = this.o.pageSize ?? 200;
    const all: PaymentRecord[] = [];
    let url = `${this.o.horizonUrl ?? HORIZON_TESTNET}/accounts/${this.o.escrow.publicKey()}/payments?join=transactions&order=asc&limit=${limit}`;
    for (;;) {
      const res = await (this.o.fetch ?? fetch)(url);
      if (!res.ok) throw new Error(`Horizon payments ${res.status}: ${await res.text()}`);
      const page: any = await res.json();
      const records: PaymentRecord[] = page._embedded.records;
      all.push(...records);
      if (records.length < limit) return all;
      url = page._links.next.href;
    }
  }

  private operator = (id: string) => keyFor(this.o.operators, "Operator", id);
  private brand = (id: string) => keyFor(this.o.brands, "Brand", id);

  private async pay(action: string, from: Keypair, req: EscrowRequest, payments: [string, string][]) {
    const b = new TransactionBuilder(await this.o.horizon.loadAccount(from.publicKey()), {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    });
    for (const [destination, amount] of payments)
      if (Number(amount) > 0) b.addOperation(Operation.payment({ destination, asset: USDC, amount }));
    const tx = b.addMemo(Memo.hash(memoHash(req.outputHash))).setTimeout(60).build();
    tx.sign(from);
    const { hash } = await this.o.horizon.submitTransaction(tx);
    this.o.onTx?.(action, hash);
    return hash;
  }
}

/** A memo hash is 32 bytes: use the output hash as is when it is sha256 hex, else hash it. */
const memoHash = (h: string) =>
  /^[0-9a-f]{64}$/i.test(h) ? Buffer.from(h, "hex") : createHash("sha256").update(h).digest();
