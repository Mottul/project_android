import { describe, expect, it } from 'vitest'
import { applyMatrix, placePage, rectToDisplay, toDisplay } from '@/pdf/placement'

/**
 * The four corners of the displayed page, as the export sees them, and where
 * each of them has to land in the page's own coordinate system.
 *
 * Getting this wrong is the kind of bug that only shows up on the one rotated
 * page in a scanned document, which is exactly why it is pinned down here.
 */
const crop = { x: 0, y: 0, width: 600, height: 800 }

describe('placePage', () => {
  it('leaves an unrotated page alone', () => {
    const placement = placePage(crop, 0)
    expect(placement.displayWidth).toBe(600)
    expect(placement.displayHeight).toBe(800)

    // Bottom left of the display is the origin of the page.
    expect(applyMatrix(placement.matrix, 0, 0)).toEqual({ x: 0, y: 0 })
    expect(applyMatrix(placement.matrix, 600, 800)).toEqual({ x: 600, y: 800 })
  })

  it('swaps the axes for a page rotated by 90 degrees', () => {
    const placement = placePage(crop, 90)
    expect(placement.displayWidth).toBe(800)
    expect(placement.displayHeight).toBe(600)

    // The displayed bottom left is the page's bottom right.
    expect(applyMatrix(placement.matrix, 0, 0)).toEqual({ x: 600, y: 0 })
    // The displayed top left is the page's bottom left.
    expect(applyMatrix(placement.matrix, 0, 600)).toEqual({ x: 0, y: 0 })
  })

  it('turns a page rotated by 180 degrees around', () => {
    const placement = placePage(crop, 180)
    expect(placement.displayWidth).toBe(600)
    expect(applyMatrix(placement.matrix, 0, 0)).toEqual({ x: 600, y: 800 })
  })

  it('handles 270 degrees', () => {
    const placement = placePage(crop, 270)
    expect(placement.displayWidth).toBe(800)
    expect(applyMatrix(placement.matrix, 0, 0)).toEqual({ x: 0, y: 800 })
  })

  it('keeps text upright: every rotation is a rotation, never a mirror', () => {
    for (const angle of [0, 90, 180, 270, -90, 450]) {
      const [a, b, c, d] = placePage(crop, angle).matrix
      // A negative determinant would flip the drawing and render text mirrored.
      expect(a * d - b * c).toBeCloseTo(1)
    }
  })

  it('normalises angles that are negative or past a full turn', () => {
    expect(placePage(crop, -90).matrix).toEqual(placePage(crop, 270).matrix)
    expect(placePage(crop, 450).matrix).toEqual(placePage(crop, 90).matrix)
  })

  it('respects a CropBox that does not start at the origin', () => {
    const placement = placePage({ x: 20, y: 30, width: 560, height: 740 }, 0)
    expect(placement.displayWidth).toBe(560)
    expect(applyMatrix(placement.matrix, 0, 0)).toEqual({ x: 20, y: 30 })
  })
})

describe('mark coordinates', () => {
  it('flips the y axis when converting a stored mark', () => {
    const placement = placePage(crop, 0)
    // A mark at the very top of the page, in display space, is at the top.
    expect(toDisplay(placement, 0.5, 0)).toEqual({ x: 300, y: 800 })
    expect(toDisplay(placement, 0.5, 1)).toEqual({ x: 300, y: 0 })
  })

  it('places a rectangle with its origin at the bottom left', () => {
    const placement = placePage(crop, 0)
    const box = rectToDisplay(placement, { x: 0.1, y: 0.1, w: 0.5, h: 0.2 })

    expect(box.x).toBeCloseTo(60)
    expect(box.width).toBeCloseTo(300)
    expect(box.height).toBeCloseTo(160)
    // Stored y is measured from the top; the PDF box starts at its bottom edge.
    expect(box.y).toBeCloseTo(800 - 0.3 * 800)
  })
})
