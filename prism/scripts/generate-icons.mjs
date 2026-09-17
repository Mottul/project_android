/**
 * Rasterise the PWA icons from public/icons/icon.svg.
 *
 * Run with `npm run icons` after changing the mark. The SVG stays the source of
 * truth; the PNGs exist only because iOS and some launchers still refuse SVG.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const iconsDir = resolve(here, '../public/icons')
const source = await readFile(resolve(iconsDir, 'icon.svg'))

await mkdir(iconsDir, { recursive: true })

/** Plain icons: the mark fills the tile. */
for (const size of [192, 512]) {
  await sharp(source, { density: 400 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(resolve(iconsDir, `icon-${size}.png`))
  console.log(`icon-${size}.png`)
}

/**
 * Maskable icon: Android crops to a shape that can cut ~20 % off each edge, so
 * the mark is inset into the safe zone and the background is extended.
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
    background: { r: 0x18, g: 0x19, b: 0x26, alpha: 1 },
  },
})
  .composite([{ input: inner, top: pad, left: pad }])
  .png({ compressionLevel: 9 })
  .toFile(resolve(iconsDir, 'maskable-512.png'))
console.log('maskable-512.png')

// Apple touch icon: same as the 192 tile, but never transparent.
await sharp(source, { density: 400 })
  .resize(180, 180)
  .flatten({ background: { r: 0x18, g: 0x19, b: 0x26 } })
  .png({ compressionLevel: 9 })
  .toFile(resolve(iconsDir, 'apple-touch-icon.png'))
console.log('apple-touch-icon.png')

await writeFile(
  resolve(iconsDir, 'README.md'),
  '# Icons\n\nGenerated from `icon.svg` by `npm run icons`. Do not edit the PNGs by hand.\n',
)
