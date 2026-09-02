import tailwind from "bun-plugin-tailwind";
import { rm } from "node:fs/promises";
import path from "node:path";
import { normalizeBase } from "./src/ui/basePath.ts";
import { buildManifest } from "./src/manifest.ts";
import { FONT_FILES } from "./src/fontCss.ts";
import { buildFxUrl, parseFxResponse, DEFAULT_FX_API_URL } from "./src/store/fxApi.ts";
import { FALLBACK_FX_RATES } from "./src/store/bakedRates.ts";
import type { Currency, FxRate } from "./src/domain/types.ts";

const basePath = normalizeBase(process.env.BUN_PUBLIC_BASE_PATH);
const outdir = path.join(process.cwd(), "dist");
const version = process.env.BUILD_VERSION ?? String(Date.now());

const FX_BASE: Currency = "DKK";
const FX_TARGETS: Currency[] = ["USD", "EUR"];
const FX_TIMEOUT_MS = 8_000;

/**
 * Exchange rates embedded at build time so a fresh install can convert a EUR
 * purchase on day one instead of erroring. They seed a new dataset only — see
 * src/store/bakedRates.ts for why they must never backstop a missing rate.
 *
 * A network failure must NOT fail the build: it falls back to the committed
 * constants, which are labelled "manual" so Settings never claims a hardcoded
 * number came from a rate service. Fetched rates carry the build date rather
 * than the date the browser happens to run, which is why parseFxResponse
 * takes an explicit `updatedAt`.
 *
 * SKIP_FX_FETCH=1 forces the constants, for offline or reproducible builds.
 * FX_API_URL overrides the endpoint.
 */
async function bakeFxRates(): Promise<readonly FxRate[]> {
  const buildDate = new Date().toISOString().slice(0, 10);
  const describe = (rates: readonly FxRate[]) =>
    rates.map((r) => `${r.currency} ${r.baseUnitsPerOne}`).join(", ");

  if (process.env.SKIP_FX_FETCH === "1") {
    console.log(`Baking the committed FX constants (SKIP_FX_FETCH=1): ${describe(FALLBACK_FX_RATES)}`);
    return FALLBACK_FX_RATES;
  }

  const template = process.env.FX_API_URL ?? DEFAULT_FX_API_URL;
  try {
    const response = await fetch(buildFxUrl(template, FX_BASE, FX_TARGETS), {
      signal: AbortSignal.timeout(FX_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`rate service returned ${response.status}`);

    const rates = parseFxResponse(await response.json(), FX_BASE, buildDate);
    // A partial response would leave one currency unconvertible on a fresh
    // install, which is the whole problem this solves. Prefer the complete
    // constants over an incomplete live answer.
    const covered = new Set(rates.map((r) => r.currency));
    const missing = FX_TARGETS.filter((c) => !covered.has(c));
    if (missing.length > 0) throw new Error(`response omitted ${missing.join(", ")}`);

    console.log(`Baked live FX rates for ${buildDate}: ${describe(rates)}`);
    return rates;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.warn(
      `Could not fetch FX rates (${message}); baking the committed constants instead: ${describe(FALLBACK_FX_RATES)}`,
    );
    return FALLBACK_FX_RATES;
  }
}

const bakedFxRates = await bakeFxRates();

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
    // Double-encoded on purpose: the inlined literal must be a JSON *string*
    // for parseBakedRates to parse at runtime.
    "process.env.BUN_PUBLIC_BAKED_FX_RATES": JSON.stringify(JSON.stringify(bakedFxRates)),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("Build failed");
}

/**
 * Written to dist below rather than emitted by the bundler, so they are absent
 * from `result.outputs` and have to be listed for the precache by name.
 * Without them an installed app cannot render its own icon offline, and the
 * manifest 404s.
 */
const STATIC_ASSETS = [
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  ...FONT_FILES.map((file) => `fonts/${file}`),
];

// The precache list comes from the build's own outputs, so hashed filenames can
// never drift out of sync with the service worker.
const precache = [
  ...result.outputs
    .filter((output) => !output.path.endsWith(".map"))
    .map((output) => basePath + path.relative(outdir, output.path).replaceAll(path.sep, "/")),
  ...STATIC_ASSETS.map((file) => basePath + file),
];

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

await Bun.write(path.join(outdir, "manifest.webmanifest"), buildManifest(basePath));
await Bun.write(path.join(outdir, "icon.svg"), Bun.file("src/icon.svg"));
for (const size of [192, 512]) {
  await Bun.write(
    path.join(outdir, `icon-${size}.png`),
    Bun.file(`src/icon-${size}.png`),
  );
}
for (const file of FONT_FILES) {
  await Bun.write(path.join(outdir, "fonts", file), Bun.file(`src/fonts/${file}`));
}

// This is an SPA: every route serves the same shell, so the *document* URL
// can be several segments deep (e.g. /budget2.0/month/2026-09). Relative
// hrefs in the built HTML resolve against that document URL, not the site
// root, so "manifest.webmanifest" and "icon.svg" would 404 on any route
// with more path segments than the base path itself. Rewrite them to be
// absolute (prefixed with basePath, which always ends in "/") so they
// resolve correctly no matter how deep the current route is. Done here
// rather than hardcoded in src/index.html so the dev server (which always
// serves from "/") keeps working unchanged.
let indexHtml = await Bun.file(path.join(outdir, "index.html")).text();
// src/index.html references these relatively, because the dev server's HTML
// bundler resolves every <link href> from disk and cannot be told to skip an
// absolute one. Relative hrefs would 404 on any route deeper than the base
// (/budget2.0/month/2026-09 resolves them against /budget2.0/month/), so
// rewrite them absolute here. At "/" each replacement is a no-op.
for (const asset of ["manifest.webmanifest", "icon.svg"]) {
  indexHtml = indexHtml.replace(`href="${asset}"`, `href="${basePath}${asset}"`);
}
await Bun.write(path.join(outdir, "index.html"), indexHtml);

// GitHub Pages has no rewrite rules, so a deep link on a cold load lands on
// 404.html. Serving the shell from there makes client-side routing work.
await Bun.write(path.join(outdir, "404.html"), indexHtml);

console.log(`Built for base path ${basePath}`);
for (const output of result.outputs) {
  console.log(
    `  ${path.relative(process.cwd(), output.path)}  ${(output.size / 1024).toFixed(1)} KB`,
  );
}
