/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

import { precacheUrls } from "./swPrecache.ts";

// Both are replaced at build time by Bun.build's `define`.
const PRECACHE: string[] = JSON.parse(process.env.PRECACHE_MANIFEST ?? "[]");
const VERSION = process.env.SW_VERSION ?? "dev";
const BASE = process.env.BUN_PUBLIC_BASE_PATH ?? "/";

const CACHE = `budget2-${VERSION}`;
const SHELL = `${BASE}index.html`;

self.addEventListener("install", (event) => {
  // Deduped: addAll() rejects the whole install on a repeated request, and the
  // build's own outputs already contain the shell. See src/swPrecache.ts.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(precacheUrls(PRECACHE, SHELL))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous versions.
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  // Sent by applyUpdate() when the user accepts a new version.
  if ((event.data as { type?: string } | undefined)?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never cache the rate API

  // Navigations fall back to the cached shell, which also covers deep links.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          return (await caches.match(SHELL)) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Hashed assets: cache-first, since a changed file gets a new name.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        void cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
