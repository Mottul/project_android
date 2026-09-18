/**
 * The PDF viewer.
 *
 * A continuous column of pages, of which only the ones near the viewport are
 * actually rendered. Every page gets a placeholder at its correct size as soon
 * as the document is open, so the scrollbar is right from the first frame and
 * scrolling never jumps; the canvas, the text layer and the annotation overlay
 * are built when the page comes close and thrown away when it goes far enough
 * away. Without that, a 400-page document is a few gigabytes of canvas.
 *
 * Rendering is driven by an IntersectionObserver rather than by scroll events:
 * the browser already knows what is visible, and asking it is both cheaper and
 * more accurate than recomputing it on every frame.
 */

import { clear, debounce, h, on, onFrame } from '@/lib/dom'
import { mergeLineRects, type Rect } from '@/lib/geometry'
import { newMark, type Mark } from '@/store/marks'
import { settings, setSetting } from '@/store/settings'
import {
  closePdf,
  openPdf,
  readMeta,
  readOutline,
  renderPage,
  PasswordRequired,
} from '@/pdf/loader'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { collectLines, pageText, renderTextLayer, rectsFromSelection, type TextLine } from '@/pdf/textlayer'
import { sampleColors } from '@/pdf/sample'
import { PageOverlay } from './overlay'
import { promptText, toast } from './feedback'
import type { SearchHit, Viewer, ViewerHost } from './viewer'
import { openMarkEditor } from './mark-editor'

import { openExport } from './lazy'
import { icon } from './icons'

/** How far outside the viewport a page is still worth having rendered. */
const RENDER_MARGIN = '900px 0px'
/** Rendered pages kept at once. Beyond this the furthest are released. */
const MAX_RENDERED = 8

interface PageSlot {
  index: number
  element: HTMLElement
  canvas: HTMLCanvasElement | null
  textLayer: HTMLElement | null
  overlay: PageOverlay | null
  page: PDFPageProxy | null
  /** Unscaled size in PDF points, used to lay the placeholder out. */
  width: number
  height: number
  renderTask: { cancel(): void } | null
  rendered: boolean
  lastSeen: number
}

export class PdfViewer implements Viewer {
  readonly element: HTMLElement

  private doc: PDFDocumentProxy | null = null
  private slots: PageSlot[] = []
  private observer: IntersectionObserver | null = null
  private disposers: (() => void)[] = []

  private readonly pagesHost: HTMLElement
  private selectionMenu: HTMLElement | null = null
  private editor: HTMLElement | null = null
  private editMode = false

  /** Kept so the export can rebuild the file without re-reading it from disk. */
  private source: ArrayBuffer | null = null
  private zoom: number | 'breite' | 'seite' = settings().zoom
  private current = 0
  /** Viewport width the pages were last laid out for. */
  private laidOutFor = 0

  constructor(private readonly host: ViewerHost) {
    this.pagesHost = h('div.pages')
    this.element = h('div.viewport', {}, this.pagesHost)
  }

  get count(): number {
    return this.slots.length
  }

  /* ========================================================================
     Loading
     ===================================================================== */

  async load(): Promise<void> {
    this.element.appendChild(busy('Dokument wird geöffnet …'))

    const buffer = await this.host.file.arrayBuffer()
    this.source = buffer

    try {
      this.doc = await openPdf(buffer)
    } catch (error) {
      if (error instanceof PasswordRequired) {
        const password = await promptText({
          title: 'Passwort nötig',
          label: 'Dieses PDF ist geschützt. Passwort eingeben:',
          confirmLabel: 'Öffnen',
        })
        if (password === null) throw error
        this.doc = await openPdf(buffer, password)
      } else {
        throw error
      }
    }

    clear(this.element)
    this.element.appendChild(this.pagesHost)

    const meta = await readMeta(this.doc)
    this.host.setMeta({ title: meta.title, author: meta.author, pages: meta.pages })
    void readOutline(this.doc).then((outline) => this.host.setOutline(outline))

    await this.buildSlots()
    this.watchVisibility()
    this.watchResize()
    this.watchSelection()
    this.host.setPosition(1, this.slots.length)
  }

  /**
   * Creates one placeholder per page, sized from the real page dimensions.
   *
   * The sizes are fetched in one pass at open time. It costs a round trip per
   * page to the worker, but it is metadata only — no content is parsed — and it
   * is the difference between a document whose scrollbar is honest and one that
   * resizes under the reader's thumb as pages load.
   */
  private async buildSlots(): Promise<void> {
    if (!this.doc) return
    const total = this.doc.numPages

    for (let index = 0; index < total; index += 1) {
      const element = h('div.page', { 'data-index': String(index) },
        h('div.placeholder', { html: '' }),
        h('span.page-number', {}, String(index + 1)),
      )

      this.slots.push({
        index,
        element,
        canvas: null,
        textLayer: null,
        overlay: null,
        page: null,
        // Replaced below; A4 is the right guess for the one frame it is used.
        width: 595,
        height: 842,
        renderTask: null,
        rendered: false,
        lastSeen: 0,
      })
      this.pagesHost.appendChild(element)
    }

    // Sizes, in batches, so the first pages are laid out before the last ones
    // have been asked about.
    for (let index = 0; index < total; index += 1) {
      const page = await this.doc.getPage(index + 1)
      const viewport = page.getViewport({ scale: 1 })
      this.slots[index].width = viewport.width
      this.slots[index].height = viewport.height
      page.cleanup()
      if (index % 16 === 0) this.layout()
    }
    this.layout()
  }

  /* ========================================================================
     Layout and zoom
     ===================================================================== */

  /** Width in CSS pixels a page should occupy at the current zoom. */
  private pageWidth(slot: PageSlot): number {
    const available = Math.max(200, this.element.clientWidth - 28)

    if (this.zoom === 'breite') return available
    if (this.zoom === 'seite') {
      const availableHeight = Math.max(200, this.element.clientHeight - 32)
      return Math.min(available, (slot.width / slot.height) * availableHeight)
    }
    // A CSS pixel is 96 dpi and a PDF point is 72; 100 % means physical size.
    return slot.width * (96 / 72) * this.zoom
  }

  private layout(): void {
    for (const slot of this.slots) {
      const width = this.pageWidth(slot)
      slot.element.style.width = `${Math.round(width)}px`
      slot.element.style.height = `${Math.round((slot.height / slot.width) * width)}px`
    }
  }

  private readonly relayout = debounce(() => {
    this.layout()
    // Everything rendered is now the wrong resolution.
    for (const slot of this.slots) {
      if (slot.rendered) this.release(slot, true)
    }
    this.renderVisible()
  }, 120)

  zoomIn(): void {
    this.setZoom(this.currentScale() * 1.25)
  }

  zoomOut(): void {
    this.setZoom(this.currentScale() / 1.25)
  }

  setZoom(value: number | 'breite' | 'seite'): void {
    this.zoom = typeof value === 'number' ? Math.min(6, Math.max(0.2, value)) : value
    setSetting('zoom', this.zoom)
    this.relayout()
  }

  /** The effective scale, so a zoom step out of "fit width" continues from there. */
  private currentScale(): number {
    if (typeof this.zoom === 'number') return this.zoom
    const slot = this.slots[this.current] ?? this.slots[0]
    if (!slot) return 1
    return this.pageWidth(slot) / (slot.width * (96 / 72))
  }

  /* ========================================================================
     Rendering
     ===================================================================== */

  private watchVisibility(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.index)
          const slot = this.slots[index]
          if (!slot) continue

          if (entry.isIntersecting) {
            slot.lastSeen = performance.now()
            void this.renderSlot(slot)
            if (entry.intersectionRatio > 0.35) this.setCurrent(index)
          }
        }
        this.trim()
      },
      { root: this.element, rootMargin: RENDER_MARGIN, threshold: [0, 0.35, 0.8] },
    )

    for (const slot of this.slots) this.observer.observe(slot.element)
  }

  /**
   * Re-lays out when the viewport really changed width.
   *
   * A ResizeObserver fires once as soon as it starts observing, reporting the
   * size the element already has. Acting on that would throw away every page
   * that was just rendered — and, worse, take any text selection with it, since
   * the spans the selection points at are rebuilt. Only an actual change counts.
   */
  private watchResize(): void {
    this.laidOutFor = this.element.clientWidth

    const observer = new ResizeObserver(() => {
      const width = this.element.clientWidth
      if (Math.abs(width - this.laidOutFor) < 1) return
      this.laidOutFor = width
      this.relayout()
    })
    observer.observe(this.element)
    this.disposers.push(() => observer.disconnect())
  }

  private setCurrent(index: number): void {
    if (this.current === index) return
    this.current = index
    this.host.setPosition(index + 1, this.slots.length)
    this.host.saveProgress((index + 1) / this.slots.length, String(index))
  }

  private renderVisible(): void {
    const view = this.element.getBoundingClientRect()
    for (const slot of this.slots) {
      const box = slot.element.getBoundingClientRect()
      if (box.bottom > view.top - 600 && box.top < view.bottom + 600) void this.renderSlot(slot)
    }
  }

  private async renderSlot(slot: PageSlot): Promise<void> {
    if (!this.doc || slot.rendered) return
    slot.rendered = true

    try {
      const page = slot.page ?? (await this.doc.getPage(slot.index + 1))
      slot.page = page

      const canvas = h('canvas.page-canvas') as HTMLCanvasElement
      const width = this.pageWidth(slot)
      const { task, scale } = renderPage(page, canvas, width)
      slot.renderTask = task
      await task.promise
      slot.renderTask = null

      slot.element.querySelector('.placeholder')?.remove()
      slot.canvas?.remove()
      slot.canvas = canvas
      slot.element.prepend(canvas)

      // The text layer goes in after the canvas so it sits above it, and before
      // the annotation layers so marks stay clickable.
      const textLayer = h('div.text-layer')
      slot.textLayer?.remove()
      slot.textLayer = textLayer
      slot.element.appendChild(textLayer)
      await renderTextLayer(page, page.getViewport({ scale }), textLayer)

      if (!slot.overlay) {
        slot.overlay = new PageOverlay(slot.element, slot.index, this.host.session, this.host.tools, {
          onEditMark: (mark) => void this.editMark(mark),
          onPlaceText: (box) => this.openTextEditor(slot, box, null),
          sampleFill: (box) => this.sampleFill(slot, box),
        })
      }
      slot.overlay.render()
      this.applyToolState(slot)
      if (this.editMode) this.decorateEditTargets(slot)
    } catch (error) {
      slot.rendered = false
      if ((error as { name?: string }).name !== 'RenderingCancelledException') {
        console.warn('[Folio] Seite konnte nicht gerendert werden:', error)
      }
    }
  }

  /** Frees the heavy parts of a page that is far out of view. */
  private release(slot: PageSlot, keepOverlay = false): void {
    slot.renderTask?.cancel()
    slot.renderTask = null

    if (slot.canvas) {
      slot.canvas.width = 0
      slot.canvas.height = 0
      slot.canvas.remove()
      slot.canvas = null
    }
    slot.textLayer?.remove()
    slot.textLayer = null

    if (!keepOverlay) {
      slot.page?.cleanup()
      slot.page = null
    }
    slot.rendered = false

    if (!slot.element.querySelector('.placeholder')) {
      slot.element.prepend(h('div.placeholder'))
    }
  }

  private trim(): void {
    const rendered = this.slots.filter((slot) => slot.rendered)
    if (rendered.length <= MAX_RENDERED) return

    rendered
      .sort((a, b) => a.lastSeen - b.lastSeen)
      .slice(0, rendered.length - MAX_RENDERED)
      .forEach((slot) => this.release(slot))
  }

  /* ========================================================================
     Navigation
     ===================================================================== */

  goTo(index: number): void {
    const slot = this.slots[Math.max(0, Math.min(this.slots.length - 1, index))]
    if (!slot) return
    slot.element.scrollIntoView({ block: 'start', behavior: 'smooth' })
    this.setCurrent(slot.index)
  }

  restore(location: string): void {
    const index = Number.parseInt(location, 10)
    if (Number.isFinite(index) && index > 0) {
      // No smooth scroll when restoring: the document has just opened and an
      // animation from page one to page 180 is a second of nothing useful.
      const slot = this.slots[Math.min(index, this.slots.length - 1)]
      slot?.element.scrollIntoView({ block: 'start' })
      this.setCurrent(slot?.index ?? 0)
    }
  }

  /* ========================================================================
     Tools
     ===================================================================== */

  toolsChanged(): void {
    for (const slot of this.slots) this.applyToolState(slot)

    const editing = this.host.tools.current === 'bearbeiten'
    if (editing !== this.editMode) {
      this.editMode = editing
      for (const slot of this.slots) {
        if (editing) this.decorateEditTargets(slot)
        else slot.element.querySelector('.edit-hint')?.remove()
      }
      if (editing) {
        toast('Auf eine Textzeile tippen, um sie zu ändern.', { duration: 5000 })
      }
    }
  }

  private applyToolState(slot: PageSlot): void {
    const drawing = this.host.tools.isDrawing
    this.element.classList.toggle('is-drawing', drawing)
    slot.textLayer?.classList.toggle('is-inert', drawing || this.editMode)
    slot.overlay?.syncCaptureSurface()
  }

  marksChanged(): void {
    for (const slot of this.slots) slot.overlay?.render()
  }

  /* ========================================================================
     Text selection
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
    if (!selection || selection.isCollapsed || this.host.tools.isDrawing) {
      this.hideSelectionMenu()
      return
    }

    const anchor = selection.anchorNode
    if (!anchor || !this.element.contains(anchor.nodeType === 1 ? anchor : anchor.parentNode)) {
      this.hideSelectionMenu()
      return
    }

    const range = selection.getRangeAt(0)
    const box = range.getBoundingClientRect()
    if (!box.width && !box.height) return

    const menu = this.buildSelectionMenu()
    const host = this.element.getBoundingClientRect()

    // Above the selection where there is room, below it otherwise.
    const above = box.top - host.top + this.element.scrollTop - 46
    menu.style.top = `${above > this.element.scrollTop + 4 ? above : box.bottom - host.top + this.element.scrollTop + 8}px`
    menu.style.left = `${Math.max(8, box.left - host.left + this.element.scrollLeft + box.width / 2 - 100)}px`
  }

  private buildSelectionMenu(): HTMLElement {
    if (this.selectionMenu) return this.selectionMenu

    const menu = h('div.selection-menu')
    // Pressing a button clears the text selection before the click handler can
    // read it — that is the browser's default for any mousedown outside the
    // selection. Suppressing it is what keeps "markieren" working at all.
    menu.addEventListener('mousedown', (event) => event.preventDefault())

    const add = (label: string, iconName: string, type: Mark['type']) =>
      menu.appendChild(
        h('button.icon-button', {
          type: 'button',
          title: label,
          'aria-label': label,
          html: icon(iconName),
          onclick: () => void this.markSelection(type),
        }),
      )

    add('Markieren', 'highlight', 'highlight')
    add('Unterstreichen', 'underline', 'underline')
    add('Durchstreichen', 'strike', 'strike')
    menu.appendChild(h('span.divider'))
    menu.appendChild(
      h('button.icon-button', {
        type: 'button',
        title: 'Markieren und kommentieren',
        'aria-label': 'Markieren und kommentieren',
        html: icon('note'),
        onclick: () => void this.markSelection('highlight', true),
      }),
    )
    menu.appendChild(
      h('button.icon-button', {
        type: 'button',
        title: 'Kopieren',
        'aria-label': 'Kopieren',
        html: icon('file'),
        onclick: () => void this.copySelection(),
      }),
    )

    this.selectionMenu = menu
    this.element.appendChild(menu)
    return menu
  }

  private hideSelectionMenu(): void {
    this.selectionMenu?.remove()
    this.selectionMenu = null
  }

  private slotForNode(node: Node): { index: number; element: HTMLElement } | null {
    const element = (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement)?.closest('.page')
    if (!element) return null
    return { index: Number((element as HTMLElement).dataset.index), element: element as HTMLElement }
  }

  private async markSelection(type: Mark['type'], withComment = false): Promise<void> {
    const selection = document.getSelection()
    if (!selection || selection.isCollapsed) return

    const perPage = rectsFromSelection(selection, (node) => this.slotForNode(node))
    selection.removeAllRanges()
    this.hideSelectionMenu()
    if (!perPage.length) return

    let last: Mark | null = null
    for (const entry of perPage) {
      const mark = newMark(this.host.session.docId, type, {
        page: entry.page,
        color: this.host.tools.highlightColor,
        rects: mergeLineRects(entry.rects),
        quote: entry.text,
        opacity: type === 'highlight' ? 0.35 : 1,
      })
      last = await this.host.session.add(mark)
    }

    if (withComment && last) await this.editMark(last)
  }

  private async copySelection(): Promise<void> {
    const text = document.getSelection()?.toString() ?? ''
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast('In die Zwischenablage kopiert.', { kind: 'ok', duration: 1800 })
    } catch {
      toast('Kopieren wurde vom Browser abgelehnt.', { kind: 'warn' })
    }
    this.hideSelectionMenu()
  }

  /* ========================================================================
     Marks
     ===================================================================== */

  private async editMark(mark: Mark): Promise<void> {
    await openMarkEditor(mark, this.host.session)
  }

  /**
   * The colour to paint over a region with.
   *
   * Read off the rendered canvas rather than assumed to be white: covering a
   * line on a scan, a coloured table row or a letterhead with white would be
   * more visible than the text that was there.
   */
  private sampleFill(slot: PageSlot, box: Rect): string {
    if (!slot.canvas) return '#ffffff'
    return sampleColors(slot.canvas, box).background
  }

  /* ========================================================================
     Editing page text
     ===================================================================== */

  /** Puts a clickable target over every line of the page while editing. */
  private decorateEditTargets(slot: PageSlot): void {
    slot.element.querySelector('.edit-hint')?.remove()
    if (!slot.textLayer) return

    const pageBox = slot.element.getBoundingClientRect()
    const lines = collectLines(slot.textLayer, pageBox)
    if (!lines.length) return

    const layer = h('div.edit-hint')
    for (const line of lines) {
      layer.appendChild(
        h('div.line-target', {
          style:
            `left:${line.box.x * 100}%;top:${line.box.y * 100}%;` +
            `width:${line.box.w * 100}%;height:${line.box.h * 100}%`,
          title: line.text,
          onclick: (event: Event) => {
            event.stopPropagation()
            this.openTextEditor(slot, line.box, line)
          },
        }),
      )
    }
    slot.element.appendChild(layer)
  }

  /**
   * Opens the in-place editor for a line, or for a new text box.
   *
   * Editing a PDF's text really means covering the original and drawing new
   * text over it — a PDF has no paragraphs to re-flow, only glyphs placed at
   * coordinates. Which is why the editor is exactly the size of what it
   * replaces, and why the replacement records what was there before.
   */
  private openTextEditor(slot: PageSlot, box: Rect, line: TextLine | null): void {
    this.closeTextEditor()

    const isReplacement = line !== null
    const fill = isReplacement ? this.sampleFill(slot, grow(box)) : 'transparent'
    const sampled = slot.canvas ? sampleColors(slot.canvas, box) : null
    const color = isReplacement ? (sampled?.text ?? '#111827') : this.host.tools.inkColor
    const fontSize = line?.fontSize ?? 0.016

    const area = h('textarea', {
      style:
        `font-size:${fontSize * slot.element.clientHeight}px;` +
        `color:${color};` +
        `font-family:${line?.family === 'serif' ? 'var(--font-serif)' : line?.family === 'mono' ? 'var(--font-mono)' : 'var(--font-ui)'};` +
        `font-weight:${line?.bold ? 600 : 400}`,
    }) as HTMLTextAreaElement
    area.value = line?.text ?? ''

    const editor = h('div.text-editor', {
      style:
        `left:${box.x * 100}%;top:${box.y * 100}%;` +
        `width:${Math.max(box.w, 0.08) * 100}%;height:${Math.max(box.h, fontSize * 1.4) * 100}%;` +
        (isReplacement ? `background:${fill}` : ''),
    }, area)

    const commit = async (keep: boolean) => {
      const text = area.value
      this.closeTextEditor()
      if (!keep) return

      if (isReplacement && text === line?.text) return
      if (!isReplacement && !text.trim()) return

      await this.host.session.add(
        newMark(this.host.session.docId, isReplacement ? 'replace' : 'text', {
          page: slot.index,
          box: isReplacement ? grow(box) : box,
          text,
          original: line?.text,
          fill: isReplacement ? fill : undefined,
          color,
          fontSize,
          family: line?.family === 'mono' ? 'mono' : line?.family === 'serif' ? 'serif' : 'sans',
          bold: line?.bold ?? false,
        }),
      )
    }

    const actions = h(
      'div.editor-actions',
      {},
      h('button.button.primary', { type: 'button', onclick: () => void commit(true) }, 'Übernehmen'),
      h('button.button', { type: 'button', onclick: () => void commit(false) }, 'Verwerfen'),
      isReplacement
        ? h(
            'button.button',
            {
              type: 'button',
              title: 'Die Zeile nur abdecken, ohne neuen Text',
              onclick: async () => {
                area.value = ''
                await commit(true)
              },
            },
            'Löschen',
          )
        : null,
    )
    editor.appendChild(actions)

    area.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void commit(false)
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void commit(true)
      }
    })

    slot.element.appendChild(editor)
    this.editor = editor
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
  }

  private closeTextEditor(): void {
    this.editor?.remove()
    this.editor = null
  }

  /* ========================================================================
     Search
     ===================================================================== */

  async search(query: string): Promise<SearchHit[]> {
    if (!this.doc || query.trim().length < 2) return []
    const needle = query.trim().toLowerCase()
    const hits: SearchHit[] = []

    for (let index = 0; index < this.doc.numPages; index += 1) {
      const page = await this.doc.getPage(index + 1)
      const text = await pageText(page)
      page.cleanup()

      const haystack = text.toLowerCase()
      let at = haystack.indexOf(needle)
      while (at !== -1 && hits.length < 400) {
        hits.push({
          index,
          offset: at,
          excerpt: text.slice(Math.max(0, at - 40), at + needle.length + 60).replace(/\s+/g, ' ').trim(),
        })
        at = haystack.indexOf(needle, at + needle.length)
      }
      if (hits.length >= 400) break
    }

    return hits
  }

  showHit(hit: SearchHit): void {
    this.goTo(hit.index)
  }

  /* ========================================================================
     Thumbnails and export
     ===================================================================== */

  renderThumbnails(container: HTMLElement, onPick: (index: number) => void): void {
    clear(container)
    const list = h('div.thumb-list')
    container.appendChild(list)

    for (const slot of this.slots) {
      const canvas = h('canvas') as HTMLCanvasElement
      const button = h(
        'button.thumb',
        {
          type: 'button',
          'aria-current': String(slot.index === this.current),
          'data-thumb': String(slot.index),
          onclick: () => onPick(slot.index),
        },
        canvas,
        h('span.n', {}, String(slot.index + 1)),
      )
      list.appendChild(button)
    }

    // Thumbnails are drawn lazily, for the same reason pages are.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          observer.unobserve(entry.target)
          const index = Number((entry.target as HTMLElement).dataset.thumb)
          void this.drawThumbnail(index, entry.target.querySelector('canvas') as HTMLCanvasElement)
        }
      },
      { root: container, rootMargin: '300px 0px' },
    )
    for (const button of list.querySelectorAll('.thumb')) observer.observe(button)
    this.disposers.push(() => observer.disconnect())
  }

  private async drawThumbnail(index: number, canvas: HTMLCanvasElement): Promise<void> {
    if (!this.doc || !canvas) return
    try {
      const page = await this.doc.getPage(index + 1)
      const { task } = renderPage(page, canvas, 150, 1)
      await task.promise
      page.cleanup()
    } catch {
      /* A thumbnail that will not draw is not worth reporting. */
    }
  }

  async exportDocument(): Promise<void> {
    if (!this.doc || !this.source) return
    await openExport({
      kind: 'pdf',
      entry: this.host.entry,
      marks: [...this.host.session.all()],
      pdf: { doc: this.doc, source: this.source },
    })
  }

  /* ========================================================================
     Teardown
     ===================================================================== */

  destroy(): void {
    this.observer?.disconnect()
    for (const dispose of this.disposers) dispose()
    this.disposers = []
    this.closeTextEditor()
    this.hideSelectionMenu()

    for (const slot of this.slots) {
      slot.overlay?.destroy()
      this.release(slot)
    }
    this.slots = []

    if (this.doc) void closePdf(this.doc)
    this.doc = null
    this.source = null
  }
}

/** A replacement covers slightly more than the text it replaces, so no
 *  anti-aliased edge of the original peeks out from under the fill. */
function grow(box: Rect): Rect {
  const padX = box.h * 0.12
  const padY = box.h * 0.14
  return {
    x: Math.max(0, box.x - padX),
    y: Math.max(0, box.y - padY),
    w: Math.min(1, box.w + padX * 2),
    h: Math.min(1, box.h + padY * 2),
  }
}

function busy(label: string): HTMLElement {
  return h('div.busy', {}, h('div.spinner'), h('p', {}, label))
}
