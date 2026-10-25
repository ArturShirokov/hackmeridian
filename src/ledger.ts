// Ledger adapter: every money and record action on Stellar. The real one is Trustless Work (#7);
// the fake records calls in memory.
//
// Amounts are USDC decimal strings in whole units, at most 7 decimals ("10", "2.5", "0.0000001"):
// Stellar payments take that string as is, Trustless Work takes Number(amount). Never add them as floats;
// use addUsdc.
import { Account, BASE_FEE, Networks, Operation, TimeoutInfinite, TransactionBuilder } from "@stellar/stellar-sdk";
import { checkSigned } from "./ledger/signed.js";

/** One escrow per (Document, Operator): the Operator funds the Bond, the Brand funds the Fee. */
export interface EscrowRequest {
  documentId: string;
  operator: string;
  brand: string;
  bond: string;
  fee: string;
  /** sha256 hex of the delivered Field values, stored in the escrow. */
  outputHash: string;
}

export interface OperatorRecord {
  documents: number;
  challengesUpheld: number;
  totalSlashed: string;
}

/** An outside Operator's claim: the escrow is opened and its Bond locked before it delivers, so there is no output hash yet. */
export type BondRequest = Omit<EscrowRequest, "outputHash">;

/**
 * Outside Operators hold their own keys (operator = their Stellar address). Each step that moves or records something
 * for them is two calls: prepare returns an unsigned transaction (XDR) for the Operator to sign, submitSigned checks
 * the signed one and submits it.
 */
export interface OutsideLedger {
  /** The address's USDC balance, "0" when it has no account or no USDC trustline. */
  usdcBalance(address: string): Promise<string>;
  /** Open the escrow for a claim; the XDR funds the Operator's Bond. After it is submitted, the Brand's Fee is funded. */
  prepareBond(req: BondRequest): Promise<{ escrowId: string; xdr: string }>;
  /** The XDR records the output hash in the escrow, signed by the Operator; the Challenge Window opens once it is in. */
  prepareDelivery(escrowId: string, outputHash: string): Promise<{ xdr: string }>;
  /** Throws unless signedXdr is the XDR last prepared for this escrow, signed by its Operator. */
  submitSigned(escrowId: string, signedXdr: string): Promise<{ link?: string }>;
}

/** A decided Challenge's Deposit. challenger: a party id the Ledger holds a key for (the Brand), or a Stellar address. */
export interface Deposit {
  challenger: string;
  amount: string;
  upheld: boolean;
}

/** `link`: where to see it on a Stellar explorer; absent when the Ledger has no chain behind it. */
export interface Ledger extends Partial<OutsideLedger> {
  openEscrow(req: EscrowRequest): Promise<{ escrowId: string; link?: string }>;
  /** Window closed with no Challenge filed: Fee and Bond go to the Operator. */
  settleClean(escrowId: string): Promise<{ link?: string }>;
  /** Pays out the settlement() split: each Slash to the Brand less the Arbiter Fee, the rest to the Operator; Deposits back or to the Arbiter. */
  settleWithSlashes(escrowId: string, slashes: string[], deposits?: Deposit[], arbiterFee?: string): Promise<{ link?: string }>;
  /**
   * Locks a Challenge Deposit against the escrow, or throws. The Ledger signs for a challenger whose key it holds;
   * any other challenger (a Stellar address) signs the transaction from prepareDeposit and passes it as signedXdr.
   */
  lockDeposit(escrowId: string, d: { challenger: string; amount: string; signedXdr?: string }): Promise<{ link?: string }>;
  /** The unsigned Deposit transaction for a challenger that signs its own. */
  prepareDeposit(escrowId: string, challenger: string, amount: string): Promise<{ xdr: string }>;
  operatorRecord(operator: string): Promise<OperatorRecord>;
  /** Where to see the Operator's account or contract on an explorer, when the Ledger has one. */
  operatorLink?(operator: string): string | undefined;
}

const STROOPS = 10_000_000n;
const toStroops = (usdc: string) => {
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(usdc);
  if (!m) throw new Error(`bad USDC amount "${usdc}"`);
  return BigInt(m[1]!) * STROOPS + BigInt((m[2] ?? "").padEnd(7, "0"));
};
const fromStroops = (s: bigint) => {
  const frac = (s % STROOPS).toString().padStart(7, "0").replace(/0+$/, "");
  return `${s / STROOPS}${frac ? `.${frac}` : ""}`;
};
/** Exact sum of USDC decimal strings. */
export function addUsdc(...amounts: string[]): string {
  return fromStroops(amounts.reduce((a, b) => a + toStroops(b), 0n));
}

/** Exact a − b of USDC decimal strings, never below 0. */
export function subUsdc(a: string, b: string): string {
  const d = toStroops(a) - toStroops(b);
  return fromStroops(d < 0n ? 0n : d);
}

/** One Slash per upheld Challenge: a tenth of the Bond each (rounded down to a stroop), never more than the Bond in all. */
export function slashes(bond: string, upheld: number): string[] {
  const tenth = fromStroops(toStroops(bond) / 10n);
  // ponytail: Slashes past the cap are "0" so the record still counts each upheld Challenge; the real Ledger may need to skip them.
  return Array.from({ length: upheld }, (_, i) => (i < 10 ? tenth : "0"));
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

/** "brand" and "operator" are the escrow's; a challenger is as in Deposit. */
export type Payee = "brand" | "operator" | "arbiter" | { challenger: string };
export interface Payout {
  to: Payee;
  amount: string;
}

/**
 * The settlement split, in two pots that each pay out exactly what they hold (zero shares left out):
 * - escrow (Bond + Fee): per Slash, the Brand gets the Slash less the Arbiter Fee (never more than the Slash), the
 *   Arbiter the Fee; the Operator the rest. Slashes past Bond + Fee are capped (one Brand share).
 * - deposits: an upheld Challenge's Deposit goes back to its challenger, a rejected one's to the Arbiter.
 */
export function settlement(req: EscrowRequest, slashes: string[], deposits: Deposit[] = [], arbiterFee = "0") {
  const total = toStroops(addUsdc(req.bond, req.fee));
  const s = slashes.map(toStroops);
  const fees = s.map((x) => min(x, toStroops(arbiterFee)));
  const capped = sum(s) > total;
  const slashed = min(sum(s), total);
  const fee = min(sum(fees), slashed);
  const brand: bigint[] = capped ? [slashed - fee] : s.map((x, i) => x - fees[i]!);
  const out = (p: [Payee, bigint][]): Payout[] => p.filter(([, a]) => a > 0n).map(([to, a]) => ({ to, amount: fromStroops(a) }));
  return {
    escrow: out([...brand.map((a): [Payee, bigint] => ["brand", a]), ["arbiter", fee], ["operator", total - slashed]]),
    deposits: out(deposits.map((d) => [d.upheld ? { challenger: d.challenger } : "arbiter", toStroops(d.amount)])),
  };
}

/** min(a, b) of USDC decimal strings. */
export const minUsdc = (a: string, b: string) => fromStroops(min(toStroops(a), toStroops(b)));

export type LedgerCall =
  | { call: "openEscrow"; escrowId: string; req: EscrowRequest }
  | { call: "lockBond"; escrowId: string; req: BondRequest }
  | { call: "recordOutput"; escrowId: string; outputHash: string }
  | { call: "settleClean"; escrowId: string }
  | { call: "settleWithSlashes"; escrowId: string; slashes: string[]; payouts: ReturnType<typeof settlement> }
  | { call: "lockDeposit"; escrowId: string; challenger: string; amount: string };

/**
 * In memory. Models outside Operators too: USDC balances per address (fund() them), and real Stellar transactions
 * to sign (built offline, never submitted), checked against the Operator's address like the real Ledger does.
 */
export class FakeLedger implements Ledger, OutsideLedger {
  readonly calls: LedgerCall[] = [];
  private balances = new Map<string, string>();
  private escrows = new Map<string, EscrowRequest>();
  /** The XDR waiting for its Operator's signature, per escrow, and what submitting it does. */
  private pending = new Map<string, { xdr: string; operator: string; then: () => void }>();
  private claims = 0;

  /** explorer: give placeholder links under this base URL; without it, no links (nothing is on a chain). */
  constructor(private readonly explorer?: string) {}

  private link = (path: string) => (this.explorer ? { link: `${this.explorer}/${path}` } : {});

  operatorLink(operator: string) {
    return this.explorer && `${this.explorer}/account/${operator}`;
  }

  /** Give an address testnet USDC. */
  fund(address: string, usdc: string) {
    this.balances.set(address, addUsdc(this.balances.get(address) ?? "0", usdc));
  }

  async usdcBalance(address: string) {
    return this.balances.get(address) ?? "0";
  }

  async openEscrow(req: EscrowRequest) {
    addUsdc(req.bond, req.fee); // reject bad amounts like the real one would
    const escrowId = `escrow-${this.calls.length + 1}`;
    this.calls.push({ call: "openEscrow", escrowId, req });
    this.escrows.set(escrowId, req);
    return { escrowId, ...this.link(escrowId) };
  }

  async prepareBond(req: BondRequest) {
    addUsdc(req.bond, req.fee);
    const escrowId = `claim-${++this.claims}`;
    const xdr = this.toSign(req.operator, escrowId, `bond ${req.bond}`);
    this.pending.set(escrowId, {
      xdr,
      operator: req.operator,
      then: () => {
        const have = this.balances.get(req.operator) ?? "0";
        if (toStroops(have) < toStroops(req.bond)) throw new Error(`${req.operator} holds ${have} USDC, less than the Bond of ${req.bond}`);
        this.balances.set(req.operator, subUsdc(have, req.bond));
        this.escrows.set(escrowId, { ...req, outputHash: "" });
        this.calls.push({ call: "lockBond", escrowId, req });
      },
    });
    return { escrowId, xdr };
  }

  async prepareDelivery(escrowId: string, outputHash: string) {
    const req = this.escrows.get(escrowId);
    if (!req) throw new Error(`unknown escrow ${escrowId}`);
    const xdr = this.toSign(req.operator, escrowId, outputHash.slice(0, 64));
    this.pending.set(escrowId, { xdr, operator: req.operator, then: () => {
      req.outputHash = outputHash;
      this.calls.push({ call: "recordOutput", escrowId, outputHash });
    } });
    return { xdr };
  }

  async submitSigned(escrowId: string, signedXdr: string) {
    const p = this.pending.get(escrowId);
    if (!p) throw new Error(`nothing to sign for escrow ${escrowId}`);
    checkSigned(p.xdr, signedXdr, p.operator);
    p.then();
    this.pending.delete(escrowId);
    return this.link(`${escrowId}/signed`);
  }

  /** A real, unsubmitted testnet transaction from `source`, so the Operator signs exactly what it would sign live. */
  private toSign(source: string, name: string, value: string) {
    return new TransactionBuilder(new Account(source, "0"), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.manageData({ name: name.slice(0, 64), value }))
      .setTimeout(TimeoutInfinite)
      .build()
      .toXDR();
  }

  async settleClean(escrowId: string) {
    this.calls.push({ call: "settleClean", escrowId });
    const req = this.escrows.get(escrowId);
    if (req) this.fund(req.operator, addUsdc(req.bond, req.fee));
    return this.link(`${escrowId}/settle`);
  }

  async settleWithSlashes(escrowId: string, slashes: string[], deposits: Deposit[] = [], arbiterFee = "0") {
    const req = this.req(escrowId);
    const payouts = settlement(req, slashes, deposits, arbiterFee);
    this.calls.push({ call: "settleWithSlashes", escrowId, slashes, payouts });
    for (const p of [...payouts.escrow, ...payouts.deposits])
      this.fund(p.to === "brand" ? req.brand : p.to === "operator" ? req.operator : p.to === "arbiter" ? "arbiter" : p.to.challenger, p.amount);
    return this.link(`${escrowId}/settle`);
  }

  private prepared = new Set<string>();

  async prepareDeposit(escrowId: string, challenger: string, amount: string) {
    const xdr = `fake-deposit:${escrowId}:${challenger}:${amount}`;
    this.prepared.add(xdr);
    return { xdr };
  }

  /** The Brand's key is "held"; anyone else must hand back the prepared transaction (the fake's signature leaves it as is). */
  async lockDeposit(escrowId: string, { challenger, amount, signedXdr }: { challenger: string; amount: string; signedXdr?: string }) {
    addUsdc(amount);
    const ok = challenger === this.req(escrowId).brand || (signedXdr === `fake-deposit:${escrowId}:${challenger}:${amount}` && this.prepared.has(signedXdr));
    if (!ok)
      throw new Error(`${challenger} must sign the Deposit from prepareDeposit`);
    if (signedXdr) this.prepared.delete(signedXdr);
    this.calls.push({ call: "lockDeposit", escrowId, challenger, amount });
    return this.link(`${escrowId}/deposit`);
  }

  /** What the escrow and the Deposits locked against it hold. */
  held(escrowId: string): string {
    const { bond, fee } = this.req(escrowId);
    return addUsdc(bond, fee, ...this.calls.flatMap((c) => (c.call === "lockDeposit" && c.escrowId === escrowId ? [c.amount] : [])));
  }

  private req(escrowId: string): EscrowRequest {
    const req = this.escrows.get(escrowId);
    if (!req) throw new Error(`unknown escrow ${escrowId}`);
    return req;
  }

  async operatorRecord(operator: string): Promise<OperatorRecord> {
    const mine = new Set(
      this.calls.flatMap((c) => ((c.call === "openEscrow" || c.call === "lockBond") && c.req.operator === operator ? [c.escrowId] : [])),
    );
    const slashes = this.calls.flatMap((c) => (c.call === "settleWithSlashes" && mine.has(c.escrowId) ? c.slashes : []));
    return { documents: mine.size, challengesUpheld: slashes.length, totalSlashed: addUsdc(...slashes) };
  }
}
