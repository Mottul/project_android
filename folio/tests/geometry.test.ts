import { describe, expect, it } from 'vitest'
import {
  clampRect,
  distanceToPaths,
  inkBounds,
  mergeLineRects,
  rectFromCorners,
  simplifyPath,
  unionRects,
} from '@/lib/geometry'

describe('mergeLineRects', () => {
  it('joins the fragments of one line into a single band', () => {
    // A sentence with a bold word in it produces three rectangles.
    const merged = mergeLineRects([
      { x: 0.1, y: 0.2, w: 0.2, h: 0.02 },
      { x: 0.3, y: 0.2, w: 0.1, h: 0.02 },
      { x: 0.4, y: 0.2, w: 0.2, h: 0.02 },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].x).toBeCloseTo(0.1)
    expect(merged[0].w).toBeCloseTo(0.5)
  })

  it('keeps separate lines apart', () => {
    const merged = mergeLineRects([
      { x: 0.1, y: 0.2, w: 0.3, h: 0.02 },
      { x: 0.1, y: 0.25, w: 0.3, h: 0.02 },
    ])
    expect(merged).toHaveLength(2)
  })

  it('does not join runs with a gap between them', () => {
    const merged = mergeLineRects([
      { x: 0.1, y: 0.2, w: 0.1, h: 0.02 },
      { x: 0.7, y: 0.2, w: 0.1, h: 0.02 },
    ])
    expect(merged).toHaveLength(2)
  })

  it('takes the tallest extent of a line with mixed sizes', () => {
    const merged = mergeLineRects([
      { x: 0.1, y: 0.2, w: 0.1, h: 0.02 },
      { x: 0.2, y: 0.195, w: 0.1, h: 0.03 },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].y).toBeCloseTo(0.195)
    expect(merged[0].h).toBeCloseTo(0.03)
  })
})

describe('simplifyPath', () => {
  it('reduces a straight line to its ends', () => {
    const points: number[] = []
    for (let i = 0; i <= 50; i += 1) points.push(i / 50, 0.5)
    expect(simplifyPath(points)).toEqual([0, 0.5, 1, 0.5])
  })

  it('keeps the corner of a stroke that actually turns', () => {
    const simplified = simplifyPath([0, 0, 0.25, 0, 0.5, 0.5, 0.75, 1, 1, 1])
    expect(simplified.length).toBeGreaterThan(4)
  })

  it('leaves very short strokes alone', () => {
    expect(simplifyPath([0.1, 0.1, 0.2, 0.2])).toEqual([0.1, 0.1, 0.2, 0.2])
  })
})

describe('ink helpers', () => {
  it('pads the bounding box by the stroke width', () => {
    const bounds = inkBounds([{ points: [0.2, 0.2, 0.6, 0.6], width: 0.01 }])
    expect(bounds?.x).toBeCloseTo(0.195)
    expect(bounds?.w).toBeCloseTo(0.41)
  })

  it('measures how far a point is from a stroke', () => {
    const paths = [{ points: [0, 0.5, 1, 0.5], width: 0.004 }]
    expect(distanceToPaths(paths, { x: 0.5, y: 0.52 })).toBeCloseTo(0.02)
    expect(distanceToPaths(paths, { x: 0.5, y: 0.5 })).toBeCloseTo(0)
  })
})

describe('rectangles', () => {
  it('normalises corners in any order', () => {
    expect(rectFromCorners({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.1 })).toEqual({
      x: 0.2,
      y: 0.1,
      w: 0.6000000000000001,
      h: 0.8,
    })
  })

  it('clamps a rectangle into the page', () => {
    const clamped = clampRect({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 })
    expect(clamped.x + clamped.w).toBeLessThanOrEqual(1)
    expect(clamped.y + clamped.h).toBeLessThanOrEqual(1)
  })

  it('unions a set of rectangles', () => {
    const union = unionRects([
      { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
      { x: 0.5, y: 0.4, w: 0.2, h: 0.1 },
    ])
    expect(union).toEqual({ x: 0.1, y: 0.1, w: 0.6, h: 0.4 })
    expect(unionRects([])).toBeNull()
  })
})
