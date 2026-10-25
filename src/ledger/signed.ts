// Outside Operators sign their own transactions: the Ledger builds one, the Operator signs it, the Ledger checks it
// is that same transaction, signed by that address, before submitting it.
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";

/** Throws unless `signedXdr` is the transaction `unsignedXdr`, signed by `address`. */
export function checkSigned(unsignedXdr: string, signedXdr: string, address: string): void {
  let tx;
  try {
    tx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
  } catch {
    throw new Error("signedXdr is not a Stellar testnet transaction");
  }
  const hash = Buffer.from(tx.hash());
  if (!hash.equals(Buffer.from(TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET).hash())))
    throw new Error("signedXdr is not the transaction you were given to sign; sign the xdr exactly as returned");
  const kp = Keypair.fromPublicKey(address);
  if (!tx.signatures.some((s) => kp.verify(hash, s.signature)))
    throw new Error(`the transaction is not signed by ${address}; sign it with that account's key`);
}
