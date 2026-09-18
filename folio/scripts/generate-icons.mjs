/**
 * Rasterise the PWA icons from public/icons/icon.svg.
 *
 * Run by `npm run assets` before every build. The SVG stays the source of
 * truth; the PNGs exist only because iOS and several Android launchers still
 * refuse an SVG icon.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const iconsDir = resolve(here, '../public/icons')
const source = await readFile(resolve(iconsDir, 'icon.svg'))

/** Matches the background of the mark, for the flattened variants. */
const BACKDROP = { r: 0x18, g: 0x1b, b: 0x21 }

await mkdir(iconsDir, { recursive: true })

for (const size of [192, 512]) {
  await sharp(source, { density: 400 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(resolve(iconsDir, `icon-${size}.png`))
  console.log(`icon-${size}.png`)
}

/**
 * Maskable icon: Android crops to a shape that can take about 20 % off each
 * edge, so the mark is inset into the safe zone and the background extended.
 */
const MASKABLE = 512
const INNER = Math.round(MASKABLE * 0.62)
const pad = Math.round((MASKABLE - INNER) / 2)

const inner = await sharp(source, { density: 400 }).resize(INNER, INNER).png().toBuffer()

await sharp({
  create: {
    width: MASKABLE,
    height: MASKABLE,
    channels: 4,
    background: { ...BACKDROP, alpha: 1 },
  },
})
  .composite([{ input: inner, top: pad, left: pad }])
  .png({ compressionLevel: 9 })
  .toFile(resolve(iconsDir, 'maskable-512.png'))
console.log('maskable-512.png')

// Apple touch icon: never transparent, and no rounded corners of its own.
await sharp(source, { density: 400 })
  .resize(180, 180)
  .flatten({ background: BACKDROP })
  .png({ compressionLevel: 9 })
  .toFile(resolve(iconsDir, 'apple-touch-icon.png'))
console.log('apple-touch-icon.png')

await writeFile(
  resolve(iconsDir, 'README.md'),
  '# Icons\n\nErzeugt aus `icon.svg` durch `npm run icons`. Die PNGs nicht von Hand bearbeiten.\n',
)
