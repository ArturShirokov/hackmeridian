import { expect, test } from "vitest";
import { topUpPlan } from "../scripts/wallets.js";

test("a wallet low on XLM gets friendbot XLM, a wallet under the USDC target buys only the difference", () => {
  expect(topUpPlan({ xlm: "120.5", usdc: "7.25" }, { usdc: "20" })).toEqual({ xlm: true, buyUsdc: "12.75" });
});

test("a full wallet needs nothing; a wallet with no USDC target never buys", () => {
  expect(topUpPlan({ xlm: "9000", usdc: "20" }, { usdc: "20" })).toEqual({ xlm: false, buyUsdc: null });
  expect(topUpPlan({ xlm: "9000", usdc: "0" }, {})).toEqual({ xlm: false, buyUsdc: null });
});
