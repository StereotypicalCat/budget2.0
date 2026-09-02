import { serve } from "bun";
import index from "./index.html";
import { normalizeBase } from "./ui/basePath.ts";
import { buildManifest } from "./manifest.ts";

const basePath = normalizeBase(process.env.BUN_PUBLIC_BASE_PATH);

const server = serve({
  routes: {
    // index.html references both of these with a plain <link href>. Without
    // explicit routes the "/*" catch-all below answers them with the HTML
    // shell, so the manifest arrives as text/html (a parse error, and no
    // install prompt) and the icon never loads. Generated rather than served
    // from a committed file so the dev manifest cannot drift from the built
    // one — a stale copy is exactly how it came to hardcode scope "/".
    [`${basePath}manifest.webmanifest`]: () =>
      new Response(buildManifest(basePath), {
        headers: { "content-type": "application/manifest+json" },
      }),
    [`${basePath}icon.svg`]: () =>
      new Response(Bun.file(new URL("./icon.svg", import.meta.url)), {
        headers: { "content-type": "image/svg+xml" },
      }),
    [`${basePath}icon-192.png`]: () =>
      new Response(Bun.file(new URL("./icon-192.png", import.meta.url)), {
        headers: { "content-type": "image/png" },
      }),
    [`${basePath}icon-512.png`]: () =>
      new Response(Bun.file(new URL("./icon-512.png", import.meta.url)), {
        headers: { "content-type": "image/png" },
      }),
    // registerServiceWorker() asks for sw.js on every boot. Without this the
    // catch-all answers with the HTML shell and the browser logs
    // "The script has an unsupported MIME type ('text/html')" — caught and
    // harmless, but noise that hides real errors. A worker that claims no
    // clients and handles no fetches keeps registration honest in dev without
    // caching anything, which would fight HMR.
    [`${basePath}sw.js`]: () =>
      new Response("/* dev: intentionally does nothing */\n", {
        headers: { "content-type": "text/javascript", "cache-control": "no-cache" },
      }),
    "/*": index,
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`Dev server running at ${server.url}`);
