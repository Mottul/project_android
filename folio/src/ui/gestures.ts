/**
 * Touch gestures over a document.
 *
 * One rule decides everything here: **one finger belongs to the tool, two
 * fingers belong to the page.** Drawing a pen stroke and scrolling are the same
 * gesture otherwise, and every PDF app that gets this right settles on the same
 * split. It also answers the question that comes with it — how do you scroll
 * while the pen is active — without a mode switch.
 *
 * What that costs is that the page can no longer be scrolled by the browser
 * alone while a tool is active: `touch-action: none` has to be set, or the
 * first finger scrolls instead of drawing. So panning with two fingers is done
 * here, by moving the scroll position directly.
 *
 * Pinching is shown live with a CSS transform, because re-rendering every page
 * at 60 Hz is not possible, and committed once at the end — the viewer then
 * re-renders crisply at the new zoom and puts the point that was between the
 * fingers back under them. The maths for that lives in the viewer, which is the
 * only place that knows where a point sits inside a page; see `ZoomAnchor`.
 */

import { on } from '@/lib/dom'

export interface Point {
  x: number
  y: number
}

/**
 * A place in the document, remembered across a re-render.
 *
 * Coordinates inside a page rather than scroll offsets: the scroll position
 * means nothing once every page has changed size, but "62 % down page 7" still
 * does.
 */
export interface ZoomAnchor {
  page: number
  u: number
  v: number
  /** Where that point should end up, in client pixels. */
  clientX: number
  clientY: number
}

export interface GestureHost {
  /** The scrolling element. */
  readonly viewport: HTMLElement
  /** The element scaled during a pinch — normally the column of pages. */
  readonly stage: HTMLElement

  /** Current zoom as a plain factor, so a pinch can multiply it. */
  currentScale(): number
  /** Zoom bounds, as factors. */
  readonly minScale: number
  readonly maxScale: number

  /** Where in the document a client point sits, or null if it is off-page. */
  anchorAt(clientX: number, clientY: number): ZoomAnchor | null
  /** Applies a new zoom and scrolls so the anchor lands where it says. */
  commitZoom(scale: number, anchor: ZoomAnchor | null): void

  /** Called when a second finger arrives mid-stroke, so the tool can back out. */
  cancelToolGesture(): void

  /** A double tap on the page, for toggling between fit-width and a close look. */
  onDoubleTap(point: Point): void
}

/* ===========================================================================
   Geometry
   ======================================================================== */

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function centreOf(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/**
 * The scale a pinch has reached.
 *
 * Separate from the event handling so the one piece with arithmetic in it can
 * be checked without synthesising pointer events.
 */
export function pinchScale(
  startScale: number,
  startDistance: number,
  currentDistance: number,
  min: number,
  max: number,
): number {
  if (startDistance < 1) return startScale
  return clamp((startScale * currentDistance) / startDistance, min, max)
}

/** How far apart two taps may be, in space and time, to count as a double tap. */
export const DOUBLE_TAP_MS = 320
export const DOUBLE_TAP_SLOP = 32

export function isDoubleTap(
  previous: { at: number; point: Point } | null,
  now: number,
  point: Point,
): boolean {
  if (!previous) return false
  return (
    now - previous.at <= DOUBLE_TAP_MS && distanceBetween(previous.point, point) <= DOUBLE_TAP_SLOP
  )
}

/* ===========================================================================
   The controller
   ======================================================================== */

interface PinchSession {
  startDistance: number
  startScale: number
  startCentre: Point
  anchor: ZoomAnchor | null
  scale: number
  centre: Point
}

export class GestureLayer {
  private readonly pointers = new Map<number, Point>()
  private pinch: PinchSession | null = null
  private lastTap: { at: number; point: Point } | null = null
  private tapCandidate: { id: number; point: Point } | null = null
  private disposers: (() => void)[] = []

  constructor(private readonly host: GestureHost) {
    const { viewport } = host
    this.disposers.push(
      on(viewport, 'pointerdown', (event) => this.down(event as PointerEvent), { capture: true }),
      on(viewport, 'pointermove', (event) => this.move(event as PointerEvent), { capture: true }),
      on(viewport, 'pointerup', (event) => this.up(event as PointerEvent), { capture: true }),
      on(viewport, 'pointercancel', (event) => this.up(event as PointerEvent), { capture: true }),

      /*
       * The one place a touch event is still needed.
       *
       * `touch-action` lets the browser scroll with one finger, which is what
       * makes reading feel native — but it would scroll with two fingers as
       * well, on top of the pinch. Only a non-passive `touchmove` can say no to
       * that, and only while it is still cancelable, which means from the very
       * first move of the gesture. Pointer events cannot: once the browser has
       * begun scrolling they stop being cancelable.
       */
      on(
        viewport,
        'touchmove',
        (event) => {
          if ((event as TouchEvent).touches.length >= 2) event.preventDefault()
        },
        { passive: false },
      ),
    )
  }

  destroy(): void {
    for (const dispose of this.disposers) dispose()
    this.disposers = []
    this.endPinch(false)
    this.pointers.clear()
  }

  /** True while two fingers are on the page, so other handlers can stand down. */
  get isPinching(): boolean {
    return this.pinch !== null
  }

  private down(event: PointerEvent): void {
    if (event.pointerType === 'mouse') return
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (this.pointers.size === 1) {
      this.tapCandidate = { id: event.pointerId, point: { x: event.clientX, y: event.clientY } }
      return
    }

    if (this.pointers.size === 2 && !this.pinch) {
      // A second finger always wins: whatever the first one was doing — drawing
      // a stroke, dragging a highlight — is abandoned rather than finished with
      // a stray flick.
      this.tapCandidate = null
      this.host.cancelToolGesture()
      this.startPinch()
    }
  }

  private move(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (this.tapCandidate && this.tapCandidate.id === event.pointerId) {
      const moved = distanceBetween(this.tapCandidate.point, { x: event.clientX, y: event.clientY })
      if (moved > DOUBLE_TAP_SLOP) this.tapCandidate = null
    }

    if (!this.pinch) return
    event.stopPropagation()
    this.updatePinch()
  }

  private up(event: PointerEvent): void {
    const wasPinching = this.pinch !== null
    this.pointers.delete(event.pointerId)

    if (wasPinching && this.pointers.size < 2) {
      this.endPinch(true)
      // The finger still down would otherwise be read as the start of a stroke.
      this.pointers.clear()
      return
    }

    if (!wasPinching && this.tapCandidate?.id === event.pointerId) {
      this.registerTap(this.tapCandidate.point)
      this.tapCandidate = null
    }
  }

  /**
   * A tap that might be the second of a pair.
   *
   * Only the *second* tap does anything, so a single tap keeps working as a
   * tap — which matters because a tap on a mark opens its editor.
   */
  private registerTap(point: Point): void {
    const now = performance.now()
    if (isDoubleTap(this.lastTap, now, point)) {
      this.lastTap = null
      this.host.onDoubleTap(point)
      return
    }
    this.lastTap = { at: now, point }
  }

  /* — Pinch ————————————————————————————————————————————————— */

  private twoPoints(): [Point, Point] | null {
    const points = [...this.pointers.values()]
    return points.length >= 2 ? [points[0], points[1]] : null
  }

  private startPinch(): void {
    const points = this.twoPoints()
    if (!points) return

    const centre = centreOf(points[0], points[1])
    const scale = this.host.currentScale()

    this.pinch = {
      startDistance: distanceBetween(points[0], points[1]),
      startScale: scale,
      startCentre: centre,
      anchor: this.host.anchorAt(centre.x, centre.y),
      scale,
      centre,
    }

    const stage = this.host.stage
    const box = stage.getBoundingClientRect()
    stage.style.transformOrigin = `${centre.x - box.left}px ${centre.y - box.top}px`
    stage.style.willChange = 'transform'
  }

  private updatePinch(): void {
    const session = this.pinch
    const points = this.twoPoints()
    if (!session || !points) return

    session.centre = centreOf(points[0], points[1])
    session.scale = pinchScale(
      session.startScale,
      session.startDistance,
      distanceBetween(points[0], points[1]),
      this.host.minScale,
      this.host.maxScale,
    )

    // The pinch centre is the transform origin, so scaling alone keeps the
    // grabbed point still; the translation is the two-finger pan on top of it.
    const dx = session.centre.x - session.startCentre.x
    const dy = session.centre.y - session.startCentre.y
    const factor = session.scale / session.startScale

    this.host.stage.style.transform = `translate(${dx}px, ${dy}px) scale(${factor})`
  }

  private endPinch(commit: boolean): void {
    const session = this.pinch
    this.pinch = null
    if (!session) return

    const stage = this.host.stage
    stage.style.transform = ''
    stage.style.transformOrigin = ''
    stage.style.willChange = ''

    if (!commit) return

    // The anchor was taken where the fingers started; it is handed back with
    // where they ended, so a pinch that also moved lands correctly.
    const anchor = session.anchor
      ? { ...session.anchor, clientX: session.centre.x, clientY: session.centre.y }
      : null

    this.host.commitZoom(session.scale, anchor)
  }
}
