// Ledger on Trustless Work v1 REST: one multi-release escrow per (Document, Operator) with one milestone of
// Bond + Fee. Each action asks the API for an unsigned transaction, signs it with the role's key and posts it back.
// Roles: Operator = service provider, Brand = approver, Arbiter = release signer and dispute resolver.
// Challenge Deposits sit outside the contract, in the Job Board's DepositAccount (see there for why).
import { Keypair, Networks, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { addUsdc, settlement, type BondRequest, type Deposit, type EscrowRequest, type Ledger, type OutsideLedger, type Payee } from "../ledger.js";
import { checkSigned } from "./signed.js";
import { DepositAccount, Escrows, explorer, HORIZON_TESTNET, keyFor, USDC_ISSUER } from "./stellar.js";

export interface TrustlessWorkOptions {
  apiKey: string;
  /** Brand id (as in EscrowRequest.brand) to its key. */
  brands: Record<string, Keypair>;
  arbiter: Keypair;
  /** Operator id (as in EscrowRequest.operator) to its key. */
  operators: Record<string, Keypair>;
  /** Where Challenge Deposits are paid; without it, no Challenge can be filed. */
  deposits?: DepositAccount;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Gap between requests. The API allows 50 per minute; 1300 ms keeps us at about 46. */
  minIntervalMs?: number;
  /** Called with the hash of every transaction sent, for explorer links. */
  onTx?: (action: string, hash: string) => void;
  /** Horizon REST, for outside Operators' USDC balances. */
  horizonUrl?: string;
}

const M = "/escrow/multi-release";

export class TrustlessWorkLedger implements Ledger, OutsideLedger {
  private escrows = new Escrows();
  /** Outside Operators: the XDR waiting for their signature, per escrow, and what follows once it is in. */
  private pending = new Map<string, { xdr: string; signer: string; then: () => Promise<void>; link?: string }>();
  /** Escrows whose milestone the Operator already marked Completed at delivery. */
  private marked = new Set<string>();
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

  // Outside Operators: we hold no key for them. The Arbiter deploys (and is platformAddress, so the Operator can't
  // change the escrow), the Operator signs its Bond and, at delivery, the milestone's "Completed" with the output hash.
  // Settlement then needs only the Brand and the Arbiter.

  async usdcBalance(address: string) {
    const res = await this.fetch(`${this.o.horizonUrl ?? HORIZON_TESTNET}/accounts/${address}`);
    if (res.status === 404) return "0";
    if (!res.ok) throw new Error(`Horizon accounts ${res.status}: ${await res.text()}`);
    const { balances } = (await res.json()) as { balances: { asset_code?: string; asset_issuer?: string; balance: string }[] };
    const usdc = balances.find((b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER);
    return usdc ? addUsdc(usdc.balance) : "0";
  }

  async prepareBond(req: BondRequest) {
    addUsdc(req.bond, req.fee);
    const brand = this.brand(req.brand);
    const arbiter = this.o.arbiter;
    const { contractId } = await this.act(
      "/deployer/multi-release",
      {
        signer: arbiter.publicKey(),
        engagementId: `${req.documentId}-${req.operator}`,
        title: `Bond for ${req.documentId}`,
        description: `Bond + Fee for Document ${req.documentId}, outside Operator`,
        roles: {
          approver: brand.publicKey(),
          serviceProvider: req.operator,
          platformAddress: arbiter.publicKey(),
          releaseSigner: arbiter.publicKey(),
          disputeResolver: arbiter.publicKey(),
        },
        platformFee: 0,
        milestones: [{ description: "output sha256 in the evidence at delivery", amount: Number(addUsdc(req.bond, req.fee)), receiver: req.operator }],
        trustline: { address: USDC_ISSUER, symbol: "USDC" },
      },
      arbiter,
    );
    if (typeof contractId !== "string") throw new Error("deploy returned no contractId");
    const { unsignedTransaction: xdr } = await this.post(`${M}/fund-escrow`, { contractId, signer: req.operator, amount: Number(req.bond) });
    this.pending.set(contractId, {
      xdr,
      signer: req.operator,
      then: async () => {
        if (Number(req.fee) > 0) await this.act(`${M}/fund-escrow`, { contractId, signer: brand.publicKey(), amount: Number(req.fee) }, brand);
        this.escrows.add(contractId, { ...req, outputHash: "" });
        this.marked.add(contractId);
      },
      link: explorer("contract", contractId),
    });
    return { escrowId: contractId, xdr };
  }

  async prepareDelivery(contractId: string, outputHash: string) {
    const req = this.escrows.get(contractId);
    const { unsignedTransaction: xdr } = await this.post(`${M}/change-milestone-status`, {
      contractId,
      milestoneIndex: "0",
      newStatus: "Completed",
      newEvidence: `sha256:${outputHash}`,
      serviceProvider: req.operator,
    });
    this.pending.set(contractId, { xdr, signer: req.operator, then: async () => void (req.outputHash = outputHash) });
    return { xdr };
  }

  async submitSigned(contractId: string, signedXdr: string) {
    const p = this.pending.get(contractId);
    if (!p) throw new Error(`nothing to sign for escrow ${contractId}`);
    checkSigned(p.xdr, signedXdr, p.signer);
    const txHash = Buffer.from(TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET).hash()).toString("hex");
    this.o.onTx?.("outside-signed", txHash);
    await this.post("/helper/send-transaction", { signedXdr });
    this.pending.delete(contractId);
    await p.then();
    return { link: p.link ?? explorer("tx", txHash) };
  }

  async settleClean(contractId: string) {
    const req = this.escrows.get(contractId);
    const brand = this.brand(req.brand);
    const m = { contractId, milestoneIndex: "0" };
    if (!this.marked.has(contractId)) {
      const op = this.operator(req.operator);
      await this.act(
        `${M}/change-milestone-status`,
        { ...m, newStatus: "Completed", newEvidence: `sha256:${req.outputHash}`, serviceProvider: op.publicKey() },
        op,
      );
    }
    await this.act(`${M}/approve-milestone`, { ...m, approver: brand.publicKey() }, brand);
    const { txHash } = await this.act(`${M}/release-milestone-funds`, { ...m, releaseSigner: this.o.arbiter.publicKey() }, this.o.arbiter);
    return { link: explorer("tx", txHash) };
  }

  /**
   * Deposits are paid out of the DepositAccount, in full. Bond + Fee: with no Slash, the clean release; else the Brand
   * disputes and the Arbiter resolves with the settlement() split, one distribution per address.
   */
  async settleWithSlashes(contractId: string, slashes: string[], deposits: Deposit[] = [], arbiterFee = "0") {
    const req = this.escrows.get(contractId);
    const brand = this.brand(req.brand);
    const split = settlement(req, slashes, deposits, arbiterFee);
    if (split.deposits.length) await this.depositAccount().payOut(split.deposits.map((p) => [this.address(req, p.to), p.amount]), req.outputHash);
    if (!slashes.length) return this.settleClean(contractId);
    const m = { contractId, milestoneIndex: "0" };
    // Amounts are gross and sum to Bond + Fee exactly: the contract takes its 0.3% fee out of each share.
    const byAddress = new Map<string, string>();
    for (const p of split.escrow) byAddress.set(this.address(req, p.to), addUsdc(byAddress.get(this.address(req, p.to)) ?? "0", p.amount));
    const distributions = [...byAddress].map(([address, amount]) => ({ address, amount: Number(amount) }));
    await this.act(`${M}/dispute-milestone`, { ...m, signer: brand.publicKey() }, brand);
    const { txHash } = await this.act(
      `${M}/resolve-milestone-dispute`,
      { ...m, disputeResolver: this.o.arbiter.publicKey(), distributions },
      this.o.arbiter,
    );
    this.escrows.slashed(contractId, slashes);
    return { link: explorer("tx", txHash) };
  }

  // ponytail: in memory, lost on restart. /helper/get-escrows-by-role could count the Documents, but its response
  // shape is unchecked (no API key yet) and it holds milestone flags (disputed, resolved), not the dispute split,
  // so it can't give the upheld Challenges or the total Slashed. Read them from the resolve txs if the record must survive restarts.
  async operatorRecord(operator: string) {
    return this.escrows.record(operator);
  }

  async lockDeposit(contractId: string, d: { challenger: string; amount: string; signedXdr?: string }) {
    const req = this.escrows.get(contractId);
    return this.depositAccount().lock(this.o.brands[d.challenger] ?? { signedXdr: d.signedXdr ?? "" }, d.amount, req.outputHash);
  }

  async prepareDeposit(contractId: string, challenger: string, amount: string) {
    return this.depositAccount().prepare(challenger, amount, this.escrows.get(contractId).outputHash);
  }

  private depositAccount() {
    if (!this.o.deposits) throw new Error("no deposit account for Challenge Deposits (ESCROW_SECRET)");
    return this.o.deposits;
  }

  private address(req: EscrowRequest, to: Payee): string {
    if (to === "brand") return this.brand(req.brand).publicKey();
    if (to === "operator") return this.operatorAddress(req.operator);
    if (to === "arbiter") return this.o.arbiter.publicKey();
    return this.o.brands[to.challenger]?.publicKey() ?? to.challenger;
  }

  private operator = (id: string) => keyFor(this.o.operators, "Operator", id);
  /** Ours by id, an outside Operator by its address. */
  private operatorAddress = (id: string) => (StrKey.isValidEd25519PublicKey(id) ? id : this.operator(id).publicKey());
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
