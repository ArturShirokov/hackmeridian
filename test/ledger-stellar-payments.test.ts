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
    loadAccount: async (id: string) => new Account(id, "100"),
    submitTransaction: async (tx: Transaction) => {
      txs.push(tx);
      return { hash: tx.hash().toString("hex") };
    },
  };
  const ledger = new StellarPaymentsLedger({ horizon, brand, escrow, operators: { "op-1": op } });
  // What each submitted tx does, in plain terms.
  const summary = () =>
    txs.map((tx) => ({
      from: tx.source,
      memo: Buffer.from(tx.memo.value as Buffer).toString("hex"),
      signed: tx.signatures.length,
      pays: tx.operations.map((o: any) => [o.destination, o.amount, `${o.asset.code}:${o.asset.issuer}`]),
    }));
  return { ledger, txs, summary };
}

const USDC = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const req = { documentId: "doc-9", operator: "op-1", bond: 10, fee: 1, outputHash: hash };

describe("StellarPaymentsLedger", () => {
  it("opens an escrow: Operator pays the Bond and Brand the Fee into the escrow account, output hash in the memo", async () => {
    const { ledger, summary } = fakeHorizon();
    const { escrowId } = await ledger.openEscrow(req);
    expect(escrowId).toBe("doc-9-op-1");
    expect(summary()).toEqual([
      { from: op.publicKey(), memo: hash, signed: 1, pays: [[escrow.publicKey(), "10.0000000", USDC]] },
      { from: brand.publicKey(), memo: hash, signed: 1, pays: [[escrow.publicKey(), "1.0000000", USDC]] },
    ]);
  });

  it("settles clean: the escrow account pays Bond + Fee to the Operator", async () => {
    const { ledger, txs, summary } = fakeHorizon();
    const { escrowId } = await ledger.openEscrow(req);
    txs.length = 0;
    await ledger.settleClean(escrowId);
    expect(summary()).toEqual([
      { from: escrow.publicKey(), memo: hash, signed: 1, pays: [[op.publicKey(), "11.0000000", USDC]] },
    ]);
  });

  it("settles with Slashes: the Brand gets the Slashes, the Operator the rest plus the Fee, in one transaction", async () => {
    const { ledger, txs, summary } = fakeHorizon();
    const { escrowId } = await ledger.openEscrow(req);
    txs.length = 0;
    await ledger.settleWithSlashes(escrowId, [1, 2.5]);
    expect(summary()).toEqual([
      {
        from: escrow.publicKey(),
        memo: hash,
        signed: 1,
        pays: [
          [brand.publicKey(), "3.5000000", USDC],
          [op.publicKey(), "7.5000000", USDC],
        ],
      },
    ]);
    expect(await ledger.operatorRecord("op-1")).toEqual({ documents: 1, challengesUpheld: 2, totalSlashed: 3.5 });
  });

  it("hashes an output hash that is not 32 bytes of hex so it fits the memo", async () => {
    const { ledger, summary } = fakeHorizon();
    await ledger.openEscrow({ ...req, outputHash: "not-hex", fee: 0 });
    expect(summary().map((t) => t.memo)).toEqual(["95340811d2f3ab05aa125fb6d059b6e02911560314c125fd2e99ad01d995cbd2"]); // sha256("not-hex")
  });
});
