/// <reference lib="webworker" />

/**
 * Folio's service worker.
 *
 * The shell — HTML, JavaScript, CSS, icons — is precached on install, so the
 * app starts without a network. The pdf.js data files are not: standard fonts,
 * CMaps and the WASM decoders are several megabytes that most documents never
 * touch, so they are cached the first time a document actually needs them and
 * then kept, because they never change within a version.
 *
 * Documents themselves are never cached here. They are read from the file
 * system or out of IndexedDB, and a copy in the HTTP cache would be a second
 * place for someone's private files to live.
 *
 * Scope is `./` — this app's folder — so the other PWAs in this repository keep
 * their own workers.
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

const VERSION = 'folio-v1.0.0'
const SHELL_CACHE = `${VERSION}-shell`
/** Kept across versions: pinned to the pdf.js release, not to the app build. */
const DATA_CACHE = 'folio-pdfjs-data'

const PRECACHE_URLS = self.__WB_MANIFEST.map((entry) =>
  new URL(entry.url, self.location.href).toString(),
)

/**
 * Precaches file by file rather than with `cache.addAll`.
 *
 * addAll is all or nothing: one 404 rejects it, the install fails and no worker
 * ever activates. Offline coverage degrading quietly is a far better outcome
 * than an app that never gets a worker at all.
 */
async function precache(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE)
  const results = await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
  const failed = results.filter((result) => result.status === 'rejected').length

  if (failed > 0) {
    console.warn(
      `[Folio SW] ${failed} von ${PRECACHE_URLS.length} Dateien nicht vorgeladen — ` +
        'die App läuft weiter, ist offline aber möglicherweise unvollständig.',
    )
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting()
})

const isDataAsset = (url: URL) => url.pathname.includes('/pdfjs/')

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Another app in this repository, reached while this worker happens to be in
  // control of a shared path prefix.
  if (!url.pathname.startsWith(new URL('./', self.location.href).pathname)) return

  /* — pdf.js data: immutable and large, so cache first and keep. ————— */
  if (isDataAsset(url)) {
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return cached

        const response = await fetch(request)
        if (response.ok) await cache.put(request, response.clone())
        return response
      }),
    )
    return
  }

  /* — Navigation: network first so an update lands, cache as the net. —— */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(SHELL_CACHE)
            await cache.put(new URL('./index.html', self.location.href).toString(), response.clone())
          }
          return response
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE)
          const cached = await cache.match(new URL('./index.html', self.location.href).toString())
          return (
            cached ??
            new Response('Folio ist offline und wurde noch nicht zwischengespeichert.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          )
        }),
    )
    return
  }

  /* — Everything else: from cache, refreshed in the background. ————— */
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
        event.waitUntil(network)
        return cached
      }

      return (await network) ?? new Response('', { status: 504, statusText: 'Offline' })
    }),
  )
})
