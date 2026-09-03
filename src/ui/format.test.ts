import { test, expect } from "bun:test";
import {
  formatAmount,
  formatMoney,
  formatSignedAmount,
  formatSignedMoney,
} from "./format.ts";

test("formatAmount groups thousands and shows the digits it is given", () => {
  expect(formatAmount(1234.5, 2)).toBe("1,234.50");
  expect(formatAmount(0, 2)).toBe("0.00");
  expect(formatAmount(-42, 2)).toBe("-42.00");
});

test("formatMoney appends the currency code", () => {
  expect(formatMoney(1234.5, "DKK", 2)).toBe("1,234.50 DKK");
});

test("formatSignedMoney marks positive balances with a plus", () => {
  expect(formatSignedMoney(200, "DKK", 2)).toBe("+200.00 DKK");
  expect(formatSignedMoney(-200, "DKK", 2)).toBe("-200.00 DKK");
  expect(formatSignedMoney(0, "DKK", 2)).toBe("0.00 DKK");
});

test("formatSignedAmount signs the number without naming a currency", () => {
  expect(formatSignedAmount(200, 2)).toBe("+200.00");
  expect(formatSignedAmount(-200, 2)).toBe("-200.00");
  expect(formatSignedAmount(0, 2)).toBe("0.00");
});

/**
 * Display is a rounding boundary like any other, and the dataset's decimals
 * setting is what it rounds to. A pinned 2 made the setting invisible at zero
 * — whole yen still rendered "3,333.00" — and LOSSY at three or four, where it
 * hid precision the dataset really holds.
 */
test("the digit count is the dataset's setting, not a fixed two", () => {
  expect(formatAmount(3333, 0)).toBe("3,333");
  expect(formatAmount(1.234, 3)).toBe("1.234");
  expect(formatAmount(1.2345, 4)).toBe("1.2345");
  expect(formatMoney(3333, "JPY", 0)).toBe("3,333 JPY");
  expect(formatSignedMoney(3333, "JPY", 0)).toBe("+3,333 JPY");
  expect(formatSignedAmount(-3333, 0)).toBe("-3,333");
});

test("both bounds are pinned, so a whole number still shows its decimals", () => {
  // minimumFractionDigits as well as maximum: an even 200 must read "200.00"
  // beside "199.95", or a column of money stops lining up.
  expect(formatAmount(200, 2)).toBe("200.00");
  expect(formatAmount(200, 3)).toBe("200.000");
});

/** The locale stays pinned, so output cannot differ between a machine and CI. */
test("grouping and the decimal mark do not follow the host locale", () => {
  expect(formatAmount(1234567.89, 2)).toBe("1,234,567.89");
});
