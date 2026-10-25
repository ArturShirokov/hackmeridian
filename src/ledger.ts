// Ledger adapter: every money and record action on Stellar. The real one is Trustless Work;
// the fake records calls in memory. Amounts are in USDC.

export interface EscrowRequest {
  documentId: string;
  operator: string;
  bond: number;
  fee: number;
  /** Hash of the delivered Field values, stored in the escrow. */
  outputHash: string;
}

export interface OperatorRecord {
  documents: number;
  challengesUpheld: number;
  totalSlashed: number;
}

export interface Ledger {
  openEscrow(req: EscrowRequest): Promise<{ escrowId: string }>;
  /** Window closed with no Challenge upheld: Fee and Bond go to the Operator. */
  settleClean(escrowId: string): Promise<void>;
  /** Each Slash goes to the Brand; the Operator gets the rest plus the Fee. */
  settleWithSlashes(escrowId: string, slashes: number[]): Promise<void>;
  operatorRecord(operator: string): Promise<OperatorRecord>;
}

export type LedgerCall =
  | { call: "openEscrow"; escrowId: string; req: EscrowRequest }
  | { call: "settleClean"; escrowId: string }
  | { call: "settleWithSlashes"; escrowId: string; slashes: number[] };

export class FakeLedger implements Ledger {
  readonly calls: LedgerCall[] = [];

  async openEscrow(req: EscrowRequest) {
    const escrowId = `escrow-${this.calls.length + 1}`;
    this.calls.push({ call: "openEscrow", escrowId, req });
    return { escrowId };
  }

  async settleClean(escrowId: string) {
    this.calls.push({ call: "settleClean", escrowId });
  }

  async settleWithSlashes(escrowId: string, slashes: number[]) {
    this.calls.push({ call: "settleWithSlashes", escrowId, slashes });
  }

  async operatorRecord(operator: string): Promise<OperatorRecord> {
    const mine = new Set(
      this.calls.flatMap((c) => (c.call === "openEscrow" && c.req.operator === operator ? [c.escrowId] : [])),
    );
    const slashes = this.calls.flatMap((c) => (c.call === "settleWithSlashes" && mine.has(c.escrowId) ? c.slashes : []));
    return { documents: mine.size, challengesUpheld: slashes.length, totalSlashed: slashes.reduce((a, b) => a + b, 0) };
  }
}
