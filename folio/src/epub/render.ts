/**
 * Putting a chapter on screen.
 *
 * The chapter's markup is parsed, stripped down to the elements that carry
 * meaning, and inserted into the reader's own DOM. Two decisions are worth
 * spelling out.
 *
 * **No iframe.** Sandboxing a chapter would be the obvious safe choice, but it
 * puts the text in a different document, and a text selection cannot cross that
 * boundary — which is precisely what highlighting needs. So the markup is
 * sanitised instead: no scripts, no event handlers, no remote references, no
 * embedded objects. What is left is text, structure and the book's own images.
 *
 * **No publisher stylesheet.** Folio applies its own typography rather than the
 * book's CSS. That loses drop caps and the occasional poem layout; in return
 * every book gets the reader's chosen size, measure and theme, nothing can
 * leak out of a chapter into the interface, and there is no stylesheet to
 * sanitise. For a reader whose job is reading, that is the better trade.
 */

import { dirName, resolvePath, splitFragment, type EpubBook } from './parse'

/** Elements kept as they are. Everything else is unwrapped or dropped. */
const KEEP = new Set([
  'p', 'div', 'span', 'section', 'article', 'header', 'footer', 'main', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'em', 'i', 'strong', 'b', 'u', 's', 'small', 'sub', 'sup', 'mark', 'cite', 'q',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'code', 'kbd', 'samp', 'var',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'figure', 'figcaption', 'img', 'image', 'svg', 'br', 'hr', 'a', 'ruby', 'rt', 'rp',
  'abbr', 'time', 'address', 'bdi', 'bdo', 'wbr',
])

/** Dropped together with their contents. */
const DROP = new Set(['script', 'style', 'link', 'object', 'embed', 'iframe', 'video', 'audio', 'form', 'input', 'button', 'noscript', 'template'])

/** Attributes that are safe to carry over. */
const SAFE_ATTRIBUTES = new Set(['colspan', 'rowspan', 'alt', 'title', 'lang', 'dir', 'datetime', 'start', 'reversed', 'value'])

export interface RenderedChapter {
  /** The chapter element, ready to be put into the reader. */
  element: HTMLElement
  /** Object URLs created for the chapter's images; revoke when leaving. */
  objectUrls: string[]
  /** Anchors inside the chapter, so a table of contents fragment can be found. */
  ids: Set<string>
}

export function renderChapter(book: EpubBook, path: string, html: string): RenderedChapter {
  const source = new DOMParser().parseFromString(html, 'text/html')
  const article = document.createElement('article')
  article.className = 'epub-chapter'
  article.setAttribute('data-path', path)

  const objectUrls: string[] = []
  const ids = new Set<string>()
  const base = dirName(path)

  const body = source.body ?? source.documentElement
  for (const child of Array.from(body.childNodes)) {
    const clean = sanitise(child, book, base, objectUrls, ids)
    if (clean) article.appendChild(clean)
  }

  return { element: article, objectUrls, ids }
}

function sanitise(
  node: Node,
  book: EpubBook,
  base: string,
  objectUrls: string[],
  ids: Set<string>,
): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode((node as Text).data)
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null

  const element = node as Element
  const tag = element.localName.toLowerCase()
  if (DROP.has(tag)) return null

  // SVG is only used as an image wrapper in practice; the inner <image> is
  // handled below and the rest is not worth carrying over.
  if (tag === 'svg') {
    const image = element.querySelector('image')
    const href = image?.getAttribute('href') ?? image?.getAttribute('xlink:href')
    if (!href) return null
    return buildImage(book, base, href, image?.getAttribute('alt') ?? '', objectUrls)
  }

  if (tag === 'img' || tag === 'image') {
    const href = element.getAttribute('src') ?? element.getAttribute('href') ?? element.getAttribute('xlink:href')
    if (!href) return null
    return buildImage(book, base, href, element.getAttribute('alt') ?? '', objectUrls)
  }

  const output = document.createElement(KEEP.has(tag) ? tag : 'span')

  const id = element.getAttribute('id')
  if (id) {
    output.id = id
    ids.add(id)
  }

  for (const attribute of SAFE_ATTRIBUTES) {
    const value = element.getAttribute(attribute)
    if (value !== null) output.setAttribute(attribute, value)
  }

  if (tag === 'a') {
    const href = element.getAttribute('href') ?? ''
    if (/^https?:/i.test(href)) {
      // External links open in a new tab; the book cannot navigate the app away.
      output.setAttribute('href', href)
      output.setAttribute('target', '_blank')
      output.setAttribute('rel', 'noreferrer noopener')
    } else if (href) {
      // Internal links become instructions for the reader rather than real hrefs.
      const [target, fragment] = splitFragment(href)
      output.setAttribute('data-link', resolvePath(base, target || ''))
      if (fragment) output.setAttribute('data-fragment', fragment)
      output.setAttribute('role', 'link')
      output.setAttribute('tabindex', '0')
    }
  }

  for (const child of Array.from(element.childNodes)) {
    const clean = sanitise(child, book, base, objectUrls, ids)
    if (clean) output.appendChild(clean)
  }

  return output
}

function buildImage(
  book: EpubBook,
  base: string,
  href: string,
  alt: string,
  objectUrls: string[],
): HTMLElement | null {
  const path = resolvePath(base, href)
  const data = book.files.get(path)
  if (!data) return null

  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mimeOf(path) }))
  objectUrls.push(url)

  const image = document.createElement('img')
  image.src = url
  image.alt = alt
  image.loading = 'lazy'
  return image
}

export function mimeOf(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    case 'avif':
      return 'image/avif'
    default:
      return 'application/octet-stream'
  }
}

/** The cover as an object URL, for the library card. */
export function coverUrl(book: EpubBook): string | null {
  if (!book.coverPath) return null
  const data = book.files.get(book.coverPath)
  if (!data) return null
  return URL.createObjectURL(new Blob([data as BlobPart], { type: mimeOf(book.coverPath) }))
}

/**
 * How long a chapter is, in characters, so the reader can show a progress that
 * means something across a book whose chapters differ wildly in length.
 */
export function chapterLengths(book: EpubBook): number[] {
  return book.spine.map((path) => book.files.get(path)?.length ?? 0)
}

export function progressOf(lengths: readonly number[], index: number, within: number): number {
  const total = lengths.reduce((sum, value) => sum + value, 0)
  if (!total) return 0
  const before = lengths.slice(0, index).reduce((sum, value) => sum + value, 0)
  return Math.min(1, (before + (lengths[index] ?? 0) * within) / total)
}
