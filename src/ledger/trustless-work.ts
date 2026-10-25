// Ledger on Trustless Work v1 REST: one multi-release escrow per (Document, Operator) with one milestone of
// Bond + Fee. Each action asks the API for an unsigned transaction, signs it with the role's key and posts it back.
// Roles: Operator = service provider, Brand = approver, Arbiter = release signer and dispute resolver.
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { EscrowRequest, Ledger } from "../ledger.js";
import { Escrows, split, USDC_ISSUER } from "./stellar.js";

export interface TrustlessWorkOptions {
  apiKey: string;
  brand: Keypair;
  arbiter: Keypair;
  /** Operator id (as in EscrowRequest.operator) to its key. */
  operators: Record<string, Keypair>;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Gap between requests. The API allows 50 per minute; 1300 ms keeps us at about 46. */
  minIntervalMs?: number;
  /** Called with the hash of every transaction sent, for explorer links. */
  onTx?: (action: string, hash: string) => void;
}

const M = "/escrow/multi-release";

export class TrustlessWorkLedger implements Ledger {
  private escrows = new Escrows();
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;
  private readonly gap: number;

  constructor(private readonly o: TrustlessWorkOptions) {
    this.baseUrl = o.baseUrl ?? "https://dev.api.trustlesswork.com";
    this.fetch = o.fetch ?? fetch;
    this.gap = o.minIntervalMs ?? 1300;
  }

  async openEscrow(req: EscrowRequest) {
    const op = this.operator(req.operator);
    const { contractId } = await this.act(
      "/deployer/multi-release",
      {
        signer: op.publicKey(),
        engagementId: `${req.documentId}-${req.operator}`,
        title: `Bond for ${req.documentId}`,
        description: `Bond + Fee for Document ${req.documentId}`,
        roles: {
          approver: this.o.brand.publicKey(),
          serviceProvider: op.publicKey(),
          platformAddress: op.publicKey(),
          releaseSigner: this.o.arbiter.publicKey(),
          disputeResolver: this.o.arbiter.publicKey(),
        },
        platformFee: 0,
        milestones: [{ description: `output sha256:${req.outputHash}`, amount: req.bond + req.fee, receiver: op.publicKey() }],
        trustline: { address: USDC_ISSUER, symbol: "USDC" },
      },
      op,
    );
    if (typeof contractId !== "string") throw new Error("deploy returned no contractId");
    if (req.bond > 0) await this.act(`${M}/fund-escrow`, { contractId, signer: op.publicKey(), amount: req.bond }, op);
    if (req.fee > 0) await this.act(`${M}/fund-escrow`, { contractId, signer: this.o.brand.publicKey(), amount: req.fee }, this.o.brand);
    this.escrows.add(contractId, req);
    return { escrowId: contractId };
  }

  async settleClean(contractId: string) {
    const req = this.escrows.get(contractId);
    const op = this.operator(req.operator);
    const m = { contractId, milestoneIndex: "0" };
    await this.act(
      `${M}/change-milestone-status`,
      { ...m, newStatus: "Completed", newEvidence: `sha256:${req.outputHash}`, serviceProvider: op.publicKey() },
      op,
    );
    await this.act(`${M}/approve-milestone`, { ...m, approver: this.o.brand.publicKey() }, this.o.brand);
    await this.act(`${M}/release-milestone-funds`, { ...m, releaseSigner: this.o.arbiter.publicKey() }, this.o.arbiter);
  }

  async settleWithSlashes(contractId: string, slashes: number[]) {
    const req = this.escrows.get(contractId);
    const { toBrand, toOperator } = split(req, slashes);
    const m = { contractId, milestoneIndex: "0" };
    // Amounts are gross: the contract takes its 0.3% fee out of each share.
    const distributions = [
      { address: this.o.brand.publicKey(), amount: toBrand },
      { address: this.operator(req.operator).publicKey(), amount: toOperator },
    ].filter((d) => d.amount > 0);
    await this.act(`${M}/dispute-milestone`, { ...m, signer: this.o.brand.publicKey() }, this.o.brand);
    await this.act(
      `${M}/resolve-milestone-dispute`,
      { ...m, disputeResolver: this.o.arbiter.publicKey(), distributions },
      this.o.arbiter,
    );
    this.escrows.slashed(contractId, slashes);
  }

  async operatorRecord(operator: string) {
    return this.escrows.record(operator);
  }

  private operator(id: string) {
    const kp = this.o.operators[id];
    if (!kp) throw new Error(`no key for Operator ${id}`);
    return kp;
  }

  /** One action = build (API returns unsigned XDR), sign, send. Two requests. */
  private async act(path: string, body: unknown, signer: Keypair): Promise<any> {
    const { unsignedTransaction } = await this.post(path, body);
    const tx = TransactionBuilder.fromXDR(unsignedTransaction, Networks.TESTNET);
    tx.sign(signer);
    this.o.onTx?.(path, tx.hash().toString("hex"));
    return this.post("/helper/send-transaction", { signedXdr: tx.toXDR() });
  }

  // ponytail: one global queue per adapter instance; share it across instances if several ever run in one process.
  private post(path: string, body: unknown): Promise<any> {
    const run = this.queue.then(async () => {
      const wait = this.last + this.gap - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      const res = await this.fetch(this.baseUrl + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": this.o.apiKey },
        body: JSON.stringify(body),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok || json.status === "FAILED") throw new Error(`Trustless Work ${path} ${res.status}: ${JSON.stringify(json)}`);
      return json;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
