/**
 * The EPUB viewer.
 *
 * One chapter at a time, re-flowed into the reader's own typography. Chapters
 * rather than continuous scrolling because a spine item is the unit the book
 * itself is built from: it is what the table of contents points at, what a
 * highlight is anchored to, and what can be rendered without holding the whole
 * book in the DOM.
 *
 * Marks are re-found by searching for their text every time a chapter is drawn
 * — see epub/anchor.ts. That is why changing the font size does not move a
 * single highlight.
 */

import { clear, debounce, h, on, onFrame } from '@/lib/dom'
import { newMark, type Mark } from '@/store/marks'
import { settings, setSetting } from '@/store/settings'
import {
  CONTEXT_LENGTH,
  findQuote,
  offsetsOfRange,
  rangeFromOffsets,
  textOf as textOfNode,
} from '@/epub/anchor'
import { readEpub, splitFragment, textOf, type EpubBook, type TocEntry } from '@/epub/parse'
import { chapterLengths, progressOf, renderChapter } from '@/epub/render'
import type { OutlineEntry } from '@/pdf/loader'
import { icon } from './icons'
import { openMarkEditor } from './mark-editor'
import { toast } from './feedback'

import { openExport } from './lazy'
import type { SearchHit, Viewer, ViewerHost } from './viewer'

export class EpubViewer implements Viewer {
  readonly element: HTMLElement

  private book: EpubBook | null = null
  private source: ArrayBuffer | null = null
  private flow: HTMLElement
  private chapter = 0
  private objectUrls: string[] = []
  private disposers: (() => void)[] = []
  private selectionMenu: HTMLElement | null = null

  constructor(private readonly host: ViewerHost) {
    this.flow = h('div.flow')
    this.element = h('div.viewport', {}, this.flow)
  }

  get count(): number {
    return this.book?.spine.length ?? 0
  }

  async load(): Promise<void> {
    this.element.appendChild(h('div.busy', {}, h('div.spinner'), h('p', {}, 'Buch wird gelesen …')))

    this.source = await this.host.file.arrayBuffer()
    this.book = await readEpub(this.source)

    clear(this.element)
    this.element.appendChild(this.flow)

    this.host.setMeta({
      title: this.book.title,
      author: this.book.author,
      pages: this.book.spine.length,
    })
    this.host.setOutline(toOutline(this.book.toc, this.book.spine))

    this.applyTypography()
    this.watchSelection()
    this.watchScroll()
    await this.showChapter(0)
  }

  destroy(): void {
    for (const dispose of this.disposers) dispose()
    this.disposers = []
    this.releaseObjectUrls()
    this.hideSelectionMenu()
    this.book = null
    this.source = null
  }

  private releaseObjectUrls(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url)
    this.objectUrls = []
  }

  /* ========================================================================
     Chapters
     ===================================================================== */

  goTo(index: number): void {
    void this.showChapter(index)
  }

  restore(location: string): void {
    const [chapter, fraction] = location.split(':')
    const index = Number.parseInt(chapter, 10)
    if (!Number.isFinite(index)) return

    void this.showChapter(index).then(() => {
      const within = Number.parseFloat(fraction)
      if (Number.isFinite(within) && within > 0) {
        this.element.scrollTop = within * (this.element.scrollHeight - this.element.clientHeight)
      }
    })
  }

  private async showChapter(index: number, fragment?: string): Promise<void> {
    const book = this.book
    if (!book) return

    const clamped = Math.max(0, Math.min(book.spine.length - 1, index))
    const path = book.spine[clamped]
    const html = textOf(book.files, path)

    this.releaseObjectUrls()
    clear(this.flow)

    if (!html) {
      this.flow.appendChild(h('p', {}, 'Dieses Kapitel konnte nicht gelesen werden.'))
      return
    }

    const rendered = renderChapter(book, path, html)
    this.objectUrls = rendered.objectUrls
    this.flow.appendChild(rendered.element)
    this.flow.appendChild(this.buildChapterNav(clamped))

    this.chapter = clamped
    this.host.setPosition(clamped + 1, book.spine.length, chapterLabel(book, path))

    this.applyMarks(rendered.element, path)
    this.interceptLinks(rendered.element)

    if (fragment) {
      const target = rendered.element.querySelector(`#${CSS.escape(fragment)}`)
      target?.scrollIntoView({ block: 'start' })
    } else {
      this.element.scrollTop = 0
    }
    this.saveProgress()
  }

  private buildChapterNav(index: number): HTMLElement {
    const total = this.book?.spine.length ?? 0
    return h(
      'div.chapter-nav',
      {},
      h(
        'button.button',
        { type: 'button', disabled: index === 0, onclick: () => void this.showChapter(index - 1) },
        h('span', { html: icon('back', 16) }),
        'Zurück',
      ),
      h('span', { style: 'color:var(--text-faint);font-size:0.82rem' }, `${index + 1} / ${total}`),
      h(
        'button.button',
        {
          type: 'button',
          disabled: index >= total - 1,
          onclick: () => void this.showChapter(index + 1),
        },
        'Weiter',
        h('span', { html: icon('forward', 16) }),
      ),
    )
  }

  /** Internal links navigate inside the book instead of leaving the app. */
  private interceptLinks(root: HTMLElement): void {
    for (const link of root.querySelectorAll<HTMLElement>('[data-link]')) {
      link.addEventListener('click', (event) => {
        event.preventDefault()
        const target = link.dataset.link ?? ''
        const fragment = link.dataset.fragment
        const index = this.book?.spine.indexOf(target) ?? -1
        if (index >= 0) void this.showChapter(index, fragment)
        else toast('Dieses Ziel liegt außerhalb des Buches.', { kind: 'warn' })
      })
    }
  }

  /* ========================================================================
     Typography
     ===================================================================== */

  private applyTypography(): void {
    const { fontSize, lineHeight, fontFamily } = settings()
    this.flow.className = `flow font-${fontFamily}`
    this.flow.style.fontSize = `${fontSize}px`
    this.flow.style.lineHeight = String(lineHeight)
  }

  zoomIn(): void {
    setSetting('fontSize', Math.min(34, settings().fontSize + 1))
    this.applyTypography()
  }

  zoomOut(): void {
    setSetting('fontSize', Math.max(12, settings().fontSize - 1))
    this.applyTypography()
  }

  applySettings(): void {
    this.applyTypography()
  }

  chapterIndexOf(href: string): number {
    return this.book?.spine.indexOf(href) ?? -1
  }

  toolsChanged(): void {
    // Reflowable text has no page to draw on; only the text tools apply, and
    // those work off the selection, which is always available.
  }

  marksChanged(): void {
    const chapter = this.flow.querySelector<HTMLElement>('.epub-chapter')
    const path = this.book?.spine[this.chapter]
    if (chapter && path) this.applyMarks(chapter, path)
  }

  /* ========================================================================
     Marks
     ===================================================================== */

  /**
   * Draws the chapter's marks by finding their text again and wrapping it.
   *
   * Existing wrappers are removed first and the text nodes normalised, so a
   * second pass starts from the same string offsets the first one did.
   */
  private applyMarks(root: HTMLElement, path: string): void {
    for (const existing of root.querySelectorAll('mark.folio-mark')) {
      const parent = existing.parentNode
      if (!parent) continue
      while (existing.firstChild) parent.insertBefore(existing.firstChild, existing)
      existing.remove()
    }
    root.normalize()

    const text = textOfNode(root)
    const marks = this.host.session
      .inChapter(path)
      .map((mark) => ({
        mark,
        range: findQuote(text, { quote: mark.quote ?? '', prefix: mark.prefix, suffix: mark.suffix }),
      }))
      .filter((entry) => entry.range)
      // Back to front: wrapping changes the nodes after the insertion point.
      .sort((a, b) => (b.range?.start ?? 0) - (a.range?.start ?? 0))

    for (const { mark, range } of marks) {
      if (!range) continue
      const domRange = rangeFromOffsets(root, range.start, range.end)
      if (domRange) this.wrap(domRange, mark)
    }
  }

  private wrap(range: Range, mark: Mark): void {
    const nodes: Text[] = []
    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode() as Text | null
    while (node) {
      if (range.intersectsNode(node)) nodes.push(node)
      node = walker.nextNode() as Text | null
    }
    if (!nodes.length && range.startContainer.nodeType === Node.TEXT_NODE) {
      nodes.push(range.startContainer as Text)
    }

    for (const target of nodes) {
      const from = target === range.startContainer ? range.startOffset : 0
      const to = target === range.endContainer ? range.endOffset : target.data.length
      if (to <= from) continue

      if (to < target.data.length) target.splitText(to)
      const piece = from > 0 ? target.splitText(from) : target

      const wrapper = document.createElement('mark')
      wrapper.className = 'folio-mark'
      wrapper.dataset.mark = mark.id
      wrapper.title = mark.comment ?? ''
      if (mark.type === 'underline') {
        wrapper.style.background = 'transparent'
        wrapper.style.textDecoration = 'underline'
        wrapper.style.textDecorationColor = mark.color
      } else if (mark.type === 'strike') {
        wrapper.style.background = 'transparent'
        wrapper.style.textDecoration = 'line-through'
        wrapper.style.textDecorationColor = mark.color
      } else {
        wrapper.style.background = mark.color
        wrapper.style.color = 'inherit'
      }
      wrapper.addEventListener('click', (event) => {
        event.stopPropagation()
        void openMarkEditor(mark, this.host.session)
      })

      piece.parentNode?.insertBefore(wrapper, piece)
      wrapper.appendChild(piece)
    }
  }

  /* ========================================================================
     Selection
     ===================================================================== */

  private watchSelection(): void {
    const update = onFrame(() => this.updateSelectionMenu())
    this.disposers.push(
      on(document, 'selectionchange', update),
      on(this.element, 'scroll', () => this.hideSelectionMenu(), { passive: true }),
      on(this.element, 'pointerdown', (event) => {
        if (!(event.target as HTMLElement).closest('.selection-menu')) this.hideSelectionMenu()
      }),
    )
  }

  private updateSelectionMenu(): void {
    const selection = document.getSelection()
    const chapter = this.flow.querySelector('.epub-chapter')
    if (!selection || selection.isCollapsed || !chapter) {
      this.hideSelectionMenu()
      return
    }

    const range = selection.getRangeAt(0)
    if (!chapter.contains(range.commonAncestorContainer)) {
      this.hideSelectionMenu()
      return
    }

    const box = range.getBoundingClientRect()
    const menu = this.buildSelectionMenu()
    const host = this.element.getBoundingClientRect()

    const above = box.top - host.top + this.element.scrollTop - 46
    menu.style.top = `${above > this.element.scrollTop + 4 ? above : box.bottom - host.top + this.element.scrollTop + 8}px`
    menu.style.left = `${Math.max(8, box.left - host.left + this.element.scrollLeft)}px`
  }

  private buildSelectionMenu(): HTMLElement {
    if (this.selectionMenu) return this.selectionMenu

    const menu = h('div.selection-menu')
    // Pressing a button clears the text selection before the click handler can
    // read it — that is the browser's default for any mousedown outside the
    // selection. Suppressing it is what keeps "markieren" working at all.
    menu.addEventListener('mousedown', (event) => event.preventDefault())

    const add = (label: string, iconName: string, type: Mark['type'], withComment = false) =>
      menu.appendChild(
        h('button.icon-button', {
          type: 'button',
          title: label,
          'aria-label': label,
          html: icon(iconName, 18),
          onclick: () => void this.markSelection(type, withComment),
        }),
      )

    add('Markieren', 'highlight', 'highlight')
    add('Unterstreichen', 'underline', 'underline')
    add('Durchstreichen', 'strike', 'strike')
    menu.appendChild(h('span.divider'))
    add('Markieren und kommentieren', 'note', 'highlight', true)

    this.selectionMenu = menu
    this.element.appendChild(menu)
    return menu
  }

  private hideSelectionMenu(): void {
    this.selectionMenu?.remove()
    this.selectionMenu = null
  }

  private async markSelection(type: Mark['type'], withComment: boolean): Promise<void> {
    const selection = document.getSelection()
    const chapter = this.flow.querySelector<HTMLElement>('.epub-chapter')
    const path = this.book?.spine[this.chapter]
    if (!selection || selection.isCollapsed || !chapter || !path) return

    const range = selection.getRangeAt(0)
    const offsets = offsetsOfRange(chapter, range)
    selection.removeAllRanges()
    this.hideSelectionMenu()
    if (!offsets) return

    const text = textOfNode(chapter)
    const mark = newMark(this.host.session.docId, type, {
      href: path,
      color: this.host.tools.highlightColor,
      quote: text.slice(offsets.start, offsets.end),
      prefix: text.slice(Math.max(0, offsets.start - CONTEXT_LENGTH), offsets.start),
      suffix: text.slice(offsets.end, offsets.end + CONTEXT_LENGTH),
    })

    await this.host.session.add(mark)
    if (withComment) await openMarkEditor(mark, this.host.session)
  }

  /* ========================================================================
     Progress
     ===================================================================== */

  private watchScroll(): void {
    const save = debounce(() => this.saveProgress(), 400)
    this.disposers.push(on(this.element, 'scroll', save, { passive: true }))
  }

  private saveProgress(): void {
    if (!this.book) return
    const scrollable = this.element.scrollHeight - this.element.clientHeight
    const within = scrollable > 8 ? this.element.scrollTop / scrollable : 0

    this.host.saveProgress(
      progressOf(chapterLengths(this.book), this.chapter, within),
      `${this.chapter}:${within.toFixed(3)}`,
    )
  }

  /* ========================================================================
     Search and export
     ===================================================================== */

  async search(query: string): Promise<SearchHit[]> {
    const book = this.book
    if (!book || query.trim().length < 2) return []

    const needle = query.trim().toLowerCase()
    const hits: SearchHit[] = []

    for (let index = 0; index < book.spine.length; index += 1) {
      const html = textOf(book.files, book.spine[index])
      if (!html) continue

      // The markup is stripped rather than parsed: a search only needs the
      // words, and building a DOM per chapter for every query is wasteful.
      const text = html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;|&#\d+;/gi, ' ')
        .replace(/\s+/g, ' ')

      const haystack = text.toLowerCase()
      let at = haystack.indexOf(needle)
      while (at !== -1 && hits.length < 400) {
        hits.push({
          index,
          offset: at,
          excerpt: text.slice(Math.max(0, at - 40), at + needle.length + 60).trim(),
        })
        at = haystack.indexOf(needle, at + needle.length)
      }
    }

    return hits
  }

  showHit(hit: SearchHit): void {
    void this.showChapter(hit.index)
  }

  async exportDocument(): Promise<void> {
    if (!this.book) return
    await openExport({
      kind: 'epub',
      entry: this.host.entry,
      marks: [...this.host.session.all()],
      epub: { book: this.book },
    })
  }
}

/** Chapter titles from the table of contents, for the position label. */
function chapterLabel(book: EpubBook, path: string): string {
  const find = (entries: TocEntry[]): string | null => {
    for (const entry of entries) {
      if (entry.path === path) return entry.label
      const nested = find(entry.children)
      if (nested) return nested
    }
    return null
  }
  return find(book.toc) ?? path.split('/').pop() ?? ''
}

/** The book's table of contents in the shape the sidebar already knows. */
function toOutline(toc: TocEntry[], spine: readonly string[]): OutlineEntry[] {
  return toc.map((entry) => ({
    title: entry.label,
    page: spine.indexOf(splitFragment(entry.path)[0]),
    children: toOutline(entry.children, spine),
  }))
}
