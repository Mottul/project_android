/**
 * The reader: everything around the document.
 *
 * Title bar, tool bar, sidebar and keyboard handling live here; the document
 * itself is one of four viewers behind a common interface. The split is worth
 * it because the chrome is identical for a scanned invoice and a novel, while
 * the machinery underneath has nothing in common at all.
 */

import { clear, h, on } from '@/lib/dom'
import { debounce } from '@/lib/dom'
import { displayTitle, loadDocFile, type DocEntry } from '@/store/library'
import { MARK_LABEL, compareMarks, markSummary, HIGHLIGHT_COLORS, INK_COLORS } from '@/store/marks'
import { settings, setSetting } from '@/store/settings'
import type { OutlineEntry } from '@/pdf/loader'
import { MarksSession } from './marks-session'
import { ToolState, TOOL_ICON, TOOL_LABEL, type Tool } from './tools'
import { PdfViewer } from './pdf-viewer'
import { EpubViewer } from './epub-viewer'
import { ImageViewer, TextViewer } from './simple-viewers'
import type { SearchHit, Viewer, ViewerHost } from './viewer'
import { icon } from './icons'
import { confirmDestructive, openDialog, toast } from './feedback'
import { openSettings } from './settings-panel'
import { openMarkEditor } from './mark-editor'
import { explainAccessError } from './import'

export interface ReaderCallbacks {
  onClose(): void
  onEntryChanged(patch: Partial<DocEntry>): void
}

type RailTab = 'seiten' | 'inhalt' | 'notizen' | 'suche'

export class ReaderView implements ViewerHost {
  readonly element: HTMLElement
  readonly session: MarksSession
  readonly tools = new ToolState()

  file!: File
  private viewer: Viewer | null = null
  private outline: OutlineEntry[] = []
  private railTab: RailTab = 'seiten'
  private railOpen = window.innerWidth > 860
  private disposers: (() => void)[] = []
  private wakeLock: { release(): Promise<void> } | null = null

  private readonly nameLabel: HTMLElement
  private readonly positionLabel: HTMLElement
  private readonly toolBar: HTMLElement
  private readonly rail: HTMLElement
  private readonly railBody: HTMLElement
  private readonly railTabs: HTMLElement
  private readonly main: HTMLElement
  private readonly undoButton: HTMLElement
  private readonly redoButton: HTMLElement
  private scrim: HTMLElement | null = null

  constructor(
    readonly entry: DocEntry,
    private readonly callbacks: ReaderCallbacks,
  ) {
    this.session = new MarksSession(entry.id)

    this.nameLabel = h('span.doc-name', {}, displayTitle(entry))
    this.positionLabel = h('span', { style: 'font-size:0.82rem;color:var(--text-faint);white-space:nowrap' })
    this.toolBar = h('div.tool-bar')
    this.railBody = h('div.rail-body')
    this.railTabs = h('div.rail-tabs')
    this.rail = h('aside.rail', {}, this.railTabs, this.railBody)
    this.main = h('div.reader-main', {}, this.rail)

    this.undoButton = h('button.icon-button', {
      type: 'button',
      title: 'Rückgängig',
      'aria-label': 'Rückgängig',
      html: icon('undo'),
      onclick: () => void this.session.stepBack(),
    })
    this.redoButton = h('button.icon-button', {
      type: 'button',
      title: 'Wiederholen',
      'aria-label': 'Wiederholen',
      html: icon('redo'),
      onclick: () => void this.session.stepForward(),
    })

    this.element = h('div.reader', {}, this.buildTopBar(), this.toolBar, this.main)
    this.renderRailTabs()
    this.applyRailState()
  }

  /* ========================================================================
     Loading
     ===================================================================== */

  async load(): Promise<void> {
    try {
      this.file = await loadDocFile(this.entry)
    } catch (error) {
      explainAccessError(error)
      this.callbacks.onClose()
      return
    }

    await this.session.load()
    this.disposers.push(
      this.session.subscribe(() => {
        this.viewer?.marksChanged()
        this.updateUndoButtons()
        this.callbacks.onEntryChanged({ markCount: this.session.count })
        if (this.railTab === 'notizen') this.renderRail()
      }),
    )
    this.disposers.push(
      this.tools.subscribe(() => {
        this.renderToolBar()
        this.viewer?.toolsChanged()
      }),
    )

    this.viewer = this.createViewer()
    this.main.appendChild(this.viewer.element)
    this.renderToolBar()

    try {
      await this.viewer.load()
    } catch (error) {
      clear(this.viewer.element)
      this.viewer.element.appendChild(
        h(
          'div.busy',
          {},
          h('span', { html: icon('warn', 28) }),
          h('p', {}, (error as Error).message || 'Das Dokument konnte nicht geöffnet werden.'),
          h('button.button', { type: 'button', onclick: () => this.callbacks.onClose() }, 'Zurück zur Bibliothek'),
        ),
      )
      return
    }

    if (this.entry.location) this.viewer.restore(this.entry.location)
    this.callbacks.onEntryChanged({ openedAt: Date.now() })

    this.renderRail()
    this.bindKeys()
    void this.keepAwake()
  }

  private createViewer(): Viewer {
    switch (this.entry.kind) {
      case 'pdf':
        return new PdfViewer(this)
      case 'epub':
        return new EpubViewer(this)
      case 'image':
        return new ImageViewer(this)
      default:
        return new TextViewer(this)
    }
  }

  destroy(): void {
    for (const dispose of this.disposers) dispose()
    this.disposers = []
    this.viewer?.destroy()
    this.viewer = null
    void this.wakeLock?.release().catch(() => undefined)
    this.wakeLock = null
  }

  /* ========================================================================
     ViewerHost
     ===================================================================== */

  setOutline(entries: OutlineEntry[]): void {
    this.outline = entries
    if (this.railTab === 'inhalt') this.renderRail()
    this.renderRailTabs()
  }

  setPosition(current: number, total: number, label?: string): void {
    this.positionLabel.textContent = label ? `${label} · ${current}/${total}` : `${current} / ${total}`
  }

  private readonly persistProgress = debounce((progress: number, location: string) => {
    this.callbacks.onEntryChanged({ progress, location })
  }, 700)

  saveProgress(progress: number, location: string): void {
    this.persistProgress(progress, location)
  }

  setMeta(patch: Partial<DocEntry>): void {
    this.callbacks.onEntryChanged(patch)
    if (patch.title) this.nameLabel.textContent = patch.title
  }

  /* ========================================================================
     Chrome
     ===================================================================== */

  private buildTopBar(): HTMLElement {
    return h(
      'header.reader-bar',
      {},
      h('button.icon-button', {
        type: 'button',
        title: 'Zurück zur Bibliothek',
        'aria-label': 'Zurück zur Bibliothek',
        html: icon('back'),
        onclick: () => this.callbacks.onClose(),
      }),
      h('button.icon-button', {
        type: 'button',
        title: 'Seitenleiste',
        'aria-label': 'Seitenleiste',
        html: icon('sidebar'),
        onclick: () => this.toggleRail(),
      }),
      this.nameLabel,
      this.positionLabel,
      h(
        'div.group',
        {},
        this.undoButton,
        this.redoButton,
        h('button.icon-button', {
          type: 'button',
          title: 'Verkleinern',
          'aria-label': 'Verkleinern',
          html: icon('zoomOut'),
          onclick: () => this.viewer?.zoomOut(),
        }),
        h('button.icon-button', {
          type: 'button',
          title: 'Vergrößern',
          'aria-label': 'Vergrößern',
          html: icon('zoomIn'),
          onclick: () => this.viewer?.zoomIn(),
        }),
        h('button.icon-button', {
          type: 'button',
          title: 'Exportieren und speichern',
          'aria-label': 'Exportieren und speichern',
          html: icon('download'),
          onclick: () => void this.viewer?.exportDocument(),
        }),
        h('button.icon-button', {
          type: 'button',
          title: 'Einstellungen',
          'aria-label': 'Einstellungen',
          html: icon('settings'),
          onclick: () => void this.openReaderSettings(),
        }),
      ),
    )
  }

  /**
   * The tool bar is rebuilt whenever the tool changes.
   *
   * It is a dozen buttons and a few swatches; rebuilding is simpler than
   * tracking which of them need their pressed state updated, and at this size
   * the difference is not measurable.
   */
  private renderToolBar(): void {
    clear(this.toolBar)

    const available: Tool[] =
      this.entry.kind === 'pdf'
        ? ['lesen', 'markieren', 'unterstreichen', 'durchstreichen', 'notiz', 'stift', 'radierer', 'textfeld', 'bearbeiten', 'abdecken']
        : this.entry.kind === 'image'
          ? ['lesen', 'notiz', 'stift', 'radierer', 'textfeld', 'abdecken']
          : ['lesen', 'markieren', 'unterstreichen', 'durchstreichen']

    for (const tool of available) {
      if (tool === 'stift') this.toolBar.appendChild(h('span.divider'))
      this.toolBar.appendChild(
        h('button.icon-button', {
          type: 'button',
          title: TOOL_LABEL[tool],
          'aria-label': TOOL_LABEL[tool],
          'aria-pressed': String(this.tools.current === tool),
          html: icon(TOOL_ICON[tool]),
          onclick: () => this.tools.toggle(tool),
        }),
      )
    }

    const tool = this.tools.current
    if (tool === 'lesen') return

    this.toolBar.appendChild(h('span.divider'))

    const usesHighlightPalette = ['markieren', 'unterstreichen', 'durchstreichen'].includes(tool)
    if (tool !== 'radierer' && tool !== 'abdecken') {
      const palette = usesHighlightPalette ? HIGHLIGHT_COLORS : INK_COLORS
      const active = usesHighlightPalette ? this.tools.highlightColor : this.tools.inkColor
      const swatches = h('div.swatches')

      for (const entry of palette) {
        swatches.appendChild(
          h('button.swatch', {
            type: 'button',
            title: entry.name,
            'aria-label': entry.name,
            'aria-pressed': String(entry.value === active),
            style: `background:${entry.value}`,
            onclick: () =>
              usesHighlightPalette
                ? this.tools.setHighlightColor(entry.value)
                : this.tools.setInkColor(entry.value),
          }),
        )
      }
      this.toolBar.appendChild(swatches)
    }

    if (tool === 'stift' || tool === 'radierer') {
      this.toolBar.appendChild(
        h('input.slider', {
          type: 'range',
          min: '0.001',
          max: '0.012',
          step: '0.0005',
          value: String(this.tools.inkWidth),
          style: 'width:110px;flex:none',
          title: 'Strichstärke',
          'aria-label': 'Strichstärke',
          oninput: (event: Event) =>
            this.tools.setInkWidth(Number((event.target as HTMLInputElement).value)),
        }),
      )
    }
  }

  private updateUndoButtons(): void {
    this.undoButton.toggleAttribute('disabled', !this.session.undo.canUndo)
    this.redoButton.toggleAttribute('disabled', !this.session.undo.canRedo)
  }

  /* ========================================================================
     Sidebar
     ===================================================================== */

  private toggleRail(): void {
    this.railOpen = !this.railOpen
    this.applyRailState()
    if (this.railOpen) this.renderRail()
  }

  private applyRailState(): void {
    this.rail.classList.toggle('is-open', this.railOpen)
    this.rail.classList.toggle('is-closed', !this.railOpen)

    this.scrim?.remove()
    this.scrim = null

    if (this.railOpen && window.innerWidth <= 860) {
      this.scrim = h('button.rail-scrim', {
        type: 'button',
        'aria-label': 'Seitenleiste schließen',
        onclick: () => this.toggleRail(),
      })
      this.main.appendChild(this.scrim)
    }
  }

  private renderRailTabs(): void {
    clear(this.railTabs)

    const tabs: [RailTab, string][] = []
    if (this.viewer?.renderThumbnails || this.entry.kind === 'pdf') tabs.push(['seiten', 'Seiten'])
    if (this.outline.length) tabs.push(['inhalt', 'Inhalt'])
    tabs.push(['notizen', 'Notizen'])
    tabs.push(['suche', 'Suche'])

    for (const [key, label] of tabs) {
      this.railTabs.appendChild(
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            'aria-selected': String(this.railTab === key),
            onclick: () => {
              this.railTab = key
              this.renderRailTabs()
              this.renderRail()
            },
          },
          label,
        ),
      )
    }

    // A tab that no longer exists would leave the sidebar blank.
    if (!tabs.some(([key]) => key === this.railTab)) {
      this.railTab = tabs[0]?.[0] ?? 'notizen'
    }
  }

  private renderRail(): void {
    if (!this.railOpen) return
    clear(this.railBody)

    switch (this.railTab) {
      case 'seiten':
        this.viewer?.renderThumbnails?.(this.railBody, (index) => {
          this.viewer?.goTo(index)
          if (window.innerWidth <= 860) this.toggleRail()
        })
        break
      case 'inhalt':
        this.renderOutline()
        break
      case 'notizen':
        this.renderMarks()
        break
      case 'suche':
        this.renderSearch()
        break
    }
  }

  private renderOutline(): void {
    const list = h('div.outline-list')

    const walk = (entries: OutlineEntry[], depth: number) => {
      for (const entry of entries) {
        list.appendChild(
          h(
            'button.outline-item',
            {
              type: 'button',
              style: `padding-left:${8 + depth * 13}px`,
              onclick: () => {
                if (entry.page !== undefined && entry.page >= 0) this.viewer?.goTo(entry.page)
                else if (entry.url) window.open(entry.url, '_blank', 'noreferrer')
                if (window.innerWidth <= 860) this.toggleRail()
              },
            },
            entry.title,
          ),
        )
        if (entry.children.length) walk(entry.children, depth + 1)
      }
    }

    walk(this.outline, 0)
    this.railBody.appendChild(list)
  }

  private renderMarks(): void {
    const marks = [...this.session.all()].sort(compareMarks)

    if (!marks.length) {
      this.railBody.appendChild(
        h('p', { style: 'color:var(--text-faint);font-size:0.86rem;padding:8px' },
          'Noch keine Notizen. Text auswählen oder ein Werkzeug in der Leiste oben wählen.'),
      )
      return
    }

    const header = h(
      'div',
      { style: 'display:flex;align-items:center;gap:8px;margin-bottom:9px' },
      h('span', { style: 'font-size:0.8rem;color:var(--text-faint);flex:1' },
        `${marks.length} ${marks.length === 1 ? 'Eintrag' : 'Einträge'}`),
      h('button.icon-button', {
        type: 'button',
        title: 'Alle Notizen löschen',
        'aria-label': 'Alle Notizen löschen',
        html: icon('trash', 17),
        onclick: async () => {
          const sure = await confirmDestructive(
            'Alle Notizen löschen?',
            `${marks.length} Markierungen und Kommentare dieses Dokuments werden gelöscht.`,
            'Löschen',
          )
          if (!sure) return
          const removed = await this.session.removeAll()
          toast(`${removed} Notizen gelöscht.`, { kind: 'ok' })
        },
      }),
    )
    this.railBody.appendChild(header)

    const list = h('div.mark-list')
    for (const mark of marks) {
      list.appendChild(
        h(
          'button.mark-item',
          {
            type: 'button',
            onclick: () => {
              if (mark.page !== undefined) this.viewer?.goTo(mark.page)
              else if (mark.href) {
                const index = this.viewer?.chapterIndexOf?.(mark.href) ?? -1
                if (index >= 0) this.viewer?.goTo(index)
              }
              void openMarkEditor(mark, this.session)
            },
          },
          h(
            'span.head',
            {},
            h('span.dot', { style: `background:${mark.color}` }),
            MARK_LABEL[mark.type],
            mark.page !== undefined ? h('span', {}, `· S. ${mark.page + 1}`) : null,
          ),
          h('span.quote', {}, markSummary(mark)),
          mark.comment ? h('span.comment', {}, mark.comment) : null,
        ),
      )
    }
    this.railBody.appendChild(list)
  }

  private renderSearch(): void {
    if (!this.viewer?.search) {
      this.railBody.appendChild(
        h('p', { style: 'color:var(--text-faint);font-size:0.86rem;padding:8px' },
          'In diesem Dokument kann nicht gesucht werden.'),
      )
      return
    }

    const results = h('div.mark-list', { style: 'margin-top:10px' })
    const status = h('p', { style: 'color:var(--text-faint);font-size:0.8rem;margin:8px 0 0' })

    const field = h('input.field', {
      type: 'search',
      placeholder: 'Im Dokument suchen …',
      'aria-label': 'Im Dokument suchen',
      oninput: debounce(async (event: Event) => {
        const query = (event.target as HTMLInputElement).value
        clear(results)

        if (query.trim().length < 2) {
          status.textContent = ''
          return
        }

        status.textContent = 'wird gesucht …'
        const hits = await (this.viewer?.search?.(query) ?? Promise.resolve([] as SearchHit[]))
        status.textContent = hits.length
          ? `${hits.length} ${hits.length === 1 ? 'Treffer' : 'Treffer'}`
          : 'Keine Treffer'

        for (const hit of hits.slice(0, 200)) {
          results.appendChild(
            h(
              'button.mark-item',
              {
                type: 'button',
                onclick: () => {
                  this.viewer?.showHit?.(hit)
                  if (window.innerWidth <= 860) this.toggleRail()
                },
              },
              h('span.head', {}, this.entry.kind === 'epub' ? `Kapitel ${hit.index + 1}` : `Seite ${hit.index + 1}`),
              h('span.quote', {}, hit.excerpt),
            ),
          )
        }
      }, 320),
    })

    this.railBody.appendChild(field)
    this.railBody.appendChild(status)
    this.railBody.appendChild(results)
    ;(field as HTMLInputElement).focus()
  }

  /* ========================================================================
     Settings, keys, wake lock
     ===================================================================== */

  private async openReaderSettings(): Promise<void> {
    const body = h('div', { style: 'display:grid;gap:18px' })
    openDialog({ title: 'Ansicht', body, acknowledge: true, confirmLabel: 'Schließen' })

    if (this.entry.kind === 'pdf') {
      const group = h('div.settings-group')
      group.appendChild(h('h3', {}, 'Zoom'))
      group.appendChild(
        h(
          'div',
          { style: 'display:flex;gap:7px;flex-wrap:wrap' },
          ...(['breite', 'seite', 1, 1.5, 2] as const).map((value) =>
            h(
              'button.chip',
              {
                type: 'button',
                'aria-pressed': String(settings().zoom === value),
                onclick: () => {
                  setSetting('zoom', value)
                  this.viewer?.setZoom?.(value)
                },
              },
              value === 'breite' ? 'Breite' : value === 'seite' ? 'Ganze Seite' : `${value * 100} %`,
            ),
          ),
        ),
      )
      body.appendChild(group)
    }

    if (this.entry.kind === 'epub' || this.entry.kind === 'text') {
      const group = h('div.settings-group')
      group.appendChild(h('h3', {}, 'Text'))
      group.appendChild(
        h(
          'div.settings-row',
          {},
          h('span', {}, 'Zeilenabstand'),
          h('input.slider', {
            type: 'range',
            min: '1.2',
            max: '2.2',
            step: '0.1',
            value: String(settings().lineHeight),
            style: 'width:150px',
            oninput: (event: Event) => {
              setSetting('lineHeight', Number((event.target as HTMLInputElement).value))
              this.viewer?.applySettings?.()
            },
          }),
        ),
      )
      body.appendChild(group)
    }

    body.appendChild(await openSettings())
  }

  private bindKeys(): void {
    this.disposers.push(
      on(window, 'keydown', (event) => {
        const key = event as KeyboardEvent
        const target = key.target as HTMLElement | null
        // Never steal a key from a field someone is typing in.
        if (target && /^(input|textarea|select)$/i.test(target.tagName)) return
        if (target?.isContentEditable) return

        const modified = key.metaKey || key.ctrlKey

        if (modified && key.key.toLowerCase() === 'z') {
          event.preventDefault()
          void (key.shiftKey ? this.session.stepForward() : this.session.stepBack())
          return
        }
        if (modified && key.key.toLowerCase() === 'f') {
          event.preventDefault()
          this.railTab = 'suche'
          this.railOpen = true
          this.applyRailState()
          this.renderRailTabs()
          this.renderRail()
          return
        }
        if (modified && key.key.toLowerCase() === 's') {
          event.preventDefault()
          void this.viewer?.exportDocument()
          return
        }

        switch (key.key) {
          case 'Escape':
            this.tools.set('lesen')
            break
          case '+':
          case '=':
            this.viewer?.zoomIn()
            break
          case '-':
            this.viewer?.zoomOut()
            break
        }
      }),
    )
  }

  /**
   * Keeps the screen on while reading, if that was asked for.
   *
   * The lock is dropped by the browser whenever the tab is hidden, so it has to
   * be taken again on every return — otherwise it silently stops working after
   * the first switch to another app.
   */
  private async keepAwake(): Promise<void> {
    if (!settings().keepAwake) return
    const request = async () => {
      try {
        this.wakeLock = await navigator.wakeLock?.request('screen')
      } catch {
        /* Denied, or unsupported. Not worth a message. */
      }
    }
    await request()
    this.disposers.push(
      on(document, 'visibilitychange', () => {
        if (document.visibilityState === 'visible' && settings().keepAwake) void request()
      }),
    )
  }
}
