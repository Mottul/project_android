import { describe, expect, it } from 'vitest'

import { isCoreAsset, shouldHandle, withIsolationHeaders } from '@/sw-headers'

/**
 * These headers are what makes SharedArrayBuffer — and therefore the
 * multi-threaded ffmpeg core — available on a host that cannot send headers
 * itself. If the rewrite drops a status or eats a body, every asset in the app
 * breaks simultaneously, so it is worth pinning down.
 */
describe('withIsolationHeaders', () => {
  it('sets all three isolation headers', async () => {
    const result = withIsolationHeaders(new Response('hallo'))

    expect(result.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp')
    expect(result.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin')
    expect(result.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin')
  })

  it('preserves body, status and existing headers', async () => {
    const original = new Response('nutzdaten', {
      status: 201,
      statusText: 'Created',
      headers: { 'Content-Type': 'text/plain', 'X-Eigen': 'bleibt' },
    })

    const result = withIsolationHeaders(original)

    expect(result.status).toBe(201)
    expect(result.statusText).toBe('Created')
    expect(result.headers.get('Content-Type')).toBe('text/plain')
    expect(result.headers.get('X-Eigen')).toBe('bleibt')
    await expect(result.text()).resolves.toBe('nutzdaten')
  })

  it('overwrites a conflicting COEP header rather than appending', () => {
    const original = new Response('x', {
      headers: { 'Cross-Origin-Embedder-Policy': 'unsafe-none' },
    })

    const result = withIsolationHeaders(original)

    expect(result.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp')
  })

  it('passes an opaque response through untouched', () => {
    // Rewriting one would silently turn it into an empty 200.
    const opaque = Response.error()
    expect(withIsolationHeaders(opaque)).toBe(opaque)
  })

  it('does not attach a body to a 204', () => {
    // Response throws on a body with 204/304, which would break the worker.
    const result = withIsolationHeaders(new Response(null, { status: 204 }))

    expect(result.status).toBe(204)
    expect(result.body).toBeNull()
    expect(result.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin')
  })
})

describe('shouldHandle', () => {
  const ORIGIN = 'https://mottul.github.io'

  it('accepts a same-origin GET', () => {
    const request = new Request(`${ORIGIN}/project_android/prism/index.html`)
    expect(shouldHandle(request, ORIGIN)).toBe(true)
  })

  it('ignores cross-origin requests', () => {
    const request = new Request('https://example.com/asset.js')
    expect(shouldHandle(request, ORIGIN)).toBe(false)
  })

  it('ignores non-GET requests', () => {
    const request = new Request(`${ORIGIN}/upload`, { method: 'POST' })
    expect(shouldHandle(request, ORIGIN)).toBe(false)
  })

  it("ignores 'only-if-cached' requests that are not same-origin mode", () => {
    // Chrome throws outright if the worker answers one of these. The pairing is
    // illegal in the Request constructor too, so the browser-internal case has
    // to be reproduced with a stand-in.
    const request = {
      url: `${ORIGIN}/asset.js`,
      method: 'GET',
      cache: 'only-if-cached',
      mode: 'no-cors',
    } as unknown as Request

    expect(shouldHandle(request, ORIGIN)).toBe(false)
  })
})

describe('isCoreAsset', () => {
  it('recognises the ffmpeg cores under any base path', () => {
    expect(isCoreAsset(new URL('https://x.dev/prism/ffmpeg/mt/ffmpeg-core.wasm'))).toBe(true)
    expect(isCoreAsset(new URL('https://x.dev/project_android/prism/ffmpeg/st/ffmpeg-core.js'))).toBe(
      true,
    )
  })

  it('does not match ordinary assets', () => {
    expect(isCoreAsset(new URL('https://x.dev/prism/assets/index-abc.js'))).toBe(false)
  })
})
