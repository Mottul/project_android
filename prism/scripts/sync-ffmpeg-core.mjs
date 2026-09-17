/**
 * Copy the ffmpeg.wasm cores into public/ffmpeg/.
 *
 * They cannot be imported through the bundler: @ffmpeg/core restricts its
 * `exports` map to the package root, so a deep `?url` import is refused. Serving
 * them as plain static assets is better anyway —
 *
 *   - the 30 MB wasm never enters the module graph or a chunk,
 *   - the service worker caches them on first use instead of precaching them,
 *   - COEP is satisfied because they are same-origin.
 *
 * Runs automatically via the `predev` and `prebuild` npm hooks.
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const target = resolve(root, 'public/ffmpeg')

const VARIANTS = [
  {
    name: 'st',
    from: resolve(root, 'node_modules/@ffmpeg/core/dist/esm'),
    files: ['ffmpeg-core.js', 'ffmpeg-core.wasm'],
  },
  {
    name: 'mt',
    from: resolve(root, 'node_modules/@ffmpeg/core-mt/dist/esm'),
    files: ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js'],
  },
]

await rm(target, { recursive: true, force: true })

for (const variant of VARIANTS) {
  const dest = resolve(target, variant.name)
  await mkdir(dest, { recursive: true })
  for (const file of variant.files) {
    const source = resolve(variant.from, file)
    await cp(source, resolve(dest, file))
    const { size } = await stat(source)
    console.log(`ffmpeg/${variant.name}/${file}  ${(size / 1024 / 1024).toFixed(1)} MB`)
  }
}

console.log('ffmpeg cores synced to public/ffmpeg/')
