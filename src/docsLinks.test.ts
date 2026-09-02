import { test, expect } from "bun:test";
import { $, Glob } from "bun";
import { dirname, join, normalize } from "node:path";

/**
 * Every repository path named in the documentation must be in the repository.
 *
 * This exists because moving the docs into `docs/` rewrote about thirty
 * cross-references at once. A reference left pointing at nothing does not fail
 * a build, does not fail a test, and does not look wrong in review — it is only
 * discovered by the next person who follows it and finds nothing there. The
 * same silence is why `eventCapture.test.ts` and `cssTokens.test.ts` exist.
 *
 * TRACKED, not merely present. The first version of this test only checked the
 * filesystem, passed locally, and failed in CI: TODO.md was sending readers to
 * `.superpowers/sdd/...`, a tool-managed ledger that ignores its own contents
 * and has never been part of the repository. It existed on the machine that
 * wrote the reference and nowhere else, which is precisely the reference a
 * reader cannot follow. Asking git rather than the disk is what makes a fresh
 * clone the standard, so the check means the same thing everywhere.
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

/** Paths named deliberately BECAUSE they are not in the repository. */
const EXPECTED_ABSENT = new Map([
  [
    "docs/superpowers/specs/",
    "AGENTS.md §4 names it as the tooling default to override; it was removed on purpose.",
  ],
  [
    ".superpowers/",
    "docs/TODO.md names it to explain that the ledger it held was never committed.",
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

/** Null when git cannot answer — a tarball, no git binary — so the check degrades. */
async function trackedFiles(): Promise<Set<string> | null> {
  try {
    const listing = await $`git ls-files`.quiet().text();
    const files = listing.split("\n").filter(Boolean);
    return files.length > 0 ? new Set(files) : null;
  } catch {
    return null;
  }
}

async function onDisk(path: string): Promise<boolean> {
  const clean = path.replace(/\/$/, "");
  if (await Bun.file(clean).exists()) return true;
  // Bun.file().exists() is false for a directory, so probe it as one.
  try {
    return [...new Glob("*").scanSync({ cwd: clean, onlyFiles: false })].length >= 0;
  } catch {
    return false;
  }
}

function isTracked(path: string, tracked: Set<string>): boolean {
  const clean = path.replace(/\/$/, "");
  if (tracked.has(clean)) return true;
  const prefix = `${clean}/`;
  for (const file of tracked) if (file.startsWith(prefix)) return true;
  return false;
}

test("every repository path named in the documentation is in the repository", async () => {
  const tracked = await trackedFiles();
  const resolves = tracked
    ? (path: string) => isTracked(path, tracked)
    : (path: string) => onDisk(path);

  const files = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "README.md"];
  for await (const file of new Glob("docs/*.md").scan(".")) files.push(file);

  const broken: string[] = [];

  for (const file of files) {
    const source = await Bun.file(file).text();
    for (const candidate of candidatesIn(source)) {
      if (EXPECTED_ABSENT.has(candidate)) continue;
      const fromFile = normalize(join(dirname(file), candidate));
      if ((await resolves(fromFile)) || (await resolves(candidate))) continue;
      broken.push(`${file} names ${candidate}`);
    }
  }

  expect(broken).toEqual([]);
});

test("membership in git's index is the standard, not presence on disk", async () => {
  // Asserted against a synthetic index, NOT against whatever happens to be in
  // this working copy. The first version of this very test checked that
  // `.superpowers/sdd` was on disk — true on the machine that wrote it, false
  // in a fresh clone — and so failed in CI for the same reason the guard was
  // written: a check that depends on untracked local state proves nothing.
  const index = new Set(["docs/specs/a-design.md", "src/domain/fold.ts"]);
  expect(isTracked("docs/specs", index)).toBe(true);
  expect(isTracked("docs/specs/", index)).toBe(true);
  expect(isTracked("src/domain/fold.ts", index)).toBe(true);
  expect(isTracked(".superpowers/sdd", index)).toBe(false);
  expect(isTracked("docs/spec", index)).toBe(false); // a prefix is not a parent

  const tracked = await trackedFiles();
  if (!tracked) return; // git unavailable: the filesystem fallback is used
  expect(isTracked("docs/specs", tracked)).toBe(true);
  expect(isTracked("src/domain/fold.ts", tracked)).toBe(true);
  expect(isTracked("docs/superpowers/specs", tracked)).toBe(false);
  expect(isTracked(".superpowers/sdd", tracked)).toBe(false);
});

test("the filesystem fallback answers for paths every checkout has", async () => {
  expect(await onDisk("src/domain/fold.ts")).toBe(true);
  expect(await onDisk("docs/specs")).toBe(true);
  expect(await onDisk("docs/superpowers/specs")).toBe(false);
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
