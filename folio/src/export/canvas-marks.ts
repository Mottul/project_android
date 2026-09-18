/**
 * Drawing marks onto a canvas.
 *
 * Used by the two exports that produce a picture rather than a document: a page
 * of a PDF as PNG or JPEG, and an annotated image. The PDF exporter draws the
 * same marks with pdf-lib into a content stream; the shapes and the order have
 * to match, which is why both follow the same layering — fills, then bands,
 * then lines, then ink, then text.
 */

import type { Mark } from '@/store/marks'

export interface CanvasMarkOptions {
  /** Width and height of the target in device pixels. */
  width: number
  height: number
  /** Only marks of this page are drawn; images use page 0. */
  page?: number
}

export function drawMarksOnCanvas(
  context: CanvasRenderingContext2D,
  marks: readonly Mark[],
  options: CanvasMarkOptions,
): void {
  const { width, height } = options
  const page = options.page ?? 0
  const relevant = marks.filter((mark) => (mark.page ?? 0) === page)

  const x = (value: number) => value * width
  const y = (value: number) => value * height

  context.save()

  /* — Fills that cover the original ————————————————————————— */
  for (const mark of relevant) {
    if (mark.type !== 'redact' && mark.type !== 'replace') continue
    if (!mark.box) continue
    context.fillStyle = mark.fill ?? mark.color
    context.fillRect(x(mark.box.x), y(mark.box.y), x(mark.box.w), y(mark.box.h))
  }

  /* — Highlight bands ————————————————————————————————————— */
  context.globalCompositeOperation = 'multiply'
  for (const mark of relevant) {
    if (mark.type !== 'highlight') continue
    context.globalAlpha = mark.opacity ?? 0.35
    context.fillStyle = mark.color
    for (const rect of mark.rects ?? []) {
      context.fillRect(x(rect.x), y(rect.y), x(rect.w), y(rect.h))
    }
  }
  context.globalCompositeOperation = 'source-over'
  context.globalAlpha = 1

  /* — Underline and strike ————————————————————————————————— */
  for (const mark of relevant) {
    if (mark.type !== 'underline' && mark.type !== 'strike') continue
    context.strokeStyle = mark.color
    context.lineCap = 'round'

    for (const rect of mark.rects ?? []) {
      const thickness = Math.max(1, y(rect.h) * 0.07)
      context.lineWidth = thickness
      const lineY =
        mark.type === 'underline' ? y(rect.y + rect.h) - thickness : y(rect.y + rect.h * 0.55)
      context.beginPath()
      context.moveTo(x(rect.x), lineY)
      context.lineTo(x(rect.x + rect.w), lineY)
      context.stroke()
    }
  }

  /* — Ink ————————————————————————————————————————————————— */
  context.lineJoin = 'round'
  context.lineCap = 'round'
  for (const mark of relevant) {
    if (mark.type !== 'ink') continue
    context.strokeStyle = mark.color
    context.globalAlpha = mark.opacity ?? 1

    for (const path of mark.paths ?? []) {
      if (path.points.length < 2) continue
      context.lineWidth = Math.max(1, path.width * width)
      context.beginPath()
      context.moveTo(x(path.points[0]), y(path.points[1]))
      for (let i = 2; i < path.points.length; i += 2) {
        context.lineTo(x(path.points[i]), y(path.points[i + 1]))
      }
      context.stroke()
    }
  }
  context.globalAlpha = 1

  /* — Text ———————————————————————————————————————————————— */
  for (const mark of relevant) {
    if (mark.type !== 'text' && mark.type !== 'replace') continue
    if (!mark.box || !mark.text?.trim()) continue

    const size = Math.max(6, (mark.fontSize ?? 0.014) * height)
    const family =
      mark.family === 'serif' ? 'Georgia, serif' : mark.family === 'mono' ? 'monospace' : 'system-ui, sans-serif'
    context.font = `${mark.bold ? '600 ' : ''}${size}px ${family}`
    context.fillStyle = mark.color
    context.textBaseline = 'alphabetic'

    const lines = wrapOnCanvas(context, mark.text, x(mark.box.w))
    let lineY = y(mark.box.y) + size
    for (const line of lines) {
      const measured = context.measureText(line).width
      const lineX =
        mark.align === 'center'
          ? x(mark.box.x) + (x(mark.box.w) - measured) / 2
          : mark.align === 'right'
            ? x(mark.box.x) + x(mark.box.w) - measured
            : x(mark.box.x)
      context.fillText(line, lineX, lineY)
      lineY += size * 1.2
    }
  }

  /* — Note pins ——————————————————————————————————————————— */
  for (const mark of relevant) {
    if (mark.type !== 'note' || !mark.box) continue
    const size = Math.max(10, width * 0.018)
    context.fillStyle = mark.color
    context.strokeStyle = '#ffffff'
    context.lineWidth = Math.max(1, size * 0.09)
    context.beginPath()
    context.rect(x(mark.box.x), y(mark.box.y), size, size)
    context.fill()
    context.stroke()
  }

  context.restore()
}

function wrapOnCanvas(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = []

  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const piece of paragraph.split(/(\s+)/)) {
      if (!piece) continue
      const candidate = line + piece
      if (context.measureText(candidate).width <= maxWidth || !line.trim()) {
        line = candidate
      } else {
        lines.push(line.trimEnd())
        line = piece.trimStart()
      }
    }
    lines.push(line.trimEnd())
  }

  return lines
}

/**
 * Renders an image plus its marks into a blob.
 *
 * `maxEdge` is the quality knob that matters for photographs: a 12-megapixel
 * scan of a receipt is twelve times the file and none of the legibility of the
 * same scan at 2000 pixels.
 */
export async function composeImage(
  source: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number },
  marks: readonly Mark[],
  options: { maxEdge: number; quality: number; format: 'image/jpeg' | 'image/png' },
): Promise<Blob> {
  const naturalWidth = source.naturalWidth ?? (source.width as number) ?? 1
  const naturalHeight = source.naturalHeight ?? (source.height as number) ?? 1

  const longest = Math.max(naturalWidth, naturalHeight)
  const scale = options.maxEdge > 0 ? Math.min(1, options.maxEdge / longest) : 1

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(naturalHeight * scale))

  const context = canvas.getContext('2d', { alpha: options.format === 'image/png' })
  if (!context) throw new Error('Das Bild konnte nicht gezeichnet werden.')

  if (options.format === 'image/jpeg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  drawMarksOnCanvas(context, marks, { width: canvas.width, height: canvas.height, page: 0 })

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, options.format, options.quality),
  )
  canvas.width = 0
  canvas.height = 0
  if (!blob) throw new Error('Das Bild konnte nicht erzeugt werden.')
  return blob
}
