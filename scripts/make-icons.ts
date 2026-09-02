/**
 * Rasterizes src/icon.svg into the PNG sizes Chrome's install prompt wants.
 *
 *   bun scripts/make-icons.ts
 *
 * The output is COMMITTED rather than produced by build.ts, because this needs
 * a Chrome binary on PATH and the build must not. Re-run it whenever
 * src/icon.svg changes; src/icons.test.ts checks the committed files are real
 * images of the right dimensions, but it cannot tell you they are STALE.
 *
 * Chrome is the rasterizer because it is the only one present in this
 * environment — no ImageMagick, no rsvg-convert, no cairosvg. It renders the
 * SVG in a page sized exactly to the target, on a transparent backdrop, so the
 * icon's own rounded corners stay transparent.
 */
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const SIZES = [192, 512];
const CHROME = process.env.CHROME ?? "google-chrome";
/** Chrome has been seen not to exit on its own here, so never wait forever. */
const TIMEOUT_MS = 60_000;

const work = await mkdtemp(path.join(tmpdir(), "budget-icons-"));
try {
  await Bun.write(path.join(work, "icon.svg"), Bun.file("src/icon.svg"));
  await Bun.write(
    path.join(work, "wrap.html"),
    `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
img{display:block;width:100vw;height:100vh}</style>
<img src="icon.svg">`,
  );

  for (const size of SIZES) {
    const out = path.join(work, `icon-${size}.png`);
    const chrome = Bun.spawn(
      [
        CHROME,
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--no-first-run",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--default-background-color=00000000",
        `--screenshot=${out}`,
        `--window-size=${size},${size}`,
        `file://${path.join(work, "wrap.html")}`,
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    const timer = setTimeout(() => chrome.kill(), TIMEOUT_MS);
    await chrome.exited;
    clearTimeout(timer);
    if (!(await Bun.file(out).exists())) {
      throw new Error(`${CHROME} wrote no screenshot for ${size}px`);
    }

    const bytes = new Uint8Array(await Bun.file(out).arrayBuffer());
    const view = new DataView(bytes.buffer);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width !== size || height !== size) {
      throw new Error(`Expected ${size}x${size}, got ${width}x${height}`);
    }

    const dest = `src/icon-${size}.png`;
    await Bun.write(dest, bytes);
    console.log(`${dest}  ${width}x${height}  ${bytes.length} bytes`);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
