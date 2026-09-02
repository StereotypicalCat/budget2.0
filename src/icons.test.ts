import { test, expect, describe } from "bun:test";
import { inflateSync } from "node:zlib";
import { buildManifest } from "./manifest.ts";

/**
 * Chrome's install prompt wants raster icons at 192 and 512; an SVG alone
 * leaves it incomplete. These are generated from src/icon.svg by
 * `bun scripts/make-icons.ts` — see that file for why they are committed
 * rather than built.
 */
const SIZES = [192, 512] as const;

/** Width and height straight out of the IHDR chunk, which is always first. */
function pngHeader(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = [...bytes.slice(0, 8)];
  return {
    isPng: String.fromCharCode(...signature.slice(1, 4)) === "PNG",
    width: view.getUint32(16),
    height: view.getUint32(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  };
}

/** Concatenated IDAT payloads, inflated. */
function pixelBytes(bytes: Uint8Array): Buffer {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [];
  let i = 8;
  while (i < bytes.length) {
    const length = view.getUint32(i);
    const type = String.fromCharCode(...bytes.slice(i + 4, i + 8));
    if (type === "IDAT") chunks.push(bytes.slice(i + 8, i + 8 + length));
    i += 12 + length;
  }
  return inflateSync(Buffer.concat(chunks));
}

describe("the app icons", () => {
  for (const size of SIZES) {
    test(`icon-${size}.png is a real ${size}x${size} image, not a placeholder`, async () => {
      const bytes = new Uint8Array(await Bun.file(`src/icon-${size}.png`).arrayBuffer());
      const header = pngHeader(bytes);

      expect(header.isPng).toBe(true);
      expect(header.width).toBe(size);
      expect(header.height).toBe(size);
      expect(header.bitDepth).toBe(8);
      expect(header.colorType).toBe(6); // RGBA

      // One filter byte plus 4 channels per pixel, per row. Proves the pixel
      // data is really present and really that size, so a truncated or
      // stub file cannot pass.
      expect(pixelBytes(bytes).length).toBe(size * (1 + size * 4));
    });
  }

  test("the manifest offers both raster sizes as well as the SVG", () => {
    const icons = JSON.parse(buildManifest("/budget/")).icons as Array<{
      src: string;
      sizes: string;
      type: string;
    }>;
    expect(icons.map((i) => i.sizes)).toEqual(["any", "192x192", "512x512"]);
    expect(icons.map((i) => i.src)).toEqual([
      "/budget/icon.svg",
      "/budget/icon-192.png",
      "/budget/icon-512.png",
    ]);
    expect(icons.every((i) => i.src.startsWith("/budget/"))).toBe(true);
  });
});
