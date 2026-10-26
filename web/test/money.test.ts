import { expect, test } from "vitest";
import { arbiterCopy, bondLine, challengeConsequence, feeLine, howMoneyWorks, operatorBonds, possessive, windowText } from "../src/money.ts";

test("How the money works: every step with the live numbers", () => {
  const config = {
    brand: { name: "Voltaris", reviewer: "Inês" }, challengeDeposit: "1", arbiterFee: "0.1",
    operators: [{ label: "Origyn", bond: "10", fee: "1" }, { label: "Baseline", bond: "10", fee: "1" }],
  };
  expect(howMoneyWorks(config)).toEqual([
    "Voltaris pays each Operator a Fee per Document (Origyn 1.00 USDC, Baseline 1.00 USDC). It is held until the Challenge window closes, then paid to the Operator.",
    "Each Operator locks its own Bond per Document as a guarantee its Fields are right (Origyn 10.00 USDC, Baseline 10.00 USDC).",
    "A Challenge says one Operator's Field is wrong and cites the page and line. Filing locks a 1.00 USDC Challenge Deposit.",
    "The Arbiter is neutral. Uphold: the challenger is right. One tenth of that Operator's Bond goes to Voltaris (0.10 USDC of it pays the Arbiter), the Deposit comes back and the corrected value replaces the old one.",
    "Reject: the Operator was right. The Deposit pays the Arbiter and the Bond is untouched.",
    "The window pauses while a Challenge waits for the Arbiter. When it closes, everything settles automatically on Stellar.",
  ]);
});

test("possessive: Origyn's, Voltaris'", () => {
  expect(possessive("Origyn")).toBe("Origyn's");
  expect(possessive("Voltaris")).toBe("Voltaris'");
});

test("the Fee line says who pays whom and when it is paid", () => {
  expect(feeLine("Origyn", "1")).toBe("You pay Origyn 1.00 USDC · held until the window closes");
  expect(feeLine("Baseline", "1", true)).toBe("You paid Baseline 1.00 USDC · paid out");
});

test("the Bond line names whose guarantee it is", () => {
  expect(bondLine("Origyn", { bond: "10", bondLeft: "10", upheld: 0, status: "delivered" }, "Voltaris")).toEqual({ head: "Origyn's guarantee", text: "10.00 USDC Bond · locked" });
  expect(bondLine("Baseline", { bond: "10", bondLeft: "9", upheld: 1, status: "delivered" }, "Voltaris"))
    .toEqual({ head: "Baseline's guarantee", text: "9.00 USDC Bond · locked", note: "1.00 USDC slashed to Voltaris" });
  expect(bondLine("Origyn", { bond: "10", bondLeft: "10", upheld: 0, status: "settled" }, "Voltaris").text).toBe("10.00 USDC Bond · released");
});

test("the window reads as time left, or why it is paused", () => {
  expect(windowText({ msLeft: 29 * 60_000 + 12_000 })).toBe("29:12 left");
  expect(windowText({ msLeft: 2 * 3600_000 })).toBe("02:00:00 left");
  expect(windowText({ msLeft: 60_000, paused: "challenge open" })).toBe("01:00 left · paused · waiting for the Arbiter");
  expect(windowText({ msLeft: 180_000, paused: "until opened" })).toBe("03:00 · starts when you open the Document");
  expect(windowText({ msLeft: 0, settled: true })).toBe("closed · settled");
});

test("the Challenge consequence uses the live numbers", () => {
  expect(challengeConsequence({ operator: "Origyn", brand: "Voltaris", bond: "10", arbiterFee: "0.1", deposit: "1" })).toBe(
    "If the Arbiter agrees, 1.00 USDC of Origyn's Bond goes to Voltaris (0.10 USDC pays the Arbiter) and your 1.00 USDC Deposit comes back. If not, your Deposit pays the Arbiter.",
  );
});

test("the Arbiter desk says who challenges whom and what each decision does", () => {
  const c = { brand: "Voltaris", challenger: "brand", operatorLabel: "Origyn", fieldLabel: "Rated capacity", slash: "1", claim: { evidence: { page: 3 } } };
  expect(arbiterCopy(c)).toEqual({
    title: "Voltaris challenges Origyn's answer for Rated capacity",
    delivered: "Origyn said",
    claim: "Voltaris says (page 3)",
    uphold: "Voltaris is right: 1.00 USDC of Origyn's Bond goes to Voltaris",
    reject: "Origyn is right: the Deposit pays you",
  });
  const outside = arbiterCopy({ ...c, challenger: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV" });
  expect(outside.title).toBe("GABC…STUV challenges Origyn's answer for Rated capacity");
  expect(outside.uphold).toBe("GABC…STUV is right: 1.00 USDC of Origyn's Bond goes to Voltaris");
});

test("an Operator's Bonds: Documents with a Bond locked, totals, Fees earned", () => {
  expect(operatorBonds({ label: "Origyn", documentsLocked: 2, bondsLocked: "20", totalSlashed: "1", feesEarned: "3" })).toEqual({
    title: "Origyn's Bonds",
    rows: [["Documents with a Bond locked", "2"], ["Locked now", "20.00 USDC"], ["Slashed so far", "1.00 USDC"], ["Fees earned", "3.00 USDC"]],
  });
});
