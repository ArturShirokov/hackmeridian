// Plain-words copy for who pays whom: Fees, Bonds, the Challenge Window, Challenges and the Arbiter's decision.
// Every number comes from the API; nothing here hard-codes an amount.
import type { ApiChallenge, ApiConfig, ApiEscrow, ApiLeaderRow, ApiWindow } from "./api.ts";
import { clock, shortHash, usdc } from "./format.ts";

const sub = (a: string, b: string) => String(Math.round((Number(a) - Number(b)) * 1e7) / 1e7);
const min = (a: string, b: string) => (Number(a) < Number(b) ? a : b);

export const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** One Slash: a tenth of the Bond (ledger.ts slashes()). */
export const slashOf = (bond: string) => String(Number(bond) / 10);

export const feeLine = (operator: string, fee: string, paid = false) =>
  paid ? `You paid ${operator} ${usdc(fee)} USDC · paid out` : `You pay ${operator} ${usdc(fee)} USDC · held until the window closes`;

export function bondLine(operator: string, e: Pick<ApiEscrow, "bond" | "bondLeft" | "upheld" | "status">, brand: string) {
  const state = e.status === "settled" ? "released" : "locked";
  const slashed = sub(e.bond, e.bondLeft);
  return {
    head: `${possessive(operator)} guarantee`,
    text: `${usdc(e.bondLeft)} USDC Bond · ${state}`,
    ...(e.upheld > 0 && { note: `${usdc(slashed)} USDC slashed to ${brand}` }),
  };
}

const short = (ms: number) => { const c = clock(ms); return c.startsWith("00:") ? c.slice(3) : c; };

/** "29:12 left", "… · paused · waiting for the Arbiter", "03:00 · starts when you open the Document". */
export function windowText(w: { msLeft: number; paused?: ApiWindow["paused"]; settled?: boolean }) {
  if (w.settled) return "closed · settled";
  if (w.paused === "until opened") return `${short(w.msLeft)} · starts when you open the Document`;
  return `${short(w.msLeft)} left${w.paused === "challenge open" ? " · paused · waiting for the Arbiter" : ""}`;
}

export function challengeConsequence(x: { operator: string; brand: string; bond: string; arbiterFee: string; deposit: string }) {
  const slash = slashOf(x.bond);
  return `If the Arbiter agrees, ${usdc(slash)} USDC of ${possessive(x.operator)} Bond goes to ${x.brand} (${usdc(min(x.arbiterFee, slash))} USDC pays the Arbiter) and your ${usdc(x.deposit)} USDC Deposit comes back. If not, your Deposit pays the Arbiter.`;
}

/** The challenger by name: the Brand, or an outside challenger's shortened Stellar address. */
export const challengerName = (c: Pick<ApiChallenge, "brand" | "challenger">) => (c.challenger === "brand" ? c.brand : shortHash(c.challenger));

export function arbiterCopy(c: Pick<ApiChallenge, "brand" | "challenger" | "operatorLabel" | "fieldLabel" | "slash"> & { claim: { evidence: { page: number } } }) {
  const who = challengerName(c), op = c.operatorLabel;
  return {
    title: `${who} challenges ${possessive(op)} answer for ${c.fieldLabel}`,
    delivered: `${op} said`,
    claim: `${who} says (page ${c.claim.evidence.page})`,
    uphold: `${who} is right: ${usdc(c.slash)} USDC of ${possessive(op)} Bond goes to ${c.brand}`,
    reject: `${op} is right: the Deposit pays you`,
  };
}

type MoneyConfig = Pick<ApiConfig, "brand" | "challengeDeposit" | "arbiterFee"> & { operators: Pick<ApiConfig["operators"][number], "label" | "bond" | "fee">[] };

/** The Review's "How the money works" disclosure. */
export function howMoneyWorks(c: MoneyConfig) {
  const each = (k: "fee" | "bond") => c.operators.map((o) => `${o.label} ${usdc(o[k])} USDC`).join(", ");
  const brand = c.brand.name;
  return [
    `${brand} pays each Operator a Fee per Document (${each("fee")}). It is held until the Challenge window closes, then paid to the Operator.`,
    `Each Operator locks its own Bond per Document as a guarantee its Fields are right (${each("bond")}).`,
    `A Challenge says one Operator's Field is wrong and cites the page and line. Filing locks a ${usdc(c.challengeDeposit)} USDC Challenge Deposit.`,
    `The Arbiter is neutral. Uphold: the challenger is right. One tenth of that Operator's Bond goes to ${brand} (${usdc(c.arbiterFee)} USDC of it pays the Arbiter), the Deposit comes back and the corrected value replaces the old one.`,
    "Reject: the Operator was right. The Deposit pays the Arbiter and the Bond is untouched.",
    "The window pauses while a Challenge waits for the Arbiter. When it closes, everything settles automatically on Stellar.",
  ];
}

export function operatorBonds(r: Pick<ApiLeaderRow, "label" | "bondsLocked" | "totalSlashed" | "documentsLocked" | "feesEarned">) {
  return {
    title: `${possessive(r.label)} Bonds`,
    rows: [
      ["Documents with a Bond locked", String(r.documentsLocked)],
      ["Locked now", `${usdc(r.bondsLocked)} USDC`],
      ["Slashed so far", `${usdc(r.totalSlashed)} USDC`],
      ["Fees earned", `${usdc(r.feesEarned)} USDC`],
    ] as [string, string][],
  };
}
