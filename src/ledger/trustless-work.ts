// Ledger on Trustless Work v1 REST: one multi-release escrow per (Document, Operator) with one milestone of
// Bond + Fee. Each action asks the API for an unsigned transaction, signs it with the role's key and posts it back.
// Roles: Operator = service provider, Brand = approver, Arbiter = release signer and dispute resolver.
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { addUsdc, type EscrowRequest, type Ledger } from "../ledger.js";
import { Escrows, explorer, keyFor, split, USDC_ISSUER } from "./stellar.js";

export interface TrustlessWorkOptions {
  apiKey: string;
  /** Brand id (as in EscrowRequest.brand) to its key. */
  brands: Record<string, Keypair>;
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
    addUsdc(req.bond, req.fee); // reject bad amounts before touching the chain
    const op = this.operator(req.operator);
    const brand = this.brand(req.brand);
    const { contractId } = await this.act(
      "/deployer/multi-release",
      {
        signer: op.publicKey(),
        engagementId: `${req.documentId}-${req.operator}`,
        title: `Bond for ${req.documentId}`,
        description: `Bond + Fee for Document ${req.documentId}`,
        roles: {
          approver: brand.publicKey(),
          serviceProvider: op.publicKey(),
          platformAddress: op.publicKey(),
          releaseSigner: this.o.arbiter.publicKey(),
          disputeResolver: this.o.arbiter.publicKey(),
        },
        platformFee: 0,
        milestones: [{ description: `output sha256:${req.outputHash}`, amount: Number(addUsdc(req.bond, req.fee)), receiver: op.publicKey() }],
        trustline: { address: USDC_ISSUER, symbol: "USDC" },
      },
      op,
    );
    if (typeof contractId !== "string") throw new Error("deploy returned no contractId");
    if (Number(req.bond) > 0) await this.act(`${M}/fund-escrow`, { contractId, signer: op.publicKey(), amount: Number(req.bond) }, op);
    if (Number(req.fee) > 0) await this.act(`${M}/fund-escrow`, { contractId, signer: brand.publicKey(), amount: Number(req.fee) }, brand);
    this.escrows.add(contractId, req);
    return { escrowId: contractId, link: explorer("contract", contractId) };
  }

  async settleClean(contractId: string) {
    const req = this.escrows.get(contractId);
    const op = this.operator(req.operator);
    const brand = this.brand(req.brand);
    const m = { contractId, milestoneIndex: "0" };
    await this.act(
      `${M}/change-milestone-status`,
      { ...m, newStatus: "Completed", newEvidence: `sha256:${req.outputHash}`, serviceProvider: op.publicKey() },
      op,
    );
    await this.act(`${M}/approve-milestone`, { ...m, approver: brand.publicKey() }, brand);
    const { txHash } = await this.act(`${M}/release-milestone-funds`, { ...m, releaseSigner: this.o.arbiter.publicKey() }, this.o.arbiter);
    return { link: explorer("tx", txHash) };
  }

  async settleWithSlashes(contractId: string, slashes: string[]) {
    const req = this.escrows.get(contractId);
    const brand = this.brand(req.brand);
    const { toBrand, toOperator } = split(req, slashes);
    const m = { contractId, milestoneIndex: "0" };
    // Amounts are gross: the contract takes its 0.3% fee out of each share.
    const distributions = [
      { address: brand.publicKey(), amount: Number(toBrand) },
      { address: this.operator(req.operator).publicKey(), amount: Number(toOperator) },
    ].filter((d) => d.amount > 0);
    await this.act(`${M}/dispute-milestone`, { ...m, signer: brand.publicKey() }, brand);
    const { txHash } = await this.act(
      `${M}/resolve-milestone-dispute`,
      { ...m, disputeResolver: this.o.arbiter.publicKey(), distributions },
      this.o.arbiter,
    );
    this.escrows.slashed(contractId, slashes);
    return { link: explorer("tx", txHash) };
  }

  async operatorRecord(operator: string) {
    return this.escrows.record(operator);
  }

  private operator = (id: string) => keyFor(this.o.operators, "Operator", id);
  private brand = (id: string) => keyFor(this.o.brands, "Brand", id);

  /** One action = build (API returns unsigned XDR), sign, send. Two requests. Returns the send response and the tx hash. */
  private async act(path: string, body: unknown, signer: Keypair): Promise<any> {
    const { unsignedTransaction } = await this.post(path, body);
    const tx = TransactionBuilder.fromXDR(unsignedTransaction, Networks.TESTNET);
    tx.sign(signer);
    const txHash = Buffer.from(tx.hash()).toString("hex");
    this.o.onTx?.(path, txHash);
    return { ...(await this.post("/helper/send-transaction", { signedXdr: tx.toXDR() })), txHash };
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
