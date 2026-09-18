/**
 * Serves the whole repository the way GitHub Pages does, with the apps that
 * have a build step served from their `dist/` — the only way to check locally
 * that the deployed layout, the relative paths and the service workers actually
 * work together.
 *
 *   node tools/serve-site.mjs            # wie GitHub Pages: KEINE Header
 *   node tools/serve-site.mjs --headers  # wie Cloudflare/Netlify: mit COOP/COEP
 *
 * Ohne --headers muss Prisms Service Worker die Cross-Origin-Isolation selbst
 * herstellen. Zum Prüfen im Browser die Konsole öffnen und `crossOriginIsolated`
 * eingeben: beim ersten Aufruf false, nach dem automatischen Reload true.
 *
 * Vorher die gebauten Apps einmal bauen:
 *   npm run prism:build && npm run folio:build
 */
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(here, '..')

/** Apps that are built rather than published as they are, newest last. */
const BUILT = ['prism', 'folio']

const withHeaders = process.argv.includes('--headers')
const PORT = Number(process.env.PORT ?? 8099)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin',
}

function resolvePath(urlPath) {
  // posix.normalize, because path.normalize would rewrite / as \ on Windows and
  // the '/prism' prefix test below would never match.
  const clean = posix.normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.\/)+/, '')

  for (const app of BUILT) {
    const prefix = `/${app}`
    if (clean === prefix || clean.startsWith(`${prefix}/`)) {
      const rest = clean.slice(prefix.length) || '/'
      return join(REPO, app, 'dist', rest === '/' ? 'index.html' : rest)
    }
  }
  return join(REPO, clean === '/' ? 'index.html' : clean)
}

createServer(async (req, res) => {
  let file = resolvePath(req.url)
  try {
    let info = await stat(file)
    if (info.isDirectory()) {
      file = join(file, 'index.html')
      info = await stat(file)
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
      ...(withHeaders ? ISOLATION : {}),
    })
    createReadStream(file).pipe(res)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('404')
  }
}).listen(PORT, () => {
  console.log(`Seite auf http://localhost:${PORT}/`)
  for (const app of BUILT) console.log(`  ${app} auf http://localhost:${PORT}/${app}/`)
  console.log(
    withHeaders
      ? 'COOP/COEP werden gesendet — wie bei Cloudflare Pages oder Netlify.'
      : 'Keine COOP/COEP-Header — wie bei GitHub Pages. Die Isolation muss der Service Worker herstellen.',
  )
})
