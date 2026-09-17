/// <reference lib="webworker" />

/**
 * Prism Service Worker.
 *
 * Two jobs in one file, because a scope can only have one worker:
 *
 * 1. **Cross-origin isolation.** `SharedArrayBuffer` — and therefore the
 *    multi-threaded ffmpeg core — is only available to a document that is
 *    cross-origin isolated, which needs COOP and COEP response headers.
 *    GitHub Pages cannot send headers at all. So every response this worker
 *    hands back gets them attached. The document then becomes isolated on the
 *    *second* load, once this worker is in control; `register-sw.ts` performs
 *    that one reload.
 *
 * 2. **Offline caching**, in the same stale-while-revalidate spirit as the
 *    other apps in this repository.
 *
 * Scope is `./`, i.e. this app's folder only — the LED Wall Planner and the OSC
 * Pad keep their own workers and are unaffected.
 */

import { isCoreAsset, shouldHandle, withIsolationHeaders } from './sw-headers'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

const VERSION = 'prism-v1.0.0'
const SHELL_CACHE = `${VERSION}-shell`
/** Kept across versions: the cores are ~31 MB each and never change content. */
const CORE_CACHE = 'prism-ffmpeg-core'

const PRECACHE_URLS = self.__WB_MANIFEST.map((entry) =>
  new URL(entry.url, self.location.href).toString(),
)

/* ===========================================================================
   Lifecycle
   ======================================================================== */

/**
 * Precache file by file instead of with `cache.addAll`.
 *
 * addAll is all-or-nothing: a single 404 rejects it, the install fails, and no
 * worker ever activates — which would also take cross-origin isolation down
 * with it. That is far too fragile a dependency for the feature that decides
 * whether ffmpeg gets one thread or eight. Offline coverage degrades quietly
 * instead.
 */
async function precache(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE)
  const results = await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
  const failed = results.filter((r) => r.status === 'rejected').length
  if (failed > 0) {
    console.warn(
      `[Prism SW] ${failed} von ${PRECACHE_URLS.length} Dateien nicht vorgeladen — ` +
        'die App läuft weiter, ist aber möglicherweise nicht vollständig offline verfügbar.',
    )
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precache()
      // Take over immediately: the sooner this worker is active, the sooner the
      // single isolation reload can happen.
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== CORE_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting()
})

/* ===========================================================================
   Fetch
   ======================================================================== */

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (!shouldHandle(request, self.location.origin)) return

  const url = new URL(request.url)

  /* --- ffmpeg cores: immutable and huge, so cache-first and keep forever. --- */
  if (isCoreAsset(url)) {
    event.respondWith(
      caches.open(CORE_CACHE).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return withIsolationHeaders(cached)

        const response = await fetch(request)
        if (response.ok) await cache.put(request, response.clone())
        return withIsolationHeaders(response)
      }),
    )
    return
  }

  /* --- Navigation: network first so updates land, cache as the fallback. --- */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const copy = response.clone()
            const cache = await caches.open(SHELL_CACHE)
            await cache.put(new URL('./index.html', self.location.href).toString(), copy)
          }
          return withIsolationHeaders(response)
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE)
          const cached = await cache.match(new URL('./index.html', self.location.href).toString())
          return cached
            ? withIsolationHeaders(cached)
            : new Response('Prism ist offline und wurde noch nicht zwischengespeichert.', {
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
              })
        }),
    )
    return
  }

  /* --- Everything else: serve from cache, refresh in the background. ------- */
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(request)

      const network = fetch(request)
        .then(async (response) => {
          if (response.ok) await cache.put(request, response.clone())
          return response
        })
        .catch(() => null)

      if (cached) {
        // Refresh happens without blocking the response we already have.
        event.waitUntil(network)
        return withIsolationHeaders(cached)
      }

      const response = await network
      if (!response) {
        return new Response('', { status: 504, statusText: 'Offline' })
      }
      return withIsolationHeaders(response)
    }),
  )
})
