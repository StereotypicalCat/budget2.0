import { test, expect } from "bun:test";
import { Glob } from "bun";
import { dirname, join, normalize } from "node:path";

/**
 * Every repository path named in the documentation must exist.
 *
 * This exists because moving the docs into `docs/` rewrote about thirty
 * cross-references at once. A reference left pointing at nothing does not fail
 * a build, does not fail a test, and does not look wrong in review — it is only
 * discovered by the next person who follows it and finds nothing there. The
 * same silence is why `eventCapture.test.ts` and `cssTokens.test.ts` exist.
 *
 * Two kinds of reference are checked: markdown links, and backticked strings
 * that look like paths. A candidate passes if it resolves either relative to
 * the file naming it or from the repository root, because both conventions are
 * in use and both are unambiguous to a reader.
 *
 * Scope is the docs a reader NAVIGATES — the entry points and `docs/*.md`. It
 * deliberately excludes `docs/specs/` and `docs/plans/`, which are dated
 * records of what was decided and built at a moment in time: a plan naming
 * `src/App.tsx` is describing scaffolding it went on to delete, and holding
 * history to today's tree would force either rewriting the past or deleting the
 * guard.
 *
 * Also skipped: fenced code blocks (shell recipes, `/tmp` paths, URLs),
 * absolute paths, and backticked strings starting with `./` or `../`, which are
 * import specifiers relative to some source file rather than repository paths.
 */

/** Paths named deliberately BECAUSE they do not exist. */
const EXPECTED_ABSENT = new Map([
  [
    "docs/superpowers/specs/",
    "AGENTS.md §4 names it as the tooling default to override; it was removed on purpose.",
  ],
]);

function stripCodeBlocks(markdown: string): string {
  return markdown.replace(/^```[\s\S]*?^```/gm, "");
}

/** A candidate is a repo path only if it could not be prose or an identifier. */
function looksLikeRepoPath(candidate: string): boolean {
  if (!candidate.includes("/")) return false; // `sw.js`, `Post.rules`
  if (/[*<>{}|\s]/.test(candidate)) return false; // globs and placeholders
  if (/^[a-z]+:/.test(candidate)) return false; // http:, mailto:
  if (candidate.startsWith("#")) return false; // in-page anchor
  if (candidate.startsWith("/")) return false; // /tmp/shot.png, a URL base path
  return candidate.endsWith("/") || /\.[a-z0-9]+$/i.test(candidate);
}

function candidatesIn(source: string): string[] {
  const body = stripCodeBlocks(source);
  const found = new Set<string>();

  for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]!.split("#")[0]!.trim();
    if (target && looksLikeRepoPath(target)) found.add(target);
  }
  for (const match of body.matchAll(/`([^`\n]+)`/g)) {
    const inner = match[1]!.trim();
    // `../domain/money.ts` in prose is an import specifier, not a repo path.
    if (inner.startsWith("./") || inner.startsWith("../")) continue;
    if (looksLikeRepoPath(inner)) found.add(inner);
  }
  return [...found];
}

async function exists(path: string): Promise<boolean> {
  const clean = path.replace(/\/$/, "");
  if (await Bun.file(clean).exists()) return true;
  // Bun.file().exists() is false for a directory, so probe it as one.
  try {
    return [...new Glob("*").scanSync({ cwd: clean, onlyFiles: false })].length >= 0;
  } catch {
    return false;
  }
}

test("every repository path named in the documentation exists", async () => {
  const files = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "README.md"];
  for await (const file of new Glob("docs/*.md").scan(".")) files.push(file);

  const broken: string[] = [];

  for (const file of files) {
    const source = await Bun.file(file).text();
    for (const candidate of candidatesIn(source)) {
      if (EXPECTED_ABSENT.has(candidate)) continue;
      const fromFile = normalize(join(dirname(file), candidate));
      if ((await exists(fromFile)) || (await exists(candidate))) continue;
      broken.push(`${file} names ${candidate}`);
    }
  }

  expect(broken).toEqual([]);
});

test("the guard resolves both path conventions and rejects a dead one", async () => {
  // Root-relative and file-relative both count, so the check cannot be passed
  // by accident and cannot be tripped by a convention it does not like.
  expect(await exists("docs/specs")).toBe(true);
  expect(await exists("src/domain/fold.ts")).toBe(true);
  expect(await exists("docs/superpowers/specs")).toBe(false);
});

test("prose, identifiers and non-repository paths are not mistaken for paths", () => {
  expect(looksLikeRepoPath("/tmp/shot.png")).toBe(false);
  expect(looksLikeRepoPath("/budget2.0/")).toBe(false);
  expect(looksLikeRepoPath("Post.rules")).toBe(false);
  expect(looksLikeRepoPath("sw.js")).toBe(false);
  expect(looksLikeRepoPath("src/**/*.{ts,tsx}")).toBe(false);
  expect(looksLikeRepoPath("docs/specs/YYYY-MM-DD-<topic>.md")).toBe(false);
  expect(looksLikeRepoPath("http://localhost:3000/month/2026-09")).toBe(false);
  expect(looksLikeRepoPath("src/domain/money.ts")).toBe(true);
  expect(looksLikeRepoPath("docs/specs/")).toBe(true);
});
