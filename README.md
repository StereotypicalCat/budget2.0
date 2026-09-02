# Budget 2.0

A personal budgeting PWA. Envelope-style monthly budgets with rollover, split
purchases, finance plans, multi-currency, and JSON/ODS export. All data lives in
your browser — there is no server and no account.

## Development

```bash
bun install
bun run dev               # dev server with hot reload, on :3000
bun test                  # run the test suite
bun run build             # production build into dist/
```

## Self-hosting with Docker

```bash
docker build -t budget2 .
docker run --rm -p 3000:3000 budget2
```

To serve from a subpath, build and run with `BUN_PUBLIC_BASE_PATH`:

```bash
docker build -t budget2 --build-arg BUN_PUBLIC_BASE_PATH=/budget/ .
docker run --rm -p 3000:3000 -e BUN_PUBLIC_BASE_PATH=/budget/ budget2
```

## GitHub Pages

Pushing to `main` builds and deploys to Pages automatically, using
`/<repository-name>/` as the base path. Enable Pages with "GitHub Actions" as
the source in the repository settings.

## Your data

Everything is stored in this browser's IndexedDB. **Export regularly** from
Settings → Your data: the JSON export is both your backup and how you move your
budget to another device.

Both destructive actions there — Import, and "Reset everything" — download a
backup of your current data before replacing it, and abort if that download
fails. Reset puts the app back to a brand-new install: the three starter posts,
the DKK/USD/EUR currency table, this month at zero income, no purchases.

## Known limitations

- **Data is per-browser.** There is no account and no sync. If you clear this
  browser's site data, or move to a different browser or device, your budget is
  gone unless you exported it first. The JSON export is not just a nice-to-have
  backup — it is the only way to move a budget between devices.
- **Installing and offline use are unverified.** The manifest ships the SVG plus
  192×192 and 512×512 PNG icons, and the service worker demonstrably installs,
  activates and precaches every asset — but nobody has yet confirmed that Chrome
  offers its "Install app" prompt, or loaded the app with the network actually
  cut. It works as a regular tab regardless.

## Documentation

- `docs/ARCHITECTURE.md` — layers, data flow, and why the non-obvious choices are
  what they are.
- `docs/PRODUCT.md` — who this is for and what must never break.
- `AGENTS.md` — the rules for changing this codebase, and the test that catches
  each one when broken. `CLAUDE.md` and `GEMINI.md` point at it.
- `docs/TODO.md` — what is still queued.
- `docs/specs/` — one design document per piece of work, each
  recording the alternatives that were rejected.
- `docs/plans/` — task-by-task implementation plans.
