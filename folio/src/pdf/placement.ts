/**
 * Putting a mark back onto a PDF page.
 *
 * Marks are stored in the coordinate system the reader works in: the page as it
 * is *displayed*, origin top left, x and y from 0 to 1. A PDF page uses none of
 * that. Its origin is bottom left, it is measured in points, its visible area
 * is the CropBox rather than the MediaBox, and it may carry a `/Rotate` entry
 * that turns the whole thing by 90, 180 or 270 degrees before anyone sees it.
 *
 * So the exporter draws in an intermediate space — the displayed page, in
 * points, y pointing up — and prefixes the drawing with one transformation
 * matrix that maps that space onto the page's own. Text drawn that way comes
 * out upright on a rotated page, which is the whole point: four rotations and
 * a CropBox offset collapse into one matrix, computed here, and every drawing
 * routine downstream can pretend the page is a plain rectangle.
 */

export interface CropBox {
  x: number
  y: number
  width: number
  height: number
}

/** A PDF transformation matrix, in the order the `cm` operator expects. */
export type Matrix = [number, number, number, number, number, number]

export interface Placement {
  /** Size of the displayed page in points — what the reader sees. */
  displayWidth: number
  displayHeight: number
  /** Maps display space (origin bottom left, y up) onto PDF user space. */
  matrix: Matrix
}

/**
 * `rotation` is the page's `/Rotate` value; PDF allows any multiple of 90,
 * including negative ones, so it is normalised first.
 */
export function placePage(crop: CropBox, rotation: number): Placement {
  const angle = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360
  const { x, y, width: w, height: h } = crop

  switch (angle) {
    case 90:
      return { displayWidth: h, displayHeight: w, matrix: [0, 1, -1, 0, x + w, y] }
    case 180:
      return { displayWidth: w, displayHeight: h, matrix: [-1, 0, 0, -1, x + w, y + h] }
    case 270:
      return { displayWidth: h, displayHeight: w, matrix: [0, -1, 1, 0, x, y + h] }
    case 0:
    default:
      return { displayWidth: w, displayHeight: h, matrix: [1, 0, 0, 1, x, y] }
  }
}

/** Applies a matrix to a point — used by the tests and to place annotations. */
export function applyMatrix(m: Matrix, px: number, py: number): { x: number; y: number } {
  return { x: m[0] * px + m[2] * py + m[4], y: m[1] * px + m[3] * py + m[5] }
}

/**
 * Normalised mark coordinates to display points.
 *
 * `v` runs downwards in the stored mark and upwards in display space, which is
 * the one flip this conversion is responsible for.
 */
export function toDisplay(
  placement: Placement,
  u: number,
  v: number,
): { x: number; y: number } {
  return { x: u * placement.displayWidth, y: (1 - v) * placement.displayHeight }
}

export interface DisplayRect {
  x: number
  y: number
  width: number
  height: number
}

/** A normalised rectangle as a display-space rectangle with its origin at the bottom left. */
export function rectToDisplay(
  placement: Placement,
  r: { x: number; y: number; w: number; h: number },
): DisplayRect {
  return {
    x: r.x * placement.displayWidth,
    y: (1 - r.y - r.h) * placement.displayHeight,
    width: r.w * placement.displayWidth,
    height: r.h * placement.displayHeight,
  }
}

/**
 * Converts a normalised length.
 *
 * Widths follow the page width and heights the page height, which matters on
 * pages that are far from square: a pen stroke stored as 0.3 % of the width
 * has to stay 0.3 % of the width, not become that fraction of the height.
 */
export function lengthX(placement: Placement, value: number): number {
  return value * placement.displayWidth
}

export function lengthY(placement: Placement, value: number): number {
  return value * placement.displayHeight
}
