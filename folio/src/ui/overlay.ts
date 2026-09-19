/**
 * What sits on top of a page.
 *
 * Every page in the reader carries three layers above the rendered image: the
 * transparent text runs from pdf.js (selection), the marks that have already
 * been made, and — while a drawing tool is active — a capture surface that
 * takes pointer input.
 *
 * Marks are drawn as DOM elements rather than into a canvas. A highlight is a
 * `<div>` with a background and `mix-blend-mode: multiply`, ink is one `<path>`
 * per stroke in an SVG. That means hit testing, hover, focus and the browser's
 * own compositing come for free, and a zoom is a CSS resize rather than a
 * repaint of every annotation.
 *
 * All coordinates stored in a mark are normalised (0..1 of the page). The only
 * place that converts is here.
 */

import { h, on } from '@/lib/dom'
import {
  clampRect,
  distanceToPaths,
  inkBounds,
  rectFromCorners,
  simplifyPath,
  type InkPath,
  type Point,
  type Rect,
} from '@/lib/geometry'
import { newMark, type Mark } from '@/store/marks'
import type { MarksSession } from './marks-session'
import type { ToolState } from './tools'
import { icon } from './icons'

export interface OverlayHooks {
  /** Opens the comment editor for a mark. */
  onEditMark(mark: Mark): void
  /** A text box or replacement was placed and wants its editor. */
  onPlaceText(box: Rect): void
  /** Colour to paint over page content with, sampled from the rendered page. */
  sampleFill(box: Rect): string
  /**
   * True while the page itself owns the gesture — a two-finger pinch.
   *
   * Asked before every stroke, and it has to be: the gesture layer listens on
   * the viewport in the capture phase, so when a second finger lands it cancels
   * the stroke in progress *before* this layer sees the same event and would
   * cheerfully start another one.
   */
  gesturesBlocked(): boolean
}

export class PageOverlay {
  readonly markLayer: HTMLElement
  readonly inkLayer: HTMLCanvasElement
  /** Bands shown while a marker drag is still in progress. */
  private readonly previewLayer: HTMLElement

  private selectedId: string | null = null
  private disposers: (() => void)[] = []

  /** The stroke being drawn right now, in normalised coordinates. */
  private stroke: number[] = []
  private drawing = false

  constructor(
    private readonly page: HTMLElement,
    private readonly pageIndex: number,
    private readonly session: MarksSession,
    private readonly tools: ToolState,
    private readonly hooks: OverlayHooks,
  ) {
    this.markLayer = h('div.mark-layer')
    this.previewLayer = h('div.preview-layer')
    this.inkLayer = h('canvas.ink-layer.is-off') as HTMLCanvasElement

    this.page.appendChild(this.markLayer)
    this.page.appendChild(this.previewLayer)
    this.page.appendChild(this.inkLayer)

    this.disposers.push(
      on(this.inkLayer, 'pointerdown', (event) => this.onPointerDown(event as PointerEvent)),
      on(this.inkLayer, 'pointermove', (event) => this.onPointerMove(event as PointerEvent)),
      on(this.inkLayer, 'pointerup', (event) => this.onPointerUp(event as PointerEvent)),
      on(this.inkLayer, 'pointercancel', () => this.cancelGesture()),
    )
  }

  destroy(): void {
    for (const dispose of this.disposers) dispose()
    this.disposers = []
    this.markLayer.remove()
    this.previewLayer.remove()
    this.inkLayer.remove()
  }

  /**
   * Shows what a marker drag would produce, without storing anything.
   *
   * Drawn into its own layer rather than as provisional marks: a preview must
   * never reach the undo stack or the notes list, and keeping it out of the
   * mark layer means `render()` can run at any moment without wiping it.
   */
  preview(rects: readonly Rect[], color: string): void {
    this.previewLayer.replaceChildren()
    for (const rect of rects) {
      this.previewLayer.appendChild(
        h('div.preview-band', { style: `${this.place(rect)};background:${color}` }),
      )
    }
  }

  select(id: string | null): void {
    this.selectedId = id
    this.render()
  }

  /** Re-draws every mark of this page and re-sizes the capture surface. */
  render(): void {
    this.markLayer.replaceChildren()

    const marks = this.session.onPage(this.pageIndex)
    const strokes: Mark[] = []

    for (const mark of marks) {
      switch (mark.type) {
        case 'highlight':
        case 'underline':
        case 'strike':
          this.renderBands(mark)
          break
        case 'ink':
          strokes.push(mark)
          break
        case 'note':
          this.renderNote(mark)
          break
        case 'redact':
        case 'replace':
        case 'text':
          this.renderBox(mark)
          break
      }
    }

    if (strokes.length) this.markLayer.appendChild(this.renderInk(strokes))
    this.syncCaptureSurface()
  }

  /* — Rendering ————————————————————————————————————————————— */

  private renderBands(mark: Mark): void {
    for (const rect of mark.rects ?? []) {
      const element = h('div.mark-shape', {
        'data-mark': mark.id,
        style: this.place(rect),
        title: mark.comment || undefined,
      })

      if (mark.type === 'highlight') {
        element.classList.add('band')
        element.style.background = mark.color
        element.style.opacity = String(mark.opacity ?? 0.35)
      } else {
        // A line rather than a band: drawn as a border on the edge that matters,
        // so it scales with the page like everything else.
        const thickness = Math.max(1.5, rect.h * this.height * 0.07)
        element.style.borderBottom = `${thickness}px solid ${mark.color}`
        if (mark.type === 'strike') {
          element.style.height = `${rect.h * this.height * 0.55}px`
        }
      }

      if (mark.id === this.selectedId) element.classList.add('is-selected')
      element.addEventListener('click', (event) => {
        event.stopPropagation()
        this.hooks.onEditMark(mark)
      })
      this.markLayer.appendChild(element)
    }
  }

  /**
   * All strokes of a page in one SVG.
   *
   * The viewBox is the unit square and `preserveAspectRatio="none"` stretches
   * it over the page, so the stored coordinates go in unchanged at any zoom.
   * A stroke width would be stretched by the same transform — and unevenly, on
   * a page that is not square — so `vector-effect="non-scaling-stroke"` takes
   * it out of that space and it is given in pixels instead.
   */
  private renderInk(marks: Mark[]): SVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 1 1')
    svg.setAttribute('preserveAspectRatio', 'none')

    for (const mark of marks) {
      for (const path of mark.paths ?? []) {
        const element = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        element.setAttribute('d', pathData(path.points))
        element.setAttribute('fill', 'none')
        element.setAttribute('stroke', mark.color)
        element.setAttribute('stroke-width', (path.width * this.width).toFixed(2))
        element.setAttribute('stroke-linecap', 'round')
        element.setAttribute('stroke-linejoin', 'round')
        element.setAttribute('vector-effect', 'non-scaling-stroke')
        element.style.opacity = String(mark.opacity ?? 1)
        element.addEventListener('click', (event) => {
          event.stopPropagation()
          this.hooks.onEditMark(mark)
        })
        svg.appendChild(element)
      }
    }

    return svg
  }

  private renderNote(mark: Mark): void {
    if (!mark.box) return
    const pin = h('div.mark-shape.note-pin', {
      'data-mark': mark.id,
      title: mark.comment || 'Notiz',
      style:
        `left:${mark.box.x * 100}%;top:${mark.box.y * 100}%;` +
        `background:${mark.color};width:22px;height:22px;`,
      html: icon('note', 13),
    })
    if (mark.id === this.selectedId) pin.classList.add('is-selected')
    pin.addEventListener('click', (event) => {
      event.stopPropagation()
      this.hooks.onEditMark(mark)
    })
    this.markLayer.appendChild(pin)
  }

  private renderBox(mark: Mark): void {
    if (!mark.box) return

    const element = h('div.mark-shape', {
      'data-mark': mark.id,
      style: this.place(mark.box),
      title: mark.comment || undefined,
    })

    if (mark.type === 'redact' || mark.type === 'replace') {
      element.style.background = mark.fill ?? mark.color
    }
    if (mark.type === 'text' || mark.type === 'replace') {
      element.classList.add('text-box')
      element.textContent = mark.text ?? ''
      // Replacement text is frequently longer than what it replaces. The export
      // wraps it and lets the block grow downwards; the overlay has to do the
      // same, or the reader sees a clipped line and the export disagrees with
      // what was on screen.
      element.style.height = 'auto'
      element.style.minHeight = `${(mark.box.h ?? 0) * 100}%`
      element.style.color = mark.color
      element.style.fontSize = `${(mark.fontSize ?? 0.014) * this.height}px`
      element.style.fontFamily =
        mark.family === 'serif' ? 'var(--font-serif)' : mark.family === 'mono' ? 'var(--font-mono)' : 'var(--font-ui)'
      element.style.fontWeight = mark.bold ? '600' : '400'
      element.style.textAlign = mark.align ?? 'left'
    }

    if (mark.id === this.selectedId) element.classList.add('is-selected')
    element.addEventListener('click', (event) => {
      event.stopPropagation()
      this.hooks.onEditMark(mark)
    })
    this.markLayer.appendChild(element)
  }

  private place(rect: Rect): string {
    return (
      `left:${rect.x * 100}%;top:${rect.y * 100}%;` +
      `width:${rect.w * 100}%;height:${rect.h * 100}%`
    )
  }

  private get width(): number {
    return this.page.clientWidth || 1
  }

  private get height(): number {
    return this.page.clientHeight || 1
  }

  /* — Drawing ——————————————————————————————————————————————— */

  /** Turns the capture surface on or off to match the active tool. */
  syncCaptureSurface(): void {
    const active = this.tools.isDrawing
    this.inkLayer.classList.toggle('is-off', !active)
    if (!active) return

    const ratio = window.devicePixelRatio || 1
    const width = Math.round(this.width * ratio)
    const height = Math.round(this.height * ratio)
    if (this.inkLayer.width !== width || this.inkLayer.height !== height) {
      this.inkLayer.width = width
      this.inkLayer.height = height
    }
    this.inkLayer.style.width = '100%'
    this.inkLayer.style.height = '100%'
  }

  private pointOf(event: PointerEvent): Point {
    const box = this.page.getBoundingClientRect()
    return {
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    }
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.hooks.gesturesBlocked()) return

    const tool = this.tools.current
    const point = this.pointOf(event)

    if (tool === 'notiz') {
      event.preventDefault()
      void this.placeNote(point)
      return
    }

    if (tool === 'radierer') {
      event.preventDefault()
      this.drawing = true
      this.inkLayer.setPointerCapture(event.pointerId)
      void this.eraseAt(point)
      return
    }

    if (tool === 'stift' || tool === 'abdecken' || tool === 'textfeld') {
      event.preventDefault()
      this.drawing = true
      this.stroke = [point.x, point.y]
      this.inkLayer.setPointerCapture(event.pointerId)
      this.clearCapture()
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.drawing) return
    event.preventDefault()
    const point = this.pointOf(event)

    if (this.tools.current === 'radierer') {
      void this.eraseAt(point)
      return
    }

    this.stroke.push(point.x, point.y)

    if (this.tools.current === 'stift') {
      // Coalesced events give every sample the browser has, which is what makes
      // a stroke look drawn rather than sampled.
      for (const sample of event.getCoalescedEvents?.() ?? []) {
        const extra = this.pointOf(sample)
        this.stroke.push(extra.x, extra.y)
      }
      this.paintStroke()
    } else {
      this.paintBox()
    }
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.drawing) return
    this.drawing = false
    this.inkLayer.releasePointerCapture?.(event.pointerId)

    const tool = this.tools.current
    if (tool === 'radierer') return

    const points = this.stroke
    this.stroke = []
    this.clearCapture()
    if (points.length < 2) return

    if (tool === 'stift') {
      void this.commitStroke(points)
      return
    }

    const box = clampRect(
      rectFromCorners(
        { x: points[0], y: points[1] },
        { x: points[points.length - 2], y: points[points.length - 1] },
      ),
    )
    if (box.w < 0.005 || box.h < 0.004) return

    if (tool === 'abdecken') void this.commitRedaction(box)
    else this.hooks.onPlaceText(box)
  }

  /** Abandons whatever is being drawn — a second finger started a pinch. */
  cancelGesture(): void {
    this.drawing = false
    this.stroke = []
    this.clearCapture()
  }

  private context(): CanvasRenderingContext2D | null {
    return this.inkLayer.getContext('2d')
  }

  private clearCapture(): void {
    const context = this.context()
    context?.clearRect(0, 0, this.inkLayer.width, this.inkLayer.height)
  }

  private paintStroke(): void {
    const context = this.context()
    if (!context) return

    const ratio = window.devicePixelRatio || 1
    this.clearCapture()

    // The path is built under a scale that maps normalised coordinates onto the
    // canvas, then the transform is restored before stroking: path points are
    // transformed as they are added, the line width when it is drawn. That is
    // what keeps the stroke an even thickness on a page that is not square.
    context.save()
    context.scale(this.width * ratio, this.height * ratio)
    context.beginPath()
    context.moveTo(this.stroke[0], this.stroke[1])
    for (let i = 2; i < this.stroke.length; i += 2) {
      context.lineTo(this.stroke[i], this.stroke[i + 1])
    }
    context.restore()

    context.strokeStyle = this.tools.inkColor
    context.lineWidth = this.tools.inkWidth * this.width * ratio
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.stroke()
  }

  private paintBox(): void {
    const context = this.context()
    if (!context || this.stroke.length < 4) return

    const ratio = window.devicePixelRatio || 1
    this.clearCapture()

    const box = rectFromCorners(
      { x: this.stroke[0], y: this.stroke[1] },
      { x: this.stroke[this.stroke.length - 2], y: this.stroke[this.stroke.length - 1] },
    )

    context.strokeStyle = this.tools.inkColor
    context.setLineDash([6, 4])
    context.lineWidth = 1.5 * ratio
    context.strokeRect(
      box.x * this.width * ratio,
      box.y * this.height * ratio,
      box.w * this.width * ratio,
      box.h * this.height * ratio,
    )
    context.setLineDash([])
  }

  /* — Committing ————————————————————————————————————————————— */

  private async commitStroke(points: number[]): Promise<void> {
    const path: InkPath = {
      points: simplifyPath(points),
      width: this.tools.inkWidth,
    }
    if (!inkBounds([path])) return

    await this.session.add(
      newMark(this.session.docId, 'ink', {
        page: this.pageIndex,
        color: this.tools.inkColor,
        paths: [path],
      }),
    )
  }

  private async commitRedaction(box: Rect): Promise<void> {
    const fill = this.hooks.sampleFill(box)
    await this.session.add(
      newMark(this.session.docId, 'redact', {
        page: this.pageIndex,
        color: fill,
        fill,
        box,
      }),
    )
  }

  private async placeNote(point: Point): Promise<void> {
    const mark = newMark(this.session.docId, 'note', {
      page: this.pageIndex,
      color: this.tools.inkColor,
      box: { x: point.x, y: point.y, w: 0.03, h: 0.03 },
    })
    await this.session.add(mark)
    this.hooks.onEditMark(mark)
  }

  /**
   * The eraser removes whole strokes rather than parts of them.
   *
   * Splitting a stroke where the eraser crosses it is what a drawing app does;
   * for annotations it is the wrong model — a pen mark on a page is one gesture
   * and is undone as one, and partial erasure leaves fragments that are
   * impossible to select afterwards.
   */
  private async eraseAt(point: Point): Promise<void> {
    const reach = Math.max(this.tools.inkWidth * 2, 0.012)

    for (const mark of this.session.onPage(this.pageIndex)) {
      if (mark.type === 'ink') {
        if (distanceToPaths(mark.paths ?? [], point) <= reach) await this.session.remove(mark.id)
        continue
      }
      if ((mark.type === 'redact' || mark.type === 'text' || mark.type === 'replace') && mark.box) {
        const { x, y, w, h } = mark.box
        if (point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h) {
          await this.session.remove(mark.id)
        }
      }
    }
  }
}

/** `M x y L x y …` over normalised points. */
export function pathData(points: readonly number[]): string {
  if (points.length < 2) return ''
  let d = `M ${points[0]} ${points[1]}`
  for (let i = 2; i < points.length; i += 2) d += ` L ${points[i]} ${points[i + 1]}`
  return d
}
