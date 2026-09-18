/**
 * What the reader expects from a viewer, and what it offers in return.
 *
 * Four document kinds are displayed by four very different mechanisms — a
 * canvas per page, a reflowed chapter, a single image, a block of text — but
 * the chrome around them is the same: a title bar, a sidebar, a tool bar, an
 * export dialog. This interface is the seam between the two.
 */

import type { DocEntry } from '@/store/library'
import type { OutlineEntry } from '@/pdf/loader'
import type { MarksSession } from './marks-session'
import type { ToolState } from './tools'

export interface ViewerHost {
  readonly entry: DocEntry
  readonly file: File
  readonly session: MarksSession
  readonly tools: ToolState

  /** Reports the table of contents once the document has been parsed. */
  setOutline(entries: OutlineEntry[]): void
  /** Current position, for the page field in the toolbar. */
  setPosition(current: number, total: number, label?: string): void
  /** Remembers where the reader got to. */
  saveProgress(progress: number, location: string): void
  /** Metadata discovered while opening, written back to the library entry. */
  setMeta(patch: Partial<DocEntry>): void
}

export interface Viewer {
  readonly element: HTMLElement

  load(): Promise<void>
  destroy(): void

  /** Jumps to a page index (paged) or a spine index (reflowable). */
  goTo(index: number): void
  /** Jumps to a stored location string, as produced by `saveProgress`. */
  restore(location: string): void

  /** Total number of pages or chapters. */
  readonly count: number

  zoomIn(): void
  zoomOut(): void
  /** Jumps to an exact zoom level. Only paged viewers have one. */
  setZoom?(value: number | 'breite' | 'seite'): void
  /** Re-reads the display settings — font size, line height, theme. */
  applySettings?(): void
  /** Maps a reflowable mark's anchor back to a chapter index. */
  chapterIndexOf?(href: string): number
  /** Called when the tool changed, so the viewer can adjust its layers. */
  toolsChanged(): void
  /** Called when the marks changed, so overlays redraw. */
  marksChanged(): void

  /** Fills the sidebar's thumbnail tab. Optional: only paged viewers have one. */
  renderThumbnails?(container: HTMLElement, onPick: (index: number) => void): void
  /** Opens the export dialog for this kind of document. */
  exportDocument(): Promise<void>
  /** Saves over the original file where the platform allows it. */
  saveInPlace?(): Promise<void>
  /** Full-text search. */
  search?(query: string): Promise<SearchHit[]>
  showHit?(hit: SearchHit): void
}

export interface SearchHit {
  /** Page or chapter index. */
  index: number
  /** The matching line, for the result list. */
  excerpt: string
  /** Character offset of the match inside the page or chapter text. */
  offset: number
}
