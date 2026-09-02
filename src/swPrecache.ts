/**
 * The exact list the service worker precaches on install.
 *
 * Separate from src/sw.ts so it can be tested: importing sw.ts outside a
 * worker would run its `self.addEventListener` calls.
 *
 * Deduplication is the whole point. `cache.addAll()` rejects the ENTIRE
 * install with InvalidStateError if the same request appears twice, and the
 * build's precache list is derived from its own outputs — which already
 * include index.html — while the worker also needs the shell by name. Those
 * two facts collided silently: install failed on every load, the worker went
 * redundant, and no service worker ever activated. Registration itself
 * succeeds, so nothing surfaced it.
 *
 * Deduping here rather than in build.ts means no future addition to either
 * list can reintroduce the collision.
 */
export function precacheUrls(precache: readonly string[], shell: string): string[] {
  return [...new Set([...precache, shell])];
}
