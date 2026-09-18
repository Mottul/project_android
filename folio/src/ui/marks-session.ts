/**
 * The marks of the document that is currently open.
 *
 * One place that owns them for the duration of a reading session: the in-memory
 * list everything renders from, the writes to IndexedDB, the undo stack, and
 * the notification that makes the page overlay and the sidebar redraw together.
 *
 * Every change goes through `add`, `update` or `remove`, which is what keeps
 * undo honest — there is no path that changes a mark without recording how to
 * get back.
 */

import {
  UndoStack,
  deleteMark,
  invertStep,
  listMarks,
  saveMark,
  type Mark,
  type UndoStep,
} from '@/store/marks'

export class MarksSession {
  private marks: Mark[] = []
  private readonly listeners = new Set<() => void>()
  readonly undo: UndoStack

  constructor(readonly docId: string) {
    this.undo = new UndoStack(() => this.emit())
  }

  async load(): Promise<void> {
    this.marks = await listMarks(this.docId)
    this.emit()
  }

  all(): readonly Mark[] {
    return this.marks
  }

  onPage(page: number): Mark[] {
    return this.marks.filter((mark) => mark.page === page)
  }

  inChapter(href: string): Mark[] {
    return this.marks.filter((mark) => mark.href === href)
  }

  get(id: string): Mark | undefined {
    return this.marks.find((mark) => mark.id === id)
  }

  get count(): number {
    return this.marks.length
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  /* — Changes ——————————————————————————————————————————————— */

  async add(mark: Mark): Promise<Mark> {
    this.marks.push(mark)
    await saveMark(mark)
    this.undo.record({ kind: 'create', mark: clone(mark) })
    this.emit()
    return mark
  }

  async update(id: string, patch: Partial<Mark>): Promise<Mark | null> {
    const index = this.marks.findIndex((mark) => mark.id === id)
    if (index < 0) return null

    const before = clone(this.marks[index])
    const after = { ...this.marks[index], ...patch, updatedAt: Date.now() }
    this.marks[index] = after

    await saveMark(after)
    this.undo.record({ kind: 'update', before, after: clone(after) })
    this.emit()
    return after
  }

  /**
   * Saves a mark that was changed in place, without recording an undo step.
   *
   * Used while something is being dragged or drawn: recording every
   * intermediate state would fill the undo stack with frames nobody wants to
   * step back through. The caller records one step when the gesture ends.
   */
  async persist(mark: Mark): Promise<void> {
    await saveMark(mark)
    this.emit()
  }

  async remove(id: string): Promise<void> {
    const index = this.marks.findIndex((mark) => mark.id === id)
    if (index < 0) return

    const [removed] = this.marks.splice(index, 1)
    await deleteMark(id)
    this.undo.record({ kind: 'delete', mark: clone(removed) })
    this.emit()
  }

  async removeAll(): Promise<number> {
    const count = this.marks.length
    for (const mark of [...this.marks]) await deleteMark(mark.id)
    this.marks = []
    this.undo.clear()
    this.emit()
    return count
  }

  /* — Undo ——————————————————————————————————————————————————— */

  stepBack(): Promise<void> {
    return this.undo.undo((step, direction) => this.apply(step, direction))
  }

  stepForward(): Promise<void> {
    return this.undo.redo((step, direction) => this.apply(step, direction))
  }

  private async apply(step: UndoStep, direction: 'undo' | 'redo'): Promise<void> {
    const operation = invertStep(step, direction)

    if (operation.action === 'delete') {
      const index = this.marks.findIndex((mark) => mark.id === operation.id)
      if (index >= 0) this.marks.splice(index, 1)
      await deleteMark(operation.id)
    } else {
      const index = this.marks.findIndex((mark) => mark.id === operation.mark.id)
      const restored = clone(operation.mark)
      if (index >= 0) this.marks[index] = restored
      else this.marks.push(restored)
      await saveMark(restored)
    }

    this.emit()
  }
}

/**
 * A deep-enough copy for the undo stack.
 *
 * `structuredClone` would be the obvious call, but a mark is plain data with
 * two levels of nesting and this is called on every change; spreading the two
 * arrays that matter is both faster and explicit about what is being copied.
 */
function clone(mark: Mark): Mark {
  return {
    ...mark,
    rects: mark.rects?.map((rect) => ({ ...rect })),
    box: mark.box ? { ...mark.box } : undefined,
    paths: mark.paths?.map((path) => ({ width: path.width, points: [...path.points] })),
  }
}
