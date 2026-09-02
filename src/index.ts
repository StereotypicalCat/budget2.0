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
    "/*": index,
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`Dev server running at ${server.url}`);
