import { test, expect, describe } from "bun:test";

/**
 * AGENTS.md's hardest-won rule, made mechanical.
 *
 * shadcn uses several tokens as a BACKGROUND with a paired FOREGROUND for the
 * text on it. Redefining one without the other repaints the background and
 * leaves the text at the old colour — which is how overriding a bare
 * `--accent` once dropped hover contrast below AA across the whole app. The
 * damage is invisible in code review and invisible in a passing test suite.
 *
 * So: in any block that redefines one of these, its pair must be redefined in
 * the same block.
 */
const PAIRS = [
  ["--background", "--foreground"],
  ["--card", "--card-foreground"],
  ["--popover", "--popover-foreground"],
  ["--primary", "--primary-foreground"],
  ["--secondary", "--secondary-foreground"],
  ["--muted", "--muted-foreground"],
  ["--accent", "--accent-foreground"],
] as const;

/** Top-level `selector { ... }` blocks. Nested at-rules are not used here. */
function blocks(css: string): { selector: string; body: string }[] {
  const found: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of css.matchAll(re)) {
    found.push({ selector: match[1]!.trim(), body: match[2]! });
  }
  return found;
}

export function findUnpairedTokens(css: string): string[] {
  const problems: string[] = [];
  for (const { selector, body } of blocks(css)) {
    const defines = (token: string) =>
      new RegExp(`(^|[;\\s])${token}\\s*:`).test(body);
    for (const [background, foreground] of PAIRS) {
      if (defines(background) && !defines(foreground)) {
        problems.push(`${selector} sets ${background} without ${foreground}`);
      }
      if (defines(foreground) && !defines(background)) {
        problems.push(`${selector} sets ${foreground} without ${background}`);
      }
    }
  }
  return problems;
}

describe("the paired-token guard itself", () => {
  test("catches a background redefined without its foreground", () => {
    expect(findUnpairedTokens(":root { --accent: #eee; }")).toEqual([
      ":root sets --accent without --accent-foreground",
    ]);
  });

  test("catches a foreground redefined without its background", () => {
    expect(findUnpairedTokens(".dark { --primary-foreground: #fff; }")).toEqual([
      ".dark sets --primary-foreground without --primary",
    ]);
  });

  test("accepts a pair defined together", () => {
    expect(
      findUnpairedTokens(":root { --accent: #eee; --accent-foreground: #111; }"),
    ).toEqual([]);
  });

  test("is not fooled by a token whose name merely ends the same way", () => {
    // --sidebar-accent must not be read as --accent.
    expect(findUnpairedTokens(":root { --sidebar-accent: #eee; }")).toEqual([]);
  });
});

test("src/index.css never redefines a shadcn token without its pair", async () => {
  const css = await Bun.file("src/index.css").text();
  expect(findUnpairedTokens(css)).toEqual([]);
});
