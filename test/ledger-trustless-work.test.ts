import { Account, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { TrustlessWorkLedger } from "../src/ledger/trustless-work.js";

const brand = Keypair.random();
const arbiter = Keypair.random();
const op = Keypair.random();

// Any valid unsigned transaction: the adapter only signs it and posts it back.
const unsignedXdr = new TransactionBuilder(new Account(op.publicKey(), "1"), {
  fee: BASE_FEE,
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(Operation.bumpSequence({ bumpTo: "2" }))
  .setTimeout(60)
  .build()
  .toXDR();

type Sent = { path: string; body: any; signedBy?: string };

function fakeTrustlessWork(minIntervalMs = 0) {
  const sent: Sent[] = [];
  const times: number[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    times.push(Date.now());
    const u = new URL(String(url));
    expect(u.origin).toBe("https://tw.test");
    expect((init!.headers as Record<string, string>)["x-api-key"]).toBe("key-1");
    const body = JSON.parse(String(init!.body));
    if (u.pathname === "/helper/send-transaction") {
      // ed25519 is deterministic: find the key whose signature over the unsigned tx gives the posted XDR.
      const signedWith = (k: Keypair) => {
        const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
        tx.sign(k);
        return tx.toXDR();
      };
      const who = [brand, arbiter, op].find((k) => signedWith(k) === body.signedXdr);
      sent[sent.length - 1]!.signedBy = who === brand ? "brand" : who === arbiter ? "arbiter" : who === op ? "op" : "?";
      return Response.json({ status: "SUCCESS", contractId: "CESCROW1" });
    }
    sent.push({ path: u.pathname, body });
    return Response.json({ status: "SUCCESS", unsignedTransaction: unsignedXdr }, { status: 201 });
  };
  const ledger = new TrustlessWorkLedger({
    baseUrl: "https://tw.test",
    apiKey: "key-1",
    brands: { "brand-1": brand },
    arbiter,
    operators: { "op-1": op },
    fetch,
    minIntervalMs,
  });
  return { ledger, sent, times };
}

const req = { documentId: "doc-9", operator: "op-1", brand: "brand-1", bond: "10", fee: "1", outputHash: "ab".repeat(32) };

describe("TrustlessWorkLedger", () => {
  it("opens an escrow: deploys one milestone of Bond + Fee, the Operator funds the Bond, the Brand the Fee", async () => {
    const { ledger, sent } = fakeTrustlessWork();
    const { escrowId } = await ledger.openEscrow(req);
    expect(escrowId).toBe("CESCROW1");
    expect(sent.map((s) => [s.path, s.signedBy])).toEqual([
      ["/deployer/multi-release", "op"],
      ["/escrow/multi-release/fund-escrow", "op"],
      ["/escrow/multi-release/fund-escrow", "brand"],
    ]);
    expect(sent[0]!.body).toMatchObject({
      signer: op.publicKey(),
      engagementId: "doc-9-op-1",
      roles: {
        approver: brand.publicKey(),
        serviceProvider: op.publicKey(),
        platformAddress: op.publicKey(),
        releaseSigner: arbiter.publicKey(),
        disputeResolver: arbiter.publicKey(),
      },
      platformFee: 0,
      milestones: [{ description: `output sha256:${"ab".repeat(32)}`, amount: 11, receiver: op.publicKey() }],
      trustline: { address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", symbol: "USDC" },
    });
    expect(sent[1]!.body).toEqual({ contractId: "CESCROW1", signer: op.publicKey(), amount: 10 });
    expect(sent[2]!.body).toEqual({ contractId: "CESCROW1", signer: brand.publicKey(), amount: 1 });
  });

  it("settles clean: Operator marks the milestone done, Brand approves, Arbiter releases", async () => {
    const { ledger, sent } = fakeTrustlessWork();
    const { escrowId } = await ledger.openEscrow(req);
    sent.length = 0;
    await ledger.settleClean(escrowId);
    expect(sent).toEqual([
      {
        path: "/escrow/multi-release/change-milestone-status",
        signedBy: "op",
        body: {
          contractId: "CESCROW1",
          milestoneIndex: "0",
          newStatus: "Completed",
          newEvidence: `sha256:${"ab".repeat(32)}`,
          serviceProvider: op.publicKey(),
        },
      },
      {
        path: "/escrow/multi-release/approve-milestone",
        signedBy: "brand",
        body: { contractId: "CESCROW1", milestoneIndex: "0", approver: brand.publicKey() },
      },
      {
        path: "/escrow/multi-release/release-milestone-funds",
        signedBy: "arbiter",
        body: { contractId: "CESCROW1", milestoneIndex: "0", releaseSigner: arbiter.publicKey() },
      },
    ]);
  });

  it("settles with Slashes: Brand disputes, Arbiter resolves with the Slashes to the Brand and the rest to the Operator", async () => {
    const { ledger, sent } = fakeTrustlessWork();
    const { escrowId } = await ledger.openEscrow(req);
    sent.length = 0;
    await ledger.settleWithSlashes(escrowId, ["1", "2.5"]);
    expect(sent).toEqual([
      {
        path: "/escrow/multi-release/dispute-milestone",
        signedBy: "brand",
        body: { contractId: "CESCROW1", milestoneIndex: "0", signer: brand.publicKey() },
      },
      {
        path: "/escrow/multi-release/resolve-milestone-dispute",
        signedBy: "arbiter",
        body: {
          contractId: "CESCROW1",
          milestoneIndex: "0",
          disputeResolver: arbiter.publicKey(),
          distributions: [
            { address: brand.publicKey(), amount: 3.5 },
            { address: op.publicKey(), amount: 7.5 },
          ],
        },
      },
    ]);
  });

  it("leaves out a zero share: whole Bond slashed with no Fee pays only the Brand", async () => {
    const { ledger, sent } = fakeTrustlessWork();
    const { escrowId } = await ledger.openEscrow({ ...req, fee: "0" });
    expect(sent.filter((s) => s.path.endsWith("fund-escrow"))).toHaveLength(1);
    sent.length = 0;
    await ledger.settleWithSlashes(escrowId, ["10"]);
    expect(sent[1]!.body.distributions).toEqual([{ address: brand.publicKey(), amount: 10 }]);
  });

  it("keeps the Operator record", async () => {
    const { ledger } = fakeTrustlessWork();
    const a = await ledger.openEscrow(req);
    await ledger.settleWithSlashes(a.escrowId, ["1", "2"]);
    expect(await ledger.operatorRecord("op-1")).toEqual({ documents: 1, challengesUpheld: 2, totalSlashed: "3" });
    expect(await ledger.operatorRecord("op-2")).toEqual({ documents: 0, challengesUpheld: 0, totalSlashed: "0" });
  });

  it("throws with the API message when Trustless Work answers FAILED", async () => {
    const ledger = new TrustlessWorkLedger({
      baseUrl: "https://tw.test",
      apiKey: "k",
      brands: { "brand-1": brand },
      arbiter,
      operators: { "op-1": op },
      fetch: async () => Response.json({ status: "FAILED", message: "milestone status cannot be empty" }, { status: 400 }),
      minIntervalMs: 0,
    });
    await expect(ledger.openEscrow(req)).rejects.toThrow(/milestone status cannot be empty/);
  });

  it("spaces requests at least minIntervalMs apart", async () => {
    const t = fakeTrustlessWork(40);
    await t.ledger.openEscrow(req); // 3 actions = 6 requests
    expect(t.times).toHaveLength(6);
    const gaps = t.times.slice(1).map((x, i) => x - t.times[i]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(38);
  });
});
