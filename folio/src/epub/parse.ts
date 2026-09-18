/**
 * Reading an EPUB.
 *
 * An EPUB is a ZIP with three levels of indirection: `META-INF/container.xml`
 * points at a package document, the package document lists every file in a
 * manifest and the reading order in a spine, and the table of contents is
 * either an EPUB 3 navigation document or an EPUB 2 NCX file. Books in the wild
 * are frequently a mix — an EPUB 3 package that still ships an NCX, relative
 * paths that need resolving against the package rather than the archive root —
 * so all of it is handled leniently and none of it is trusted to be present.
 */

import { unzipSync, strFromU8 } from 'fflate'

export interface ManifestItem {
  id: string
  /** Path inside the archive, already resolved against the package document. */
  path: string
  mediaType: string
  properties: string[]
}

export interface TocEntry {
  label: string
  /** Archive path of the target, without the fragment. */
  path: string
  fragment?: string
  children: TocEntry[]
}

export interface EpubBook {
  title: string
  author?: string
  language?: string
  identifier?: string
  publisher?: string
  /** Reading order: archive paths of the spine documents. */
  spine: string[]
  toc: TocEntry[]
  manifest: Map<string, ManifestItem>
  /** Archive path of the cover image, when the book names one. */
  coverPath?: string
  /** Every file of the archive, by path. */
  files: Map<string, Uint8Array>
  /** Path of the package document, for resolving relative links. */
  packagePath: string
}

export class EpubError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EpubError'
  }
}

export async function readEpub(data: ArrayBuffer): Promise<EpubBook> {
  const files = unzip(new Uint8Array(data))

  const packagePath = findPackagePath(files)
  const packageXml = textOf(files, packagePath)
  if (!packageXml) throw new EpubError('Die Datei enthält kein lesbares EPUB-Paket.')

  const doc = parseXml(packageXml, 'EPUB-Paket')
  const base = dirName(packagePath)

  const manifest = readManifest(doc, base)
  const spine = readSpine(doc, manifest)
  if (!spine.length) throw new EpubError('Das Buch enthält keine lesbaren Kapitel.')

  return {
    ...readMetadata(doc),
    spine,
    toc: readToc(doc, files, manifest, base),
    manifest,
    coverPath: findCover(doc, manifest),
    files,
    packagePath,
  }
}

function unzip(data: Uint8Array): Map<string, Uint8Array> {
  try {
    const entries = unzipSync(data)
    return new Map(Object.entries(entries))
  } catch (error) {
    throw new EpubError(
      `Das Archiv konnte nicht entpackt werden: ${(error as Error).message ?? 'unbekannter Fehler'}`,
    )
  }
}

function findPackagePath(files: Map<string, Uint8Array>): string {
  const container = textOf(files, 'META-INF/container.xml')
  if (container) {
    const doc = parseXml(container, 'container.xml')
    const rootfile = doc.querySelector('rootfile')
    const path = rootfile?.getAttribute('full-path')
    if (path && files.has(path)) return path
  }

  // Some books ship a broken or missing container. The package document is
  // still findable — there is normally exactly one .opf in the archive.
  for (const path of files.keys()) {
    if (path.toLowerCase().endsWith('.opf')) return path
  }
  throw new EpubError('Die Datei sieht nicht wie ein EPUB aus.')
}

function readMetadata(doc: Document): {
  title: string
  author?: string
  language?: string
  identifier?: string
  publisher?: string
} {
  const value = (name: string): string | undefined => {
    // Namespace-agnostic: `dc:title` and a default-namespaced `title` both occur.
    const node =
      doc.querySelector(`metadata > ${name}`) ??
      doc.querySelector(`metadata > dc\\:${name}`) ??
      [...doc.querySelectorAll('metadata > *')].find(
        (element) => element.localName.toLowerCase() === name,
      )
    const text = node?.textContent?.trim()
    return text || undefined
  }

  return {
    title: value('title') ?? 'Ohne Titel',
    author: value('creator'),
    language: value('language'),
    identifier: value('identifier'),
    publisher: value('publisher'),
  }
}

function readManifest(doc: Document, base: string): Map<string, ManifestItem> {
  const manifest = new Map<string, ManifestItem>()

  for (const item of doc.querySelectorAll('manifest > item')) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (!id || !href) continue

    manifest.set(id, {
      id,
      path: resolvePath(base, href),
      mediaType: item.getAttribute('media-type') ?? '',
      properties: (item.getAttribute('properties') ?? '').split(/\s+/).filter(Boolean),
    })
  }

  return manifest
}

function readSpine(doc: Document, manifest: Map<string, ManifestItem>): string[] {
  const spine: string[] = []

  for (const ref of doc.querySelectorAll('spine > itemref')) {
    const id = ref.getAttribute('idref')
    if (!id) continue
    const item = manifest.get(id)
    // `linear="no"` marks supplementary material that is reachable from the
    // text but not part of the reading order.
    if (item && ref.getAttribute('linear') !== 'no') spine.push(item.path)
  }

  return spine
}

function readToc(
  doc: Document,
  files: Map<string, Uint8Array>,
  manifest: Map<string, ManifestItem>,
  base: string,
): TocEntry[] {
  // EPUB 3: a navigation document flagged in the manifest.
  for (const item of manifest.values()) {
    if (!item.properties.includes('nav')) continue
    const xml = textOf(files, item.path)
    if (!xml) continue
    const entries = readNavDocument(xml, dirName(item.path))
    if (entries.length) return entries
  }

  // EPUB 2: an NCX referenced by the spine.
  const tocId = doc.querySelector('spine')?.getAttribute('toc')
  const ncxItem = tocId ? manifest.get(tocId) : undefined
  const ncxPath =
    ncxItem?.path ??
    [...manifest.values()].find((item) => item.mediaType.includes('ncx'))?.path

  if (ncxPath) {
    const xml = textOf(files, ncxPath)
    if (xml) return readNcx(xml, dirName(ncxPath))
  }

  void base
  return []
}

function readNavDocument(xml: string, base: string): TocEntry[] {
  const doc = parseXml(xml, 'Navigationsdokument')

  const nav =
    [...doc.querySelectorAll('nav')].find(
      (element) => element.getAttribute('epub:type') === 'toc' || element.getAttribute('type') === 'toc',
    ) ?? doc.querySelector('nav')
  const list = nav?.querySelector('ol')
  return list ? readNavList(list, base) : []
}

function readNavList(list: Element, base: string): TocEntry[] {
  const entries: TocEntry[] = []

  for (const item of list.children) {
    if (item.tagName.toLowerCase() !== 'li') continue

    const anchor = item.querySelector(':scope > a, :scope > span')
    const href = anchor?.getAttribute('href') ?? ''
    const [path, fragment] = splitFragment(href)

    const entry: TocEntry = {
      label: anchor?.textContent?.trim() || '(ohne Titel)',
      path: path ? resolvePath(base, path) : '',
      fragment,
      children: [],
    }

    const nested = item.querySelector(':scope > ol')
    if (nested) entry.children = readNavList(nested, base)
    entries.push(entry)
  }

  return entries
}

function readNcx(xml: string, base: string): TocEntry[] {
  const doc = parseXml(xml, 'NCX')

  const convert = (parent: Element): TocEntry[] => {
    const entries: TocEntry[] = []
    for (const point of parent.children) {
      if (point.localName.toLowerCase() !== 'navpoint') continue

      const href = point.querySelector(':scope > content')?.getAttribute('src') ?? ''
      const [path, fragment] = splitFragment(href)
      entries.push({
        label: point.querySelector(':scope > navLabel > text')?.textContent?.trim() || '(ohne Titel)',
        path: path ? resolvePath(base, path) : '',
        fragment,
        children: convert(point),
      })
    }
    return entries
  }

  const map = doc.querySelector('navMap')
  return map ? convert(map) : []
}

function findCover(doc: Document, manifest: Map<string, ManifestItem>): string | undefined {
  for (const item of manifest.values()) {
    if (item.properties.includes('cover-image')) return item.path
  }

  const meta = [...doc.querySelectorAll('metadata > meta')].find(
    (element) => element.getAttribute('name') === 'cover',
  )
  const id = meta?.getAttribute('content')
  if (id && manifest.has(id)) return manifest.get(id)?.path

  // Last resort: an image whose name says what it is.
  for (const item of manifest.values()) {
    if (item.mediaType.startsWith('image/') && /cover/i.test(item.path)) return item.path
  }
  return undefined
}

/* ===========================================================================
   Paths and parsing
   ======================================================================== */

export function dirName(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut + 1)
}

export function splitFragment(href: string): [string, string | undefined] {
  const hash = href.indexOf('#')
  return hash === -1 ? [href, undefined] : [href.slice(0, hash), href.slice(hash + 1)]
}

/**
 * Resolves a relative href against a directory inside the archive.
 *
 * `new URL()` would be the obvious tool, but archive paths are not URLs: they
 * have no scheme, and a book that uses `%20` for a space in an href while the
 * archive entry contains a literal space would silently stop resolving. So the
 * segments are walked directly, and percent-escapes are undone.
 */
export function resolvePath(base: string, href: string): string {
  const decoded = safeDecode(href.split('#')[0])
  if (!decoded) return base.replace(/\/$/, '')
  if (decoded.startsWith('/')) return decoded.slice(1)

  const segments = base.split('/').filter(Boolean)
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.join('/')
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function textOf(files: Map<string, Uint8Array>, path: string): string | null {
  const data = files.get(path) ?? files.get(safeDecode(path))
  if (!data) return null
  return strFromU8(data)
}

function parseXml(xml: string, what: string): Document {
  const parser = new DOMParser()

  // XHTML content is parsed as XML first so that namespaced attributes survive,
  // and re-parsed as HTML when the book's markup is not well formed — which is
  // common enough that failing on it would lock people out of their own books.
  const strict = parser.parseFromString(xml, 'application/xhtml+xml')
  if (!strict.querySelector('parsererror')) return strict

  const lenient = parser.parseFromString(xml, 'text/html')
  if (lenient.body || lenient.documentElement) return lenient

  throw new EpubError(`${what} ist fehlerhaft und konnte nicht gelesen werden.`)
}

export { parseXml }
