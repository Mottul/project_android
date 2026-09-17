/**
 * Cross-origin isolation headers.
 *
 * Extracted from sw.ts so it can be unit tested: `Response` and `Headers` exist
 * in Node, a `ServiceWorkerGlobalScope` does not. This is the load-bearing part
 * of the GitHub Pages workaround — if it copies a response wrongly, every asset
 * in the app breaks at once.
 */

export const ISOLATION_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Cross-Origin-Embedder-Policy', 'require-corp'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  // Needed by subresources once the document itself is isolated.
  ['Cross-Origin-Resource-Policy', 'same-origin'],
]

/**
 * Return an equivalent response carrying the isolation headers.
 *
 * The body is a stream and can only be read once, so anything the caller still
 * intends to cache must be cloned *before* being passed here.
 *
 * Opaque responses (status 0, from a no-cors cross-origin fetch) have no
 * readable headers or body and are passed through untouched — rewriting one
 * would replace it with an empty 200.
 */
export function withIsolationHeaders(response: Response): Response {
  if (response.status === 0) return response

  const headers = new Headers(response.headers)
  for (const [name, value] of ISOLATION_HEADERS) headers.set(name, value)

  // 204 and 304 must not be given a body, and Response rejects one.
  const body = response.status === 204 || response.status === 304 ? null : response.body

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** True when a URL points at one of the ffmpeg core files. */
export function isCoreAsset(url: URL): boolean {
  return url.pathname.includes('/ffmpeg/')
}

/**
 * Whether this worker should handle the request at all.
 *
 * Requests with cache mode 'only-if-cached' and a non-same-origin mode must be
 * left entirely alone: Chrome throws if such a request is answered from
 * anywhere but the HTTP cache.
 */
export function shouldHandle(request: Request, origin: string): boolean {
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return false
  if (request.method !== 'GET') return false
  return new URL(request.url).origin === origin
}
