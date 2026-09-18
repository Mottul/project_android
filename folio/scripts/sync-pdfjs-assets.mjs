/**
 * Copies the runtime data files of pdf.js into `public/pdfjs/`.
 *
 * pdf.js does not bundle these: standard fonts for documents that reference a
 * base-14 font without embedding it, CMaps for CJK encodings, and the WASM
 * decoders for JBIG2 and JPEG 2000 images. Without them a scanned CJK document
 * renders blank boxes and a JPX-compressed scan fails outright — and since
 * Folio has to work offline, loading them from a CDN is not an option either.
 *
 * They are copied rather than committed: they belong to pdfjs-dist and are
 * reproduced by `npm run assets` on every build.
 */

import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const source = join(root, 'node_modules', 'pdfjs-dist')
const target = join(root, 'public', 'pdfjs')

const FOLDERS = ['standard_fonts', 'cmaps', 'wasm', 'iccs']

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

if (!(await exists(source))) {
  console.error('[folio] pdfjs-dist fehlt — bitte zuerst `npm install` ausführen.')
  process.exit(1)
}

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })

for (const folder of FOLDERS) {
  const from = join(source, folder)
  if (!(await exists(from))) {
    console.warn(`[folio] ${folder} liegt nicht in pdfjs-dist — übersprungen.`)
    continue
  }
  await cp(from, join(target, folder), { recursive: true })
}

console.log(`[folio] pdf.js-Daten nach public/pdfjs/ kopiert (${FOLDERS.join(', ')}).`)
