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
      icons: [{ src: `${base}icon.svg`, sizes: "any", type: "image/svg+xml" }],
    },
    null,
    2,
  );
}
