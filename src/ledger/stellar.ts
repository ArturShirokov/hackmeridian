// Shared by the two Stellar Ledger adapters: testnet constants and the in-memory escrow terms (both) and Operator
// record (Trustless Work only; the payments adapter reads its record from Horizon).
import { Asset, type Keypair } from "@stellar/stellar-sdk";
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

/** Splits Bond + Fee: the Slashes go to the Brand (capped at the total), the rest to the Operator. */
export function split(req: EscrowRequest, slashes: string[]) {
  const total = stroops(addUsdc(req.bond, req.fee));
  const slashed = stroops(addUsdc(...slashes));
  const toBrand = slashed < total ? slashed : total;
  return { toBrand: usdc(toBrand), toOperator: usdc(total - toBrand) };
}

// addUsdc normalises, so stroops only sees "123" or "1.5"-style strings.
const stroops = (a: string) => {
  const [i, f = ""] = a.split(".");
  return BigInt(i!) * 10_000_000n + BigInt(f.padEnd(7, "0"));
};
const usdc = (s: bigint) => addUsdc(`${s / 10_000_000n}.${(s % 10_000_000n).toString().padStart(7, "0")}`);

export function keyFor(keys: Record<string, Keypair>, role: string, id: string) {
  const kp = keys[id];
  if (!kp) throw new Error(`no key for ${role} ${id}`);
  return kp;
}
