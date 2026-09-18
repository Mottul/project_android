/**
 * The two small viewers: a single image, and a plain text file.
 *
 * Both are here rather than in files of their own because neither has any
 * machinery worth separating. The image viewer reuses the page overlay — an
 * image is a document of exactly one page — so scanned receipts and photographed
 * whiteboards can be annotated with the same tools as a PDF. The text viewer
 * reuses the EPUB anchoring, because a text file is one long chapter.
 */

import { clear, debounce, h, on, onFrame } from '@/lib/dom'
import { newMark, type Mark } from '@/store/marks'
import { settings, setSetting } from '@/store/settings'
import { CONTEXT_LENGTH, findQuote, offsetsOfRange, rangeFromOffsets, textOf as textOfNode } from '@/epub/anchor'
import { sampleColors } from '@/pdf/sample'
import type { Rect } from '@/lib/geometry'
import { PageOverlay } from './overlay'
import { openMarkEditor } from './mark-editor'
import { icon } from './icons'

import { openExport } from './lazy'
import type { SearchHit, Viewer, ViewerHost } from './viewer'

/* ===========================================================================
   Image
   ======================================================================== */

export class ImageViewer implements Viewer {
  readonly element: HTMLElement

  private readonly page: HTMLElement
  private readonly image: HTMLImageElement
  private overlay: PageOverlay | null = null
  private objectUrl: string | null = null
  /** Used to sample the colour under a redaction, like the PDF viewer does. */
  private scratch: HTMLCanvasElement | null = null
  private zoom = 1
  private disposers: (() => void)[] = []

  constructor(private readonly host: ViewerHost) {
    this.image = h('img', { alt: this.host.entry.name }) as HTMLImageElement
    this.page = h('div.page', { 'data-index': '0' }, this.image)
    this.element = h('div.viewport', {}, h('div.image-stage', {}, this.page))
  }

  get count(): number {
    return 1
  }

  async load(): Promise<void> {
    this.objectUrl = URL.createObjectURL(this.host.file)
    this.image.src = this.objectUrl

    await new Promise<void>((resolve) => {
      if (this.image.complete) return resolve()
      this.image.onload = () => resolve()
      this.image.onerror = () => resolve()
    })

    this.layout()
    const observer = new ResizeObserver(debounce(() => this.layout(), 100))
    observer.observe(this.element)
    this.disposers.push(() => observer.disconnect())

    this.overlay = new PageOverlay(this.page, 0, this.host.session, this.host.tools, {
      onEditMark: (mark) => void openMarkEditor(mark, this.host.session),
      onPlaceText: (box) => void this.addTextBox(box),
      sampleFill: (box) => this.sampleFill(box),
    })
    this.overlay.render()

    this.host.setMeta({ pages: 1 })
    this.host.setPosition(1, 1)
    this.host.saveProgress(1, '0')
  }

  private layout(): void {
    const natural = this.image.naturalWidth || 1
    const naturalHeight = this.image.naturalHeight || 1
    const available = Math.max(160, this.element.clientWidth - 24)
    const width = Math.min(available * this.zoom, natural * this.zoom * 2)

    this.page.style.width = `${Math.round(width)}px`
    this.page.style.height = `${Math.round((naturalHeight / natural) * width)}px`
    this.image.style.width = '100%'
    this.image.style.height = '100%'
    this.overlay?.render()
  }

  /**
   * The image is drawn into an off-screen canvas once so colours can be read
   * back from it. Reading pixels straight from an `<img>` is not possible, and
   * re-drawing it for every sample would be wasteful.
   */
  private sampleFill(box: Rect): string {
    if (!this.scratch) {
      const canvas = document.createElement('canvas')
      canvas.width = this.image.naturalWidth || 1
      canvas.height = this.image.naturalHeight || 1
      canvas.getContext('2d')?.drawImage(this.image, 0, 0)
      this.scratch = canvas
    }
    return sampleColors(this.scratch, box).background
  }

  private async addTextBox(box: Rect): Promise<void> {
    const mark = newMark(this.host.session.docId, 'text', {
      page: 0,
      box,
      color: this.host.tools.inkColor,
      fontSize: 0.03,
      text: '',
    })
    await this.host.session.add(mark)
    await openMarkEditor(mark, this.host.session)
  }

  goTo(): void {
    /* A single page; nothing to jump to. */
  }

  restore(): void {
    /* Nothing to restore. */
  }

  zoomIn(): void {
    this.zoom = Math.min(6, this.zoom * 1.25)
    this.layout()
  }

  zoomOut(): void {
    this.zoom = Math.max(0.2, this.zoom / 1.25)
    this.layout()
  }

  toolsChanged(): void {
    this.element.classList.toggle('is-drawing', this.host.tools.isDrawing)
    this.overlay?.syncCaptureSurface()
  }

  marksChanged(): void {
    this.overlay?.render()
  }

  async exportDocument(): Promise<void> {
    await openExport({
      kind: 'image',
      entry: this.host.entry,
      marks: [...this.host.session.all()],
      image: { element: this.image },
    })
  }

  destroy(): void {
    for (const dispose of this.disposers) dispose()
    this.disposers = []
    this.overlay?.destroy()
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    if (this.scratch) {
      this.scratch.width = 0
      this.scratch.height = 0
      this.scratch = null
    }
  }
}

/* ===========================================================================
   Plain text and Markdown
   ======================================================================== */

export class TextViewer implements Viewer {
  readonly element: HTMLElement

  private readonly flow: HTMLElement
  private body: HTMLElement | null = null
  private text = ''
  private selectionMenu: HTMLElement | null = null
  private disposers: (() => void)[] = []

  constructor(private readonly host: ViewerHost) {
    this.flow = h('div.flow')
    this.element = h('div.viewport', {}, this.flow)
  }

  get count(): number {
    return 1
  }

  async load(): Promise<void> {
    this.text = await this.host.file.text()
    this.applyTypography()
    this.render()

    this.host.setPosition(1, 1)
    this.disposers.push(
      on(document, 'selectionchange', onFrame(() => this.updateSelectionMenu())),
      on(this.element, 'scroll', debounce(() => this.saveProgress(), 400), { passive: true }),
      on(this.element, 'pointerdown', (event) => {
        if (!(event.target as HTMLElement).closest('.selection-menu')) this.hideSelectionMenu()
      }),
    )
  }

  private render(): void {
    clear(this.flow)
    // Rendered as pre-wrapped text rather than as parsed Markdown: what a .md
    // file needs here is to be readable and quotable, and a half-implemented
    // Markdown renderer misrepresents the file it is showing.
    this.body = h('div.epub-chapter.flow-text', {}, this.text)
    this.flow.appendChild(this.body)
    this.applyMarks()
  }

  private applyTypography(): void {
    const { fontSize, lineHeight } = settings()
    this.flow.style.fontSize = `${fontSize}px`
    this.flow.style.lineHeight = String(lineHeight)
  }

  private applyMarks(): void {
    const root = this.body
    if (!root) return

    for (const existing of root.querySelectorAll('mark.folio-mark')) {
      const parent = existing.parentNode
      if (!parent) continue
      while (existing.firstChild) parent.insertBefore(existing.firstChild, existing)
      existing.remove()
    }
    root.normalize()

    const text = textOfNode(root)
    const located = this.host.session
      .all()
      .map((mark) => ({
        mark,
        range: findQuote(text, { quote: mark.quote ?? '', prefix: mark.prefix, suffix: mark.suffix }),
      }))
      .filter((entry) => entry.range)
      .sort((a, b) => (b.range?.start ?? 0) - (a.range?.start ?? 0))

    for (const { mark, range } of located) {
      if (!range) continue
      const domRange = rangeFromOffsets(root, range.start, range.end)
      if (!domRange) continue

      const wrapper = document.createElement('mark')
      wrapper.className = 'folio-mark'
      wrapper.style.background = mark.color
      wrapper.title = mark.comment ?? ''
      wrapper.addEventListener('click', (event) => {
        event.stopPropagation()
        void openMarkEditor(mark, this.host.session)
      })
      try {
        domRange.surroundContents(wrapper)
      } catch {
        // The text view has no nested markup, so this should not happen — but a
        // failed highlight must not take the document down with it.
      }
    }
  }

  private updateSelectionMenu(): void {
    const selection = document.getSelection()
    if (!selection || selection.isCollapsed || !this.body) {
      this.hideSelectionMenu()
      return
    }

    const range = selection.getRangeAt(0)
    if (!this.body.contains(range.commonAncestorContainer)) {
      this.hideSelectionMenu()
      return
    }

    if (!this.selectionMenu) {
      this.selectionMenu = h(
        'div.selection-menu',
        {},
        h('button.icon-button', {
          type: 'button',
          title: 'Markieren',
          html: icon('highlight', 18),
          onclick: () => void this.markSelection(false),
        }),
        h('button.icon-button', {
          type: 'button',
          title: 'Markieren und kommentieren',
          html: icon('note', 18),
          onclick: () => void this.markSelection(true),
        }),
      )
      // Without this, pressing a button clears the selection the button is
      // about to act on — the browser's default for a mousedown outside it.
      this.selectionMenu.addEventListener('mousedown', (event) => event.preventDefault())
      this.element.appendChild(this.selectionMenu)
    }

    const box = range.getBoundingClientRect()
    const host = this.element.getBoundingClientRect()
    const above = box.top - host.top + this.element.scrollTop - 46
    this.selectionMenu.style.top = `${above > this.element.scrollTop + 4 ? above : box.bottom - host.top + this.element.scrollTop + 8}px`
    this.selectionMenu.style.left = `${Math.max(8, box.left - host.left)}px`
  }

  private hideSelectionMenu(): void {
    this.selectionMenu?.remove()
    this.selectionMenu = null
  }

  private async markSelection(withComment: boolean): Promise<void> {
    const selection = document.getSelection()
    if (!selection || selection.isCollapsed || !this.body) return

    const offsets = offsetsOfRange(this.body, selection.getRangeAt(0))
    selection.removeAllRanges()
    this.hideSelectionMenu()
    if (!offsets) return

    const text = textOfNode(this.body)
    const mark: Mark = newMark(this.host.session.docId, 'highlight', {
      href: '',
      color: this.host.tools.highlightColor,
      quote: text.slice(offsets.start, offsets.end),
      prefix: text.slice(Math.max(0, offsets.start - CONTEXT_LENGTH), offsets.start),
      suffix: text.slice(offsets.end, offsets.end + CONTEXT_LENGTH),
    })

    await this.host.session.add(mark)
    if (withComment) await openMarkEditor(mark, this.host.session)
  }

  private saveProgress(): void {
    const scrollable = this.element.scrollHeight - this.element.clientHeight
    const within = scrollable > 8 ? this.element.scrollTop / scrollable : 1
    this.host.saveProgress(within, within.toFixed(3))
  }

  goTo(): void {
    /* One document, nothing to jump to. */
  }

  restore(location: string): void {
    const within = Number.parseFloat(location)
    if (!Number.isFinite(within)) return
    requestAnimationFrame(() => {
      this.element.scrollTop = within * (this.element.scrollHeight - this.element.clientHeight)
    })
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

  toolsChanged(): void {
    /* Only the text tools apply, and those follow the selection. */
  }

  marksChanged(): void {
    this.applyMarks()
  }

  async search(query: string): Promise<SearchHit[]> {
    if (query.trim().length < 2) return []
    const needle = query.trim().toLowerCase()
    const haystack = this.text.toLowerCase()
    const hits: SearchHit[] = []

    let at = haystack.indexOf(needle)
    while (at !== -1 && hits.length < 400) {
      hits.push({
        index: 0,
        offset: at,
        excerpt: this.text.slice(Math.max(0, at - 40), at + needle.length + 60).replace(/\s+/g, ' ').trim(),
      })
      at = haystack.indexOf(needle, at + needle.length)
    }
    return hits
  }

  showHit(hit: SearchHit): void {
    if (!this.body) return
    const range = rangeFromOffsets(this.body, hit.offset, hit.offset + 1)
    const element = range?.startContainer.parentElement
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  async exportDocument(): Promise<void> {
    await openExport({
      kind: 'text',
      entry: this.host.entry,
      marks: [...this.host.session.all()],
      text: { content: this.text },
    })
  }

  destroy(): void {
    for (const dispose of this.disposers) dispose()
    this.disposers = []
    this.hideSelectionMenu()
  }
}
