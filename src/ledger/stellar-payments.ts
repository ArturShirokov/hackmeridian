// Fallback Ledger with plain Stellar payments, if Trustless Work fails the spike. The Job Board holds one
// escrow account. Bond and Fee are paid into it; settlement pays out of it. Every payment carries the output
// hash in its memo, which is the on-chain record. Trust sits with the Job Board, not a contract.
// The Operator record is read back from the escrow account's payment history on Horizon.
// Challenge Deposits are paid into the same account, each in its own transaction.
import type { Keypair } from "@stellar/stellar-sdk";
import { addUsdc, settlement, type Deposit, type EscrowRequest, type Ledger, type Payee } from "../ledger.js";
import { DepositAccount, Escrows, explorer, HORIZON_TESTNET, keyFor, paymentTx, USDC, type HorizonLike } from "./stellar.js";

export type { HorizonLike };

export interface StellarPaymentsOptions {
  horizon: HorizonLike;
  /** Brand id (as in EscrowRequest.brand) to its key. */
  brands: Record<string, Keypair>;
  escrow: Keypair;
  operators: Record<string, Keypair>;
  /** Paid the Arbiter Fees and rejected Deposits; only needed once a Challenge is decided. */
  arbiter?: Keypair;
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
  private deposits: DepositAccount;

  constructor(private readonly o: StellarPaymentsOptions) {
    this.deposits = new DepositAccount({ horizon: o.horizon, account: o.escrow, ...(o.onTx && { onTx: o.onTx }) });
  }

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

  /**
   * Deposits first, in their own transaction, then Bond + Fee in one: one payment to the Brand per Slash (so the
   * history shows how many were upheld; past Bond + Fee, one payment of the cap), the Arbiter Fees, the rest to the Operator.
   */
  async settleWithSlashes(escrowId: string, slashes: string[], deposits: Deposit[] = [], arbiterFee = "0") {
    const req = this.escrows.get(escrowId);
    const split = settlement(req, slashes, deposits, arbiterFee);
    const to = (p: { to: Payee; amount: string }): [string, string] => [this.address(req, p.to), p.amount];
    await this.deposits.payOut(split.deposits.map(to), req.outputHash);
    const tx = await this.pay("slash", this.o.escrow, req, split.escrow.map(to));
    return { link: explorer("tx", tx) };
  }

  async lockDeposit(escrowId: string, d: { challenger: string; amount: string; signedXdr?: string }) {
    const req = this.escrows.get(escrowId);
    const key = this.o.brands[d.challenger];
    return this.deposits.lock(key ?? { signedXdr: d.signedXdr ?? "" }, d.amount, req.outputHash);
  }

  async prepareDeposit(escrowId: string, challenger: string, amount: string) {
    return this.deposits.prepare(challenger, amount, this.escrows.get(escrowId).outputHash);
  }

  private address(req: EscrowRequest, to: Payee): string {
    if (to === "brand") return this.brand(req.brand).publicKey();
    if (to === "operator") return this.operator(req.operator).publicKey();
    if (to === "arbiter") {
      if (!this.o.arbiter) throw new Error("no Arbiter key to pay the Arbiter");
      return this.o.arbiter.publicKey();
    }
    return this.o.brands[to.challenger]?.publicKey() ?? to.challenger;
  }

  /**
   * From the escrow account's USDC payments with a hash memo: a Bond paid in by the Operator is one Document;
   * in a payout to the Operator, every other payment is Slashed, and each one not to the Arbiter is one upheld Challenge.
   * ponytail: a zero Bond, Slashes past the cap ("0") and a Slash taken whole by the Arbiter Fee make no Brand
   * payment, so they are not counted as upheld.
   */
  async operatorRecord(operator: string) {
    const op = this.operator(operator).publicKey();
    const escrow = this.o.escrow.publicKey();
    const arbiter = this.o.arbiter?.publicKey();
    const ours = (p: PaymentRecord) =>
      p.type === "payment" && p.asset_code === USDC.getCode() && p.asset_issuer === USDC.getIssuer() && p.transaction?.memo_type === "hash";
    const byTx = new Map<string, PaymentRecord[]>();
    for (const p of (await this.history()).filter(ours)) byTx.set(p.transaction_hash, [...(byTx.get(p.transaction_hash) ?? []), p]);
    let documents = 0;
    let upheld = 0;
    const slashed: string[] = [];
    for (const pays of byTx.values()) {
      if (pays.some((p) => p.from === op && p.to === escrow)) documents++;
      if (pays.every((p) => p.from === escrow) && pays.some((p) => p.to === op))
        for (const p of pays.filter((p) => p.to !== op)) {
          slashed.push(p.amount);
          if (p.to !== arbiter) upheld++;
        }
    }
    return { documents, challengesUpheld: upheld, totalSlashed: addUsdc(...slashed) };
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
    const tx = await paymentTx(this.o.horizon, from.publicKey(), payments, req.outputHash);
    tx.sign(from);
    const { hash } = await this.o.horizon.submitTransaction(tx);
    this.o.onTx?.(action, hash);
    return hash;
  }
}
