import { serve } from "bun";
import path from "node:path";

const root = path.join(import.meta.dir, "dist");
const port = Number(process.env.PORT ?? 3000);
const basePath = (process.env.BUN_PUBLIC_BASE_PATH ?? "/").replace(/\/*$/, "/");

serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);

    if (basePath !== "/" && pathname.startsWith(basePath)) {
      pathname = `/${pathname.slice(basePath.length)}`;
    }

    // Reject traversal before touching the filesystem. `startsWith(root)`
    // alone is insufficient: with root = "/app/dist", a request resolving to
    // "/app/dist-evil/x" would pass that check while escaping the intended
    // directory. Require an exact match or a match followed by the path
    // separator.
    const resolved = path.join(root, pathname);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return new Response("Forbidden", { status: 403 });
    }

    const file = Bun.file(resolved);
    if (await file.exists()) {
      const headers =
        // sw.js must never be served stale, or updates can never land.
        pathname.endsWith("/sw.js")
          ? { "Cache-Control": "no-cache" }
          : /-[A-Za-z0-9]{8,}\.(js|css)$/.test(pathname)
            ? { "Cache-Control": "public, max-age=31536000, immutable" }
            : { "Cache-Control": "no-cache" };
      return new Response(file, { headers });
    }

    // Client-side routing: unknown paths get the shell.
    return new Response(Bun.file(path.join(root, "index.html")), {
      headers: { "Cache-Control": "no-cache", "Content-Type": "text/html" },
    });
  },
});

console.log(`Serving dist on http://localhost:${port}${basePath}`);
