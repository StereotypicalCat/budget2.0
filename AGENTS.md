# Agent guide

This repository's agent instructions live in **`CLAUDE.md`** — read it first.
It carries the project invariants, the gotchas that cost real bugs, and the
validation this codebase deliberately does not perform.

Then, depending on what you are doing:

- **Changing anything structural** → `docs/ARCHITECTURE.md` (layers, data flow, and
  why the non-obvious choices are what they are).
- **Picking up queued work** → `docs/TODO.md` (ordered, each item carrying the
  reasoning already settled).
- **Making a product decision** → `docs/PRODUCT.md` (who this is for, what must never
  break, and what must not be invented).
- **Wondering why something is the way it is** → `docs/specs/`
  records the decisions *and the alternatives that were rejected*.

Two rules worth knowing before your first edit:

1. **Bun only.** `bun test`, `bun run`, `bunx`. Never npm, jest, vitest or vite.
2. **There IS a browser here** — `bun scripts/screenshot.ts <url> <out.png>`
   drives headless Chrome and hands you a PNG to look at. Read CLAUDE.md's
   "Verification limits" first: the container's fonts lie, and offline, the
   install prompt, the `.ods` in a spreadsheet, and how anything *feels* still
   need a human. Say so rather than claiming it works.
