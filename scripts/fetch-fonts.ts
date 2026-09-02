/**
 * Downloads the self-hosted webfonts into src/fonts/.
 *
 *   bun scripts/fetch-fonts.ts
 *
 * Self-hosted, not linked from a CDN, because docs/PRODUCT.md's position is that the
 * app works offline and needs no third party: a font request to another origin
 * on every cold load contradicts that, and would leak the fact that the app was
 * opened. The files are COMMITTED so neither the build nor a fresh checkout
 * needs network.
 *
 * Only the `latin` and `latin-ext` subsets are taken. Danish needs æ, ø and å
 * (U+00E6, U+00F8, U+00E5), all inside `latin`; `latin-ext` covers the rest of
 * European diacritics for post names. Cyrillic, Greek and Vietnamese are
 * dropped, which is most of the weight.
 *
 * Both faces are SIL Open Font License 1.1, which permits self-hosting as long
 * as the licence travels with them — hence src/fonts/OFL.txt.
 */
import { mkdir } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const FAMILIES = [
  { css: "Inter:wght@100..900", slug: "inter" },
  { css: "JetBrains+Mono:wght@400..700", slug: "jetbrains-mono" },
];
const WANTED = new Set(["latin", "latin-ext"]);

await mkdir("src/fonts", { recursive: true });

for (const family of FAMILIES) {
  const url = `https://fonts.googleapis.com/css2?family=${family.css}&display=swap`;
  const css = await (await fetch(url, { headers: { "user-agent": UA } })).text();

  // Google labels each @font-face block with a /* subset */ comment above it.
  const blocks = css.split("/*").slice(1);
  let taken = 0;

  for (const block of blocks) {
    const subset = block.slice(0, block.indexOf("*/")).trim();
    if (!WANTED.has(subset)) continue;

    const src = /url\((https:\/\/[^)]+\.woff2)\)/.exec(block)?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim();
    if (!src || !range) throw new Error(`${family.slug}/${subset}: no src or unicode-range`);

    const response = await fetch(src, { headers: { "user-agent": UA } });
    if (!response.ok) throw new Error(`${src} returned ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());

    const file = `src/fonts/${family.slug}-${subset}.woff2`;
    await Bun.write(file, bytes);
    console.log(`${file}  ${bytes.length} bytes`);
    console.log(`  unicode-range: ${range}`);
    taken++;
  }

  if (taken !== WANTED.size) {
    throw new Error(`${family.slug}: took ${taken} subsets, expected ${WANTED.size}`);
  }
}
