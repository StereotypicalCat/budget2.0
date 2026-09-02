/**
 * The one definition of the web app manifest, shared by `build.ts` (which
 * writes it into dist/) and the dev server (which generates it per request).
 * Two copies is how the dev placeholder came to hardcode `scope: "/"` while
 * production correctly used the base path.
 *
 * `base` always ends in "/" — see `normalizeBase` in src/ui/basePath.ts.
 */
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
      // The SVG first for anything that will scale it; the raster sizes
      // because Chrome's install prompt wants 192 and 512 specifically.
      icons: [
        { src: `${base}icon.svg`, sizes: "any", type: "image/svg+xml" },
        { src: `${base}icon-192.png`, sizes: "192x192", type: "image/png" },
        { src: `${base}icon-512.png`, sizes: "512x512", type: "image/png" },
      ],
    },
    null,
    2,
  );
}
