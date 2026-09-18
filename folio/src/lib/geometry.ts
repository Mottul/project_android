/**
 * Geometry for annotations.
 *
 * Every mark is stored in **normalised page coordinates**: x and y run from 0
 * to 1 across the page, origin top left, the same orientation the DOM uses.
 * That is the only representation that survives what the reader does to a page
 * — zooming, fitting to width, re-rendering at device pixel ratio, rotating —
 * and it is also the representation PDF export needs, since a PDF page has its
 * own size in points and its origin at the bottom left.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

/** A single pen stroke. Width is a fraction of the page width, like x and y. */
export interface InkPath {
  points: number[]
  width: number
}

export function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h }
}

/** Turns two corners into a rectangle with positive width and height. */
export function rectFromCorners(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  }
}

export function normaliseRect(r: Rect, width: number, height: number): Rect {
  return { x: r.x / width, y: r.y / height, w: r.w / width, h: r.h / height }
}

export function scaleRect(r: Rect, width: number, height: number): Rect {
  return { x: r.x * width, y: r.y * height, w: r.w * width, h: r.h * height }
}

export function containsPoint(r: Rect, p: Point, padding = 0): boolean {
  return (
    p.x >= r.x - padding &&
    p.x <= r.x + r.w + padding &&
    p.y >= r.y - padding &&
    p.y <= r.y + r.h + padding
  )
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
}

export function unionRects(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const r of rects) {
    left = Math.min(left, r.x)
    top = Math.min(top, r.y)
    right = Math.max(right, r.x + r.w)
    bottom = Math.max(bottom, r.y + r.h)
  }
  return { x: left, y: top, w: right - left, h: bottom - top }
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function clampRect(r: Rect): Rect {
  const x = clamp(r.x, 0, 1)
  const y = clamp(r.y, 0, 1)
  return { x, y, w: clamp(r.w, 0, 1 - x), h: clamp(r.h, 0, 1 - y) }
}

/**
 * Merges the client rectangles of a text selection into one per line.
 *
 * A selection across styled text produces a rectangle per run — bold words,
 * links and superscripts all get their own. Highlighting each separately shows
 * seams and, worse, exports as a dozen annotations for one sentence. Rectangles
 * that sit on the same line and touch are therefore joined.
 */
export function mergeLineRects(rects: readonly Rect[], tolerance = 0.004): Rect[] {
  if (rects.length < 2) return rects.map((r) => ({ ...r }))

  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: Rect[] = []

  for (const current of sorted) {
    const last = lines[lines.length - 1]
    const sameLine =
      last &&
      Math.abs(last.y - current.y) <= Math.max(tolerance, Math.min(last.h, current.h) * 0.5) &&
      current.x <= last.x + last.w + tolerance * 4

    if (!sameLine) {
      lines.push({ ...current })
      continue
    }

    const top = Math.min(last.y, current.y)
    const bottom = Math.max(last.y + last.h, current.y + current.h)
    const right = Math.max(last.x + last.w, current.x + current.w)
    last.x = Math.min(last.x, current.x)
    last.y = top
    last.w = right - last.x
    last.h = bottom - top
  }

  return lines
}

/**
 * Ramer–Douglas–Peucker. A finger drawing at 120 Hz produces thousands of
 * points per stroke; most of them sit on a straight line and cost storage,
 * render time and PDF size for nothing.
 */
export function simplifyPath(points: readonly number[], tolerance = 0.0015): number[] {
  const count = points.length / 2
  if (count < 3) return [...points]

  const keep = new Uint8Array(count)
  keep[0] = 1
  keep[count - 1] = 1

  const stack: [number, number][] = [[0, count - 1]]
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number]
    let maxDistance = 0
    let index = -1

    const ax = points[first * 2]
    const ay = points[first * 2 + 1]
    const bx = points[last * 2]
    const by = points[last * 2 + 1]

    for (let i = first + 1; i < last; i += 1) {
      const distance = pointLineDistance(points[i * 2], points[i * 2 + 1], ax, ay, bx, by)
      if (distance > maxDistance) {
        maxDistance = distance
        index = i
      }
    }

    if (maxDistance > tolerance && index > 0) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }

  const result: number[] = []
  for (let i = 0; i < count; i += 1) {
    if (keep[i]) result.push(points[i * 2], points[i * 2 + 1])
  }
  return result
}

function pointLineDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay)

  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1)
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Bounding box of a set of strokes, padded by half the widest stroke. */
export function inkBounds(paths: readonly InkPath[]): Rect | null {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  let widest = 0

  for (const path of paths) {
    widest = Math.max(widest, path.width)
    for (let i = 0; i < path.points.length; i += 2) {
      left = Math.min(left, path.points[i])
      right = Math.max(right, path.points[i])
      top = Math.min(top, path.points[i + 1])
      bottom = Math.max(bottom, path.points[i + 1])
    }
  }

  if (left === Infinity) return null
  const pad = widest / 2
  return { x: left - pad, y: top - pad, w: right - left + widest, h: bottom - top + widest }
}

/** Shortest distance from a point to any stroke — used by the eraser. */
export function distanceToPaths(paths: readonly InkPath[], p: Point): number {
  let best = Infinity
  for (const path of paths) {
    const { points } = path
    if (points.length === 2) {
      best = Math.min(best, Math.hypot(points[0] - p.x, points[1] - p.y))
      continue
    }
    for (let i = 0; i + 3 < points.length; i += 2) {
      best = Math.min(
        best,
        pointLineDistance(p.x, p.y, points[i], points[i + 1], points[i + 2], points[i + 3]),
      )
    }
  }
  return best
}
