import { expect, test } from "vitest";
import { clock, shortHash, splitMark, usdc } from "../src/format.ts";

test("clock shows hh:mm:ss, past 24 h, never negative", () => {
  expect(clock(172_798_000)).toBe("47:59:58");
  expect(clock(61_400)).toBe("00:01:01");
  expect(clock(-5_000)).toBe("00:00:00");
});

test("shortHash keeps the first and last four characters", () => {
  expect(shortHash("a3f9000000000000c21e")).toBe("a3f9…c21e");
  expect(shortHash("abc")).toBe("abc");
});

test("splitMark marks the first case-insensitive match, or nothing", () => {
  expect(splitMark("Rated capacity 80.0 AH at 25 °C", "80.0 ah")).toEqual({ pre: "Rated capacity ", m: "80.0 AH", post: " at 25 °C" });
  expect(splitMark("no value here", "80")).toEqual({ pre: "no value here", m: "", post: "" });
  expect(splitMark("whole quote", undefined)).toEqual({ pre: "whole quote", m: "", post: "" });
});

test("usdc shows two decimals", () => {
  expect(usdc("50")).toBe("50.00");
  expect(usdc("4.5")).toBe("4.50");
});
