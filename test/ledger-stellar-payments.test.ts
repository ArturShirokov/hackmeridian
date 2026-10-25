import { Account, Keypair, type Transaction } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { StellarPaymentsLedger } from "../src/ledger/stellar-payments.js";

const brand = Keypair.random();
const op = Keypair.random();
const escrow = Keypair.random();
const hash = "cd".repeat(32);

function fakeHorizon() {
  const txs: Transaction[] = [];
  const horizon = {
    // A new sequence number per tx, as on the chain, so identical payments get different tx hashes.
    loadAccount: async (id: string) => new Account(id, String(100 + txs.length)),
    submitTransaction: async (tx: Transaction) => {
      txs.push(tx);
      return { hash: Buffer.from(tx.hash()).toString("hex") };
    },
  };
  // Horizon's GET /accounts/:id/payments?join=transactions over the submitted txs, two records a page.
  const fetch = async (url: string | URL | Request) => {
    const u = new URL(String(url));
    expect(u.origin + u.pathname).toBe(`https://horizon.test/accounts/${escrow.publicKey()}/payments`);
    expect(u.searchParams.get("join")).toBe("transactions");
    const all = txs.flatMap((tx) =>
      tx.operations.map((o: any) => ({
        type: "payment",
        from: tx.source,
        to: o.destination,
        amount: o.amount,
        asset_code: o.asset.code,
        asset_issuer: o.asset.issuer,
        transaction_hash: Buffer.from(tx.hash()).toString("hex"),
        transaction: { memo_type: tx.memo.type, memo: Buffer.from(tx.memo.value as Buffer).toString("base64") },
      })),
    );
    const at = Number(u.searchParams.get("cursor") ?? 0);
    const records = all.filter((p) => p.from === escrow.publicKey() || p.to === escrow.publicKey()).slice(at, at + 2);
    const after = new URL(u);
    after.searchParams.set("cursor", String(at + 2));
    return Response.json({ _embedded: { records }, _links: { next: { href: after.href } } });
  };
  const options = { horizon, horizonUrl: "https://horizon.test", fetch, pageSize: 2, brands: { "brand-1": brand }, escrow, operators: { "op-1": op } };
  const ledger = new StellarPaymentsLedger(options);
  /** A second adapter with nothing in memory: what it knows, it read from the chain. */
  const restarted = () => new StellarPaymentsLedger(options);
  // What each submitted tx does, in plain terms.
  const summary = () =>
    txs.map((tx) => ({
      from: tx.source,
      memo: Buffer.from(tx.memo.value as Buffer).toString("hex"),
      signed: tx.signatures.length,
      pays: tx.operations.map((o: any) => [o.destination, o.amount, `${o.asset.code}:${o.asset.issuer}`]),
    }));
  return { ledger, txs, summary, restarted };
}

const USDC = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const req = { documentId: "doc-9", operator: "op-1", brand: "brand-1", bond: "10", fee: "1", outputHash: hash };
const txLink = (tx: Transaction) => `https://stellar.expert/explorer/testnet/tx/${Buffer.from(tx.hash()).toString("hex")}`;

describe("StellarPaymentsLedger", () => {
  it("opens an escrow: Operator pays the Bond and Brand the Fee into the escrow account, output hash in the memo", async () => {
    const { ledger, summary, txs } = fakeHorizon();
    const { escrowId, link } = await ledger.openEscrow(req);
    expect(escrowId).toBe("doc-9-op-1");
    expect(link).toBe(txLink(txs[0]!)); // the Bond payment
    expect(summary()).toEqual([
      { from: op.publicKey(), memo: hash, signed: 1, pays: [[escrow.publicKey(), "10.0000000", USDC]] },
      { from: brand.publicKey(), memo: hash, signed: 1, pays: [[escrow.publicKey(), "1.0000000", USDC]] },
    ]);
  });

  it("settles clean: the escrow account pays Bond + Fee to the Operator", async () => {
    const { ledger, txs, summary } = fakeHorizon();
    const { escrowId } = await ledger.openEscrow(req);
    txs.length = 0;
    const { link } = await ledger.settleClean(escrowId);
    expect(link).toBe(txLink(txs[0]!));
    expect(summary()).toEqual([
      { from: escrow.publicKey(), memo: hash, signed: 1, pays: [[op.publicKey(), "11.0000000", USDC]] },
    ]);
  });

  it("settles with Slashes: the Brand gets each Slash, the Operator the rest plus the Fee, in one transaction", async () => {
    const { ledger, txs, summary } = fakeHorizon();
    const { escrowId } = await ledger.openEscrow(req);
    txs.length = 0;
    expect(await ledger.settleWithSlashes(escrowId, ["1", "2.5"])).toEqual({ link: txLink(txs[0]!) });
    expect(summary()).toEqual([
      {
        from: escrow.publicKey(),
        memo: hash,
        signed: 1,
        pays: [
          [brand.publicKey(), "1.0000000", USDC],
          [brand.publicKey(), "2.5000000", USDC],
          [op.publicKey(), "7.5000000", USDC],
        ],
      },
    ]);
  });

  it("reads the Operator record back from the escrow account's payment history", async () => {
    const { ledger, restarted } = fakeHorizon();
    const a = await ledger.openEscrow(req);
    const b = await ledger.openEscrow({ ...req, documentId: "doc-10" });
    await ledger.settleWithSlashes(a.escrowId, ["1", "1"]);
    await ledger.settleClean(b.escrowId);
    await ledger.openEscrow({ ...req, documentId: "doc-11" }); // still in its Challenge Window
    expect(await restarted().operatorRecord("op-1")).toEqual({ documents: 3, challengesUpheld: 2, totalSlashed: "2" });
  });

  it("hashes an output hash that is not 32 bytes of hex so it fits the memo", async () => {
    const { ledger, summary } = fakeHorizon();
    await ledger.openEscrow({ ...req, outputHash: "not-hex", fee: "0" });
    expect(summary().map((t) => t.memo)).toEqual(["95340811d2f3ab05aa125fb6d059b6e02911560314c125fd2e99ad01d995cbd2"]); // sha256("not-hex")
  });
});
