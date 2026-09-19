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

/** Tools that work on text rather than on a gesture over open page area. */
export const TEXT_TOOLS: Tool[] = ['markieren', 'unterstreichen', 'durchstreichen']

/** Tools that draw on the page and therefore need the text layer out of the way. */
export const DRAW_TOOLS: Tool[] = ['stift', 'radierer', 'textfeld', 'abdecken', 'notiz']

/* ===========================================================================
   Groups
   ======================================================================== */

/**
 * The tool bar shows groups, not tools.
 *
 * Ten icon buttons plus a row of colours came to roughly 560 px, which on a
 * 360 px phone meant scrolling past the whole toolbar to reach the colour you
 * wanted to mark in. Five groups fit with room to spare, and the variants that
 * were crowding the bar — underline, strike-through, eraser — move one tap away
 * into the group's own panel, next to its colours.
 *
 * Which member a group activates is remembered, so someone who underlines
 * rather than highlights gets their tool back with a single tap.
 */
export type GroupId = 'lesen' | 'markieren' | 'stift' | 'notiz' | 'mehr'

export interface ToolGroup {
  id: GroupId
  label: string
  icon: string
  /** First entry is the default member. */
  members: Tool[]
}

const ALL_GROUPS: ToolGroup[] = [
  { id: 'lesen', label: 'Lesen', icon: 'text', members: ['lesen'] },
  {
    id: 'markieren',
    label: 'Markieren',
    icon: 'highlight',
    members: ['markieren', 'unterstreichen', 'durchstreichen'],
  },
  { id: 'stift', label: 'Stift', icon: 'pen', members: ['stift', 'radierer'] },
  { id: 'notiz', label: 'Notiz', icon: 'note', members: ['notiz'] },
  { id: 'mehr', label: 'Mehr', icon: 'edit', members: ['textfeld', 'bearbeiten', 'abdecken'] },
]

/** The groups that make sense for a document kind, with unusable members removed. */
export function groupsFor(kind: 'pdf' | 'image' | 'flow'): ToolGroup[] {
  const usable: Record<typeof kind, Tool[]> = {
    // A reflowable document has no page to draw on.
    flow: ['lesen', 'markieren', 'unterstreichen', 'durchstreichen'],
    // An image has no text to mark, and nothing to replace.
    image: ['lesen', 'notiz', 'stift', 'radierer', 'textfeld', 'abdecken'],
    pdf: [
      'lesen', 'markieren', 'unterstreichen', 'durchstreichen',
      'notiz', 'stift', 'radierer', 'textfeld', 'bearbeiten', 'abdecken',
    ],
  }

  const allowed = new Set(usable[kind])
  return ALL_GROUPS.map((group) => ({
    ...group,
    members: group.members.filter((member) => allowed.has(member)),
  })).filter((group) => group.members.length > 0)
}

export function groupOf(tool: Tool, groups: readonly ToolGroup[]): ToolGroup | undefined {
  return groups.find((group) => group.members.includes(tool))
}

export class ToolState {
  private tool: Tool = 'lesen'
  private readonly listeners = new Set<() => void>()
  /** Last member used per group, so a group button returns to it. */
  private readonly lastUsed = new Map<GroupId, Tool>()

  highlightColor = settings().highlightColor
  inkColor = settings().inkColor
  inkWidth = settings().inkWidth

  get current(): Tool {
    return this.tool
  }

  set(tool: Tool, group?: GroupId): void {
    if (group) this.lastUsed.set(group, tool)
    if (this.tool === tool) return
    this.tool = tool
    this.emit()
  }

  /** Tapping the active tool again returns to reading. */
  toggle(tool: Tool): void {
    this.set(this.tool === tool ? 'lesen' : tool)
  }

  /** The member a group button activates: the last one used, else the first. */
  memberOf(group: ToolGroup): Tool {
    const remembered = this.lastUsed.get(group.id)
    return remembered && group.members.includes(remembered) ? remembered : group.members[0]
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

  /** True while the tool marks text, which is what replaces native selection. */
  get isMarking(): boolean {
    return TEXT_TOOLS.includes(this.tool)
  }

  /** True while any tool has claimed the first finger. */
  get isActive(): boolean {
    return this.tool !== 'lesen'
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
