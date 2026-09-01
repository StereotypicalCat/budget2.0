import { test, expect } from "bun:test";
import { formatAmount, formatMoney, formatSignedMoney } from "./format.ts";

test("formatAmount groups thousands and always shows two decimals", () => {
  expect(formatAmount(1234.5)).toBe("1,234.50");
  expect(formatAmount(0)).toBe("0.00");
  expect(formatAmount(-42)).toBe("-42.00");
});

test("formatMoney appends the currency code", () => {
  expect(formatMoney(1234.5, "DKK")).toBe("1,234.50 DKK");
});

test("formatSignedMoney marks positive balances with a plus", () => {
  expect(formatSignedMoney(200, "DKK")).toBe("+200.00 DKK");
  expect(formatSignedMoney(-200, "DKK")).toBe("-200.00 DKK");
  expect(formatSignedMoney(0, "DKK")).toBe("0.00 DKK");
});
