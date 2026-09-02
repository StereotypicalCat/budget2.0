import { test, expect, describe } from "bun:test";
import { parseMoneyInput, type CurrencyOption } from "./moneyInput.ts";

const OPTIONS: CurrencyOption[] = [
  { code: "DKK", symbol: "kr" },
  { code: "USD", symbol: "$" },
  { code: "EUR", symbol: "€" },
];
const parse = (text: string, fallback = "DKK") =>
  parseMoneyInput(text, OPTIONS, fallback);

describe("reading the currency out of what was typed", () => {
  test("a trailing symbol", () => {
    expect(parse("30$")).toEqual({ amount: 30, currency: "USD" });
  });

  test("a leading symbol", () => {
    expect(parse("$30")).toEqual({ amount: 30, currency: "USD" });
  });

  test("a symbol with a space either side", () => {
    expect(parse("30 $")).toEqual({ amount: 30, currency: "USD" });
    expect(parse("$ 30")).toEqual({ amount: 30, currency: "USD" });
  });

  test("a three-letter code, in any case", () => {
    expect(parse("30 usd")).toEqual({ amount: 30, currency: "USD" });
    expect(parse("USD 30")).toEqual({ amount: 30, currency: "USD" });
    expect(parse("30EUR")).toEqual({ amount: 30, currency: "EUR" });
  });

  test("a multi-letter symbol", () => {
    expect(parse("250 kr")).toEqual({ amount: 250, currency: "DKK" });
    expect(parse("250kr")).toEqual({ amount: 250, currency: "DKK" });
  });

  test("no currency at all falls back to the one the field is in", () => {
    expect(parse("30")).toEqual({ amount: 30, currency: "DKK" });
    expect(parse("30", "EUR")).toEqual({ amount: 30, currency: "EUR" });
  });

  test("a code wins over a symbol when both appear", () => {
    // "$30 USD" is contradictory; the explicit code is the stronger signal.
    expect(parse("$30 USD")).toEqual({ amount: 30, currency: "USD" });
  });

  test("an unknown currency is rejected rather than silently ignored", () => {
    // Silently dropping "GBP" would book a GBP purchase as DKK.
    expect(parse("30 GBP")).toBeNull();
    expect(parse("30 £")).toBeNull();
  });
});

describe("reading the number out of what was typed", () => {
  test("plain decimals", () => {
    expect(parse("30.50")).toEqual({ amount: 30.5, currency: "DKK" });
  });

  test("a comma decimal separator, as most of Europe writes it", () => {
    expect(parse("30,50")).toEqual({ amount: 30.5, currency: "DKK" });
    expect(parse("€25,50")).toEqual({ amount: 25.5, currency: "EUR" });
  });

  /**
   * The genuinely ambiguous cases. The rule: when both separators appear, the
   * LAST one is the decimal point. When only one appears, it is a thousands
   * separator if exactly three digits follow it, and a decimal point
   * otherwise. "1,500" is therefore one thousand five hundred, which is what
   * someone typing a budget figure means.
   */
  test("both separators: the last one is the decimal point", () => {
    expect(parse("1.234,56")).toEqual({ amount: 1234.56, currency: "DKK" });
    expect(parse("1,234.56")).toEqual({ amount: 1234.56, currency: "DKK" });
  });

  test("one separator with three digits after it groups thousands", () => {
    expect(parse("1,500")).toEqual({ amount: 1500, currency: "DKK" });
    expect(parse("1.500")).toEqual({ amount: 1500, currency: "DKK" });
  });

  test("one separator with one or two digits after it is a decimal point", () => {
    expect(parse("1,5")).toEqual({ amount: 1.5, currency: "DKK" });
    expect(parse("1.50")).toEqual({ amount: 1.5, currency: "DKK" });
  });

  test("spaces and non-breaking spaces group thousands", () => {
    expect(parse("28 000")).toEqual({ amount: 28000, currency: "DKK" });
    expect(parse("28 000,50")).toEqual({ amount: 28000.5, currency: "DKK" });
  });

  test("a negative amount is legal — a refund is a normal line", () => {
    expect(parse("-500")).toEqual({ amount: -500, currency: "DKK" });
    expect(parse("-30$")).toEqual({ amount: -30, currency: "USD" });
    expect(parse("$-30")).toEqual({ amount: -30, currency: "USD" });
  });

  test("a leading plus is accepted and means nothing", () => {
    expect(parse("+30")).toEqual({ amount: 30, currency: "DKK" });
  });
});

describe("what is not a money value", () => {
  test.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["only a currency", "$"],
    ["only a code", "USD"],
    ["letters", "abc"],
    ["two numbers", "30 40"],
    ["a bare separator", ","],
    ["a lone minus", "-"],
  ])("%s is not a money value", (_label, text) => {
    expect(parse(text)).toBeNull();
  });

  test("a half-typed decimal is not yet a value, and must not become one", () => {
    // Committing "30." as 30 would fight the user mid-keystroke.
    expect(parse("30.")).toBeNull();
    expect(parse("30,")).toBeNull();
  });
});

describe("symbols that collide", () => {
  const withCollision: CurrencyOption[] = [
    { code: "USD", symbol: "$" },
    { code: "CAD", symbol: "$" },
  ];

  test("the first currency defined with that symbol wins, and the code disambiguates", () => {
    expect(parseMoneyInput("30$", withCollision, "USD")).toEqual({
      amount: 30,
      currency: "USD",
    });
    expect(parseMoneyInput("30 CAD", withCollision, "USD")).toEqual({
      amount: 30,
      currency: "CAD",
    });
  });
});
