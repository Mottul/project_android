/**
 * Marking text by dragging over it.
 *
 * This exists because of one thing Android does that cannot be turned off: as
 * soon as a page holds a native text selection, the system puts its own
 * floating bar on screen — copy, share, translate, web search. A page can
 * prevent selection from happening, but it cannot keep the selection and hide
 * the bar. So an app that highlights through the browser's selection always
 * shows two menus at once: the system's and its own.
 *
 * Folio therefore splits the two cases. While reading, the native selection
 * stays exactly as it is — it is familiar, and copy, share and translate come
 * with it for free. The moment a marker tool is picked, selection is switched
 * off on the text layer and this module takes the gesture instead: the caret
 * under the finger at the start and the caret under it now become a range,
 * which is previewed as it grows and written as a mark when the finger lifts.
 *
 * No native selection, no system bar, one menu — and marking becomes a stroke
 * over the words rather than select-then-choose, which is the gesture people
 * already make with a real highlighter.
 */

import { on } from '@/lib/dom'
import { rectsFromRange, type MarkedText } from '@/pdf/textlayer'

export interface TextDragHost {
  /** True while a tool that marks text is active. */
  isMarking(): boolean
  /** The page a node belongs to, for attributing rectangles. */
  pageOf(node: Node): { index: number; element: HTMLElement } | null
  /** Called continuously while the finger moves. */
  preview(marked: readonly MarkedText[]): void
  /** Called once, when the gesture ends with something to mark. */
  commit(marked: readonly MarkedText[]): void
  /** True while two fingers are panning or zooming the page. */
  gesturesBlocked(): boolean
}

interface Caret {
  node: Node
  offset: number
}

/**
 * The caret nearest a point on screen.
 *
 * Two vendor spellings of the same idea, neither of them universal. Chrome and
 * Safari have `caretRangeFromPoint`, Firefox `caretPositionFromPoint`; the
 * standard is slowly settling on the latter, so both are tried.
 */
export function caretAt(x: number, y: number): Caret | null {
  const doc = document as Document & {
    caretRangeFromPoint?(x: number, y: number): Range | null
    caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null
  }

  const range = doc.caretRangeFromPoint?.(x, y)
  if (range) return { node: range.startContainer, offset: range.startOffset }

  const position = doc.caretPositionFromPoint?.(x, y)
  return position ? { node: position.offsetNode, offset: position.offset } : null
}

/**
 * A range between two carets, in document order whichever way they were made.
 *
 * `setEnd` with a point that lies before the start collapses the range instead
 * of reversing it, which is what makes the second attempt necessary — dragging
 * backwards over a sentence is not an edge case.
 */
export function rangeBetween(from: Caret, to: Caret): Range | null {
  const range = document.createRange()
  try {
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
    if (!range.collapsed) return range

    range.setStart(to.node, to.offset)
    range.setEnd(from.node, from.offset)
    return range.collapsed ? null : range
  } catch {
    // The two carets are in different trees — a drag that left the document.
    return null
  }
}

export class TextDrag {
  private start: Caret | null = null
  private pointerId: number | null = null
  private disposers: (() => void)[] = []

  constructor(
    private readonly surface: HTMLElement,
    private readonly host: TextDragHost,
  ) {
    this.disposers.push(
      on(surface, 'pointerdown', (event) => this.begin(event as PointerEvent)),
      on(surface, 'pointermove', (event) => this.extend(event as PointerEvent)),
      on(surface, 'pointerup', (event) => this.finish(event as PointerEvent)),
      on(surface, 'pointercancel', () => this.cancel()),
    )
  }

  destroy(): void {
    for (const dispose of this.disposers) dispose()
    this.disposers = []
    this.cancel()
  }

  /** Abandons the gesture — used when a second finger starts a pinch. */
  cancel(): void {
    if (!this.start) return
    this.start = null
    this.pointerId = null
    this.host.preview([])
  }

  private begin(event: PointerEvent): void {
    if (!this.host.isMarking() || this.host.gesturesBlocked()) return
    if (event.button !== 0 && event.pointerType === 'mouse') return

    const target = event.target as HTMLElement | null
    if (!target?.closest('.text-layer')) return

    const caret = caretAt(event.clientX, event.clientY)
    if (!caret) return

    this.start = caret
    this.pointerId = event.pointerId
    // Without capture the gesture dies the moment the finger crosses from one
    // page element into the next.
    this.surface.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  private extend(event: PointerEvent): void {
    if (!this.start || event.pointerId !== this.pointerId) return
    event.preventDefault()
    this.host.preview(this.collect(event))
  }

  private finish(event: PointerEvent): void {
    if (!this.start || event.pointerId !== this.pointerId) return

    const marked = this.collect(event)
    this.start = null
    this.pointerId = null
    this.surface.releasePointerCapture?.(event.pointerId)

    this.host.preview([])
    if (marked.length) this.host.commit(marked)
  }

  private collect(event: PointerEvent): MarkedText[] {
    const end = caretAt(event.clientX, event.clientY)
    if (!this.start || !end) return []

    const range = rangeBetween(this.start, end)
    if (!range) return []

    return rectsFromRange(range, (node) => this.host.pageOf(node))
  }
}
