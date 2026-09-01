import tailwind from "bun-plugin-tailwind";
import { rm } from "node:fs/promises";
import path from "node:path";
import { normalizeBase } from "./src/ui/basePath.ts";

const basePath = normalizeBase(process.env.BUN_PUBLIC_BASE_PATH);
const outdir = path.join(process.cwd(), "dist");
const version = process.env.BUILD_VERSION ?? String(Date.now());

await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [...new Bun.Glob("src/**/*.html").scanSync()],
  outdir,
  plugins: [tailwind],
  minify: true,
  target: "browser",
  sourcemap: "linked",
  // publicPath prefixes asset and chunk imports, which is what makes a subpath
  // deploy work without hardcoding it anywhere.
  publicPath: basePath,
  naming: {
    // NOTE: the brief specified "[dir]/[name].[ext]" here. With a single HTML
    // entrypoint at src/index.html, [dir] resolves to "src", which puts the
    // built file at dist/src/index.html instead of dist/index.html. That
    // breaks the dist/404.html copy below (it reads dist/index.html) and the
    // Task 25 static server (which must find index.html at the dist root).
    // Verified by building with both values and inspecting `ls -R dist`.
    entry: "[name].[ext]",
    chunk: "[name]-[hash].[ext]",
    asset: "[name]-[hash].[ext]",
  },
  // index.html references manifest.webmanifest and icon.svg via plain <link>
  // hrefs. Bun's HTML bundler otherwise treats every <link href> as a module
  // reference to resolve, bundle, and (for assets) hash — which both fails
  // outright for manifest.webmanifest (it doesn't exist as a source file; it
  // is generated below, after this build step) and would hash icon.svg,
  // breaking the fixed "icon.svg" paths that manifest.webmanifest and the
  // service worker precache list depend on. Marking these globs external
  // leaves both hrefs untouched in the output HTML, so they resolve as plain
  // relative URLs against the page, exactly as the spec intends.
  external: ["*.webmanifest", "*.svg"],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env.BUN_PUBLIC_BASE_PATH": JSON.stringify(basePath),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("Build failed");
}

// The precache list comes from the build's own outputs, so hashed filenames can
// never drift out of sync with the service worker.
const precache = result.outputs
  .filter((output) => !output.path.endsWith(".map"))
  .map((output) => basePath + path.relative(outdir, output.path).replaceAll(path.sep, "/"));

const swResult = await Bun.build({
  entrypoints: ["src/sw.ts"],
  outdir,
  target: "browser",
  minify: true,
  naming: "sw.js", // must be a stable URL, so no hash
  define: {
    "process.env.PRECACHE_MANIFEST": JSON.stringify(JSON.stringify(precache)),
    "process.env.SW_VERSION": JSON.stringify(version),
    "process.env.BUN_PUBLIC_BASE_PATH": JSON.stringify(basePath),
  },
});

if (!swResult.success) {
  for (const log of swResult.logs) console.error(log);
  throw new Error("Service worker build failed");
}

export function buildManifest(base: string): string {
  return JSON.stringify(
    {
      name: "Budget 2.0",
      short_name: "Budget",
      start_url: base,
      scope: base,
      display: "standalone",
      background_color: "#0f172a",
      theme_color: "#0f172a",
      icons: [{ src: `${base}icon.svg`, sizes: "any", type: "image/svg+xml" }],
    },
    null,
    2,
  );
}

await Bun.write(path.join(outdir, "manifest.webmanifest"), buildManifest(basePath));
await Bun.write(path.join(outdir, "icon.svg"), Bun.file("src/icon.svg"));

// GitHub Pages has no rewrite rules, so a deep link on a cold load lands on
// 404.html. Serving the shell from there makes client-side routing work.
const indexHtml = await Bun.file(path.join(outdir, "index.html")).text();
await Bun.write(path.join(outdir, "404.html"), indexHtml);

console.log(`Built for base path ${basePath}`);
for (const output of result.outputs) {
  console.log(
    `  ${path.relative(process.cwd(), output.path)}  ${(output.size / 1024).toFixed(1)} KB`,
  );
}
