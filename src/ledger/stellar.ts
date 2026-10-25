// Shared by the two Stellar Ledger adapters: testnet constants and the in-memory Operator record.
import { Asset } from "@stellar/stellar-sdk";
import type { EscrowRequest, OperatorRecord } from "../ledger.js";

export const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"; // Circle testnet
export const USDC = new Asset("USDC", USDC_ISSUER);
export const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
export const explorer = (kind: "tx" | "account" | "contract", id: string) =>
  `https://stellar.expert/explorer/testnet/${kind}/${id}`;

// ponytail: in-memory, lost on restart; read escrows back from the chain when the leaderboard needs history.
export class Escrows {
  private open = new Map<string, EscrowRequest>();
  private slashes = new Map<string, number[]>();

  add(escrowId: string, req: EscrowRequest) {
    this.open.set(escrowId, req);
  }

  get(escrowId: string): EscrowRequest {
    const req = this.open.get(escrowId);
    if (!req) throw new Error(`unknown escrow ${escrowId}`);
    return req;
  }

  slashed(escrowId: string, slashes: number[]) {
    this.slashes.set(escrowId, slashes);
  }

  record(operator: string): OperatorRecord {
    const mine = [...this.open].filter(([, r]) => r.operator === operator).map(([id]) => id);
    const s = mine.flatMap((id) => this.slashes.get(id) ?? []);
    return { documents: mine.length, challengesUpheld: s.length, totalSlashed: s.reduce((a, b) => a + b, 0) };
  }
}

/** Splits Bond + Fee: the Slashes go to the Brand, the rest to the Operator. Zero shares are left out. */
export function split(req: EscrowRequest, slashes: number[]) {
  const total = req.bond + req.fee;
  const toBrand = Math.min(slashes.reduce((a, b) => a + b, 0), total);
  return { toBrand, toOperator: round7(total - toBrand) };
}

const round7 = (n: number) => Math.round(n * 1e7) / 1e7; // USDC has 7 decimals
