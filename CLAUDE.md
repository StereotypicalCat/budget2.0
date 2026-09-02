
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Project invariants (Budget 2.0)

- `src/domain/` is pure: no React, no IndexedDB, no `Date.now()`, no `new Date()`
  without an explicit argument. It must be testable with no DOM.
- Money is a float. Always round with `roundMoney` from `src/domain/money.ts`
  after any division, after any FX conversion, and before persisting.
- When splitting an amount, never round the last part independently. Compute it
  as `total - sum(others)` so the parts sum exactly to the whole.
- `MonthId` is the string `"YYYY-MM"`. Stored data never contains `Date` objects.
- The envelope rollover fold has exactly one implementation, in
  `src/domain/fold.ts`. Year and summary views aggregate over it — they never
  reimplement the math.
- Over-budget is always allowed. Never add validation that blocks it.
- Base path comes from `BUN_PUBLIC_BASE_PATH`; never hardcode a subpath, and
  read it through a `try/catch` accessor — see the gotcha below.
- A post's allocation is a dated series, `Post.rules: RuleVersion[]`, resolved by
  `ruleAt(post, monthId)`. `Post.standingRule` no longer exists. A post with no
  applicable version allocates zero; a per-month override still wins outright.
- Posts are archived, never deleted, because purchases reference them. Archived
  posts still fold.

## Start here

- `ARCHITECTURE.md` — layers, data flow, and why the non-obvious choices are
  what they are. Read it before changing anything structural.
- `TODO.md` — queued work, each item carrying the reasoning already settled.
- `PRODUCT.md` — who this is for and what must never break.
- `docs/superpowers/specs/` — design decisions, including alternatives rejected.

## Gotchas that cost real bugs

Each of these shipped once. Re-introducing one is a regression, not a style
choice.

- **Never read `event.target.value` inside a `mutate()` callback.** `mutate`
  defers behind the write queue; React resets the input's DOM value first, so
  you commit the old value. Capture into a `const` in the handler.
  `src/ui/eventCapture.test.ts` fails the build otherwise.
- **`process.env.BUN_PUBLIC_*` must be read via `try/catch`** (see
  `readBasePathEnv`). Bun inlines the literal only when the variable is set;
  unset, the bare reference reaches the browser and throws before the app boots.
  A `typeof process` guard does not work — it survives inlining and discards the
  inlined value, silently breaking subpath deploys.
- **Never define a bare `--accent` CSS variable.** shadcn owns it; overriding it
  drops hover contrast below WCAG AA app-wide. Project tokens are `--budget-*`.
- **A React error boundary does not catch event-handler throws.** Domain
  functions that throw must be guarded at the call site when called from one.
- **Do not "fix" a domain throw by making it return a fallback.** Silently wrong
  numbers are worse than a visible error in a budgeting app.

## Deliberately absent validation

Adding a "missing" guard here is a regression:

- going over budget, anywhere;
- allocation percentages summing past 100%;
- splits that do not sum to the total (the remainder-absorbing split reconciles
  them by design);
- negative amounts — a refund is a normal line.

## Verification limits

There is no browser in this environment. Visual appearance, offline behaviour,
install and update prompts, keyboard focus traversal, and opening the generated
`.ods` in a spreadsheet **cannot be verified here**. Do not claim you checked
them. Substitute a real check where one exists — structural validation of the
`.ods`, curl against the dev server, pure-function tests — and state plainly
what still needs a human.
