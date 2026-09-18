/**
 * Which tool is active, and in which colour.
 *
 * Shared by the toolbar, the page overlays and the selection menu. Small enough
 * to be a plain observable object; the point is that there is exactly one of
 * it, so a colour picked in the toolbar is the colour the next stroke uses.
 */

import { settings, setSetting } from '@/store/settings'

export type Tool =
  /** Selecting text and following links — the default. */
  | 'lesen'
  | 'markieren'
  | 'unterstreichen'
  | 'durchstreichen'
  | 'notiz'
  | 'stift'
  | 'radierer'
  | 'textfeld'
  /** Replacing text that is already on the page. */
  | 'bearbeiten'
  /** Painting over page content. */
  | 'abdecken'

export const TOOL_LABEL: Record<Tool, string> = {
  lesen: 'Lesen',
  markieren: 'Markieren',
  unterstreichen: 'Unterstreichen',
  durchstreichen: 'Durchstreichen',
  notiz: 'Notiz',
  stift: 'Stift',
  radierer: 'Radierer',
  textfeld: 'Textfeld',
  bearbeiten: 'Text bearbeiten',
  abdecken: 'Abdecken',
}

export const TOOL_ICON: Record<Tool, string> = {
  lesen: 'text',
  markieren: 'highlight',
  unterstreichen: 'underline',
  durchstreichen: 'strike',
  notiz: 'note',
  stift: 'pen',
  radierer: 'eraser',
  textfeld: 'textbox',
  bearbeiten: 'edit',
  abdecken: 'redact',
}

/** Tools that work on a text selection rather than on a gesture over the page. */
export const TEXT_TOOLS: Tool[] = ['markieren', 'unterstreichen', 'durchstreichen']

/** Tools that draw on the page and therefore need the text layer out of the way. */
export const DRAW_TOOLS: Tool[] = ['stift', 'radierer', 'textfeld', 'abdecken', 'notiz']

export class ToolState {
  private tool: Tool = 'lesen'
  private readonly listeners = new Set<() => void>()

  highlightColor = settings().highlightColor
  inkColor = settings().inkColor
  inkWidth = settings().inkWidth

  get current(): Tool {
    return this.tool
  }

  set(tool: Tool): void {
    if (this.tool === tool) return
    this.tool = tool
    this.emit()
  }

  /** Tapping the active tool again returns to reading. */
  toggle(tool: Tool): void {
    this.set(this.tool === tool ? 'lesen' : tool)
  }

  setHighlightColor(color: string): void {
    this.highlightColor = color
    setSetting('highlightColor', color)
    this.emit()
  }

  setInkColor(color: string): void {
    this.inkColor = color
    setSetting('inkColor', color)
    this.emit()
  }

  setInkWidth(width: number): void {
    this.inkWidth = width
    setSetting('inkWidth', width)
    this.emit()
  }

  /** The colour the active tool would use. */
  get color(): string {
    return TEXT_TOOLS.includes(this.tool) ? this.highlightColor : this.inkColor
  }

  get isDrawing(): boolean {
    return DRAW_TOOLS.includes(this.tool)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
