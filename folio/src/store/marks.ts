/**
 * Marks — everything a reader adds to a document.
 *
 * One type covers all of them. A discriminated union with eight members would
 * be more precise on paper, but every consumer (the overlay renderer, the
 * sidebar, the PDF exporter) has to handle all of them anyway, and a mark can
 * change type while it is being edited — a note that grows a highlight, a
 * highlight that gets a comment. One shape, optional fields, one store.
 *
 * Marks never touch the document file. They live in IndexedDB keyed by
 * document, and only the export writes them into a PDF. That is what makes it
 * possible to annotate a read-only file, to undo a year later, and to export
 * the same document twice with and without markup.
 */

import { STORE, idbDelete, idbDeleteMany, idbGetAllByIndex, idbPut } from '@/lib/idb'
import { uid } from '@/lib/id'
import type { InkPath, Rect } from '@/lib/geometry'

export type MarkType =
  /** Coloured band behind text. */
  | 'highlight'
  /** Line under text. */
  | 'underline'
  /** Line through text. */
  | 'strike'
  /** A pin with a comment, anchored to a point. */
  | 'note'
  /** Freehand pen strokes. */
  | 'ink'
  /** A text box added on top of the page. */
  | 'text'
  /** Replaced page text: the original is covered, the new text drawn over it. */
  | 'replace'
  /** Page content painted over — used to delete text and to hide passages. */
  | 'redact'

export interface Mark {
  id: string
  docId: string
  type: MarkType
  color: string
  createdAt: number
  updatedAt: number

  /** Free comment. Any mark can carry one; a `note` is defined by it. */
  comment?: string

  /* — Placement in a paged document (PDF, image). Page is zero based. — */
  page?: number
  /** Highlight/underline/strike: one rectangle per line, normalised. */
  rects?: Rect[]
  /** note/text/replace/redact: the box the mark occupies, normalised. */
  box?: Rect
  /** ink: the strokes, normalised. */
  paths?: InkPath[]

  /* — Placement in a reflowable document (EPUB). — */
  /** Spine item the mark belongs to. */
  href?: string
  /** The marked text, plus context, so the mark survives re-flow and re-styling. */
  quote?: string
  prefix?: string
  suffix?: string

  /* — Content of text marks. — */
  text?: string
  /** Font size as a fraction of page height, so it scales with the page. */
  fontSize?: number
  /** Which of the standard PDF font families to draw with. */
  family?: 'serif' | 'sans' | 'mono'
  bold?: boolean
  align?: 'left' | 'center' | 'right'
  /** `replace` keeps what was there before, so the edit can be shown and undone. */
  original?: string
  /** `redact`/`replace`: the colour painted over the original, sampled from the page. */
  fill?: string
  /** Pen and text opacity, 0..1. Highlights default to 0.35, ink to 1. */
  opacity?: number
}

export const MARK_LABEL: Record<MarkType, string> = {
  highlight: 'Markierung',
  underline: 'Unterstrichen',
  strike: 'Durchgestrichen',
  note: 'Notiz',
  ink: 'Freihand',
  text: 'Textfeld',
  replace: 'Textänderung',
  redact: 'Abgedeckt',
}

/**
 * The highlighter palette. Five hues that stay legible over black text at 35 %
 * opacity and stay distinguishable from each other when printed in greyscale.
 */
export const HIGHLIGHT_COLORS = [
  { name: 'Gelb', value: '#ffd60a' },
  { name: 'Grün', value: '#34d399' },
  { name: 'Blau', value: '#60a5fa' },
  { name: 'Rosa', value: '#f472b6' },
  { name: 'Orange', value: '#fb923c' },
]

/** Pen and text colours are opaque, so they need more contrast than the bands. */
export const INK_COLORS = [
  { name: 'Rot', value: '#e11d48' },
  { name: 'Schwarz', value: '#111827' },
  { name: 'Blau', value: '#2563eb' },
  { name: 'Grün', value: '#059669' },
  { name: 'Weiß', value: '#ffffff' },
]

export function newMark(docId: string, type: MarkType, patch: Partial<Mark> = {}): Mark {
  const now = Date.now()
  return {
    id: uid('mk'),
    docId,
    type,
    color: type === 'highlight' ? HIGHLIGHT_COLORS[0].value : INK_COLORS[0].value,
    createdAt: now,
    updatedAt: now,
    ...patch,
  }
}

export function listMarks(docId: string): Promise<Mark[]> {
  return idbGetAllByIndex<Mark>(STORE.marks, 'docId', docId)
}

export function saveMark(mark: Mark): Promise<void> {
  mark.updatedAt = Date.now()
  return idbPut(STORE.marks, mark)
}

export function deleteMark(id: string): Promise<void> {
  return idbDelete(STORE.marks, id)
}

export async function deleteMarksOf(docId: string): Promise<number> {
  const marks = await listMarks(docId)
  await idbDeleteMany(STORE.marks, marks.map((mark) => mark.id))
  return marks.length
}

/** Sidebar order: by page, then top to bottom, then by age. */
export function compareMarks(a: Mark, b: Mark): number {
  const pageDiff = (a.page ?? 0) - (b.page ?? 0)
  if (pageDiff !== 0) return pageDiff

  const top = (mark: Mark) => mark.box?.y ?? mark.rects?.[0]?.y ?? mark.paths?.[0]?.points[1] ?? 0
  const topDiff = top(a) - top(b)
  if (Math.abs(topDiff) > 0.001) return topDiff

  return a.createdAt - b.createdAt
}

/** One-line preview for the sidebar. */
export function markSummary(mark: Mark): string {
  if (mark.type === 'replace') return mark.text || '(gelöscht)'
  if (mark.type === 'text') return mark.text || '(leeres Textfeld)'
  if (mark.quote) return mark.quote
  if (mark.comment) return mark.comment
  if (mark.type === 'ink') {
    const strokes = mark.paths?.length ?? 0
    return `${strokes} ${strokes === 1 ? 'Strich' : 'Striche'}`
  }
  if (mark.type === 'redact') return 'Abgedeckter Bereich'
  return MARK_LABEL[mark.type]
}

/* ===========================================================================
   Undo
   ======================================================================== */

type UndoStep =
  | { kind: 'create'; mark: Mark }
  | { kind: 'delete'; mark: Mark }
  | { kind: 'update'; before: Mark; after: Mark }

/**
 * Undo history for one reading session.
 *
 * Deliberately not persisted: an undo stack that outlives the session invites
 * undoing an edit whose context is long gone. What is persisted is the marks
 * themselves, and any of them can still be deleted individually.
 */
export class UndoStack {
  private readonly past: UndoStep[] = []
  private readonly future: UndoStep[] = []
  private readonly limit = 200

  constructor(private readonly onChange?: () => void) {}

  record(step: UndoStep): void {
    this.past.push(step)
    if (this.past.length > this.limit) this.past.shift()
    this.future.length = 0
    this.onChange?.()
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  clear(): void {
    this.past.length = 0
    this.future.length = 0
    this.onChange?.()
  }

  /** Applies the inverse of the last step and hands it to the caller to persist. */
  async undo(apply: (step: UndoStep, direction: 'undo' | 'redo') => Promise<void>): Promise<void> {
    const step = this.past.pop()
    if (!step) return
    await apply(step, 'undo')
    this.future.push(step)
    this.onChange?.()
  }

  async redo(apply: (step: UndoStep, direction: 'undo' | 'redo') => Promise<void>): Promise<void> {
    const step = this.future.pop()
    if (!step) return
    await apply(step, 'redo')
    this.past.push(step)
    this.onChange?.()
  }
}

export type { UndoStep }

/**
 * Turns an undo step into the storage operation that realises it.
 *
 * Kept separate from the stack so it can be unit tested without IndexedDB, and
 * so the reader has exactly one place where a mark change hits storage.
 */
export function invertStep(
  step: UndoStep,
  direction: 'undo' | 'redo',
): { action: 'put'; mark: Mark } | { action: 'delete'; id: string } {
  const undoing = direction === 'undo'

  switch (step.kind) {
    case 'create':
      return undoing ? { action: 'delete', id: step.mark.id } : { action: 'put', mark: step.mark }
    case 'delete':
      return undoing ? { action: 'put', mark: step.mark } : { action: 'delete', id: step.mark.id }
    case 'update':
      return { action: 'put', mark: undoing ? step.before : step.after }
  }
}
