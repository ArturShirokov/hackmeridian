// Ledger adapter: every money and record action on Stellar. The real one is Trustless Work (#7);
// the fake records calls in memory.
//
// Amounts are USDC decimal strings in whole units, at most 7 decimals ("10", "2.5", "0.0000001"):
// Stellar payments take that string as is, Trustless Work takes Number(amount). Never add them as floats;
// use addUsdc.

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

export interface Ledger {
  openEscrow(req: EscrowRequest): Promise<{ escrowId: string }>;
  /** Window closed with no Challenge upheld: Fee and Bond go to the Operator. */
  settleClean(escrowId: string): Promise<void>;
  /** Each Slash goes to the Brand; the Operator gets the rest of the Bond plus the Fee. */
  settleWithSlashes(escrowId: string, slashes: string[]): Promise<void>;
  operatorRecord(operator: string): Promise<OperatorRecord>;
}

const STROOPS = 10_000_000n;
const toStroops = (usdc: string) => {
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(usdc);
  if (!m) throw new Error(`bad USDC amount "${usdc}"`);
  return BigInt(m[1]!) * STROOPS + BigInt((m[2] ?? "").padEnd(7, "0"));
};
/** Exact sum of USDC decimal strings. */
export function addUsdc(...amounts: string[]): string {
  const s = amounts.reduce((a, b) => a + toStroops(b), 0n);
  const frac = (s % STROOPS).toString().padStart(7, "0").replace(/0+$/, "");
  return `${s / STROOPS}${frac ? `.${frac}` : ""}`;
}

export type LedgerCall =
  | { call: "openEscrow"; escrowId: string; req: EscrowRequest }
  | { call: "settleClean"; escrowId: string }
  | { call: "settleWithSlashes"; escrowId: string; slashes: string[] };

export class FakeLedger implements Ledger {
  readonly calls: LedgerCall[] = [];

  async openEscrow(req: EscrowRequest) {
    addUsdc(req.bond, req.fee); // reject bad amounts like the real one would
    const escrowId = `escrow-${this.calls.length + 1}`;
    this.calls.push({ call: "openEscrow", escrowId, req });
    return { escrowId };
  }

  async settleClean(escrowId: string) {
    this.calls.push({ call: "settleClean", escrowId });
  }

  async settleWithSlashes(escrowId: string, slashes: string[]) {
    this.calls.push({ call: "settleWithSlashes", escrowId, slashes });
  }

  async operatorRecord(operator: string): Promise<OperatorRecord> {
    const mine = new Set(
      this.calls.flatMap((c) => (c.call === "openEscrow" && c.req.operator === operator ? [c.escrowId] : [])),
    );
    const slashes = this.calls.flatMap((c) => (c.call === "settleWithSlashes" && mine.has(c.escrowId) ? c.slashes : []));
    return { documents: mine.size, challengesUpheld: slashes.length, totalSlashed: addUsdc(...slashes) };
  }
}
