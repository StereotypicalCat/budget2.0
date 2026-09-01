# Budget 2.0

A personal budgeting PWA. Envelope-style monthly budgets with rollover, split
purchases, finance plans, multi-currency, and JSON/ODS export. All data lives in
your browser — there is no server and no account.

## Development

```bash
bun install
bun --hot src/index.ts    # dev server with hot reload
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
budget to another device. Import replaces everything and downloads a backup of
your current data first.

## Known limitations

- **Data is per-browser.** There is no account and no sync. If you clear this
  browser's site data, or move to a different browser or device, your budget is
  gone unless you exported it first. The JSON export is not just a nice-to-have
  backup — it is the only way to move a budget between devices.
- **The install prompt is incomplete.** `manifest.webmanifest` currently only
  ships an SVG icon. Chrome requires PNG icons at 192×192 and 512×512 to offer
  the "Install app" prompt; until those are added, the app works fine as a
  regular tab but won't be installable on Chrome/Chromium.

## Documentation

- Design: `docs/superpowers/specs/2026-09-01-budget-app-design.md`
- Implementation plan: `docs/superpowers/plans/2026-09-01-budget-app.md`
