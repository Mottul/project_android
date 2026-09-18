/**
 * The library.
 *
 * A flat, searchable list of everything Folio has been shown, with the filters
 * that turn it into something usable once it holds a few hundred documents:
 * kind, folder, "has notes", "started but not finished".
 *
 * The whole index is held in memory and filtered there — see store/query.ts for
 * why — so typing in the search box is instant and no state has to be kept in
 * sync with a database cursor.
 */

import { clear, debounce, h } from '@/lib/dom'
import { formatBytes, formatWhen } from '@/lib/format'
import { KIND_LABEL, type DocKind } from '@/lib/kinds'
import { listSources, removeDoc, removeSource, getThumb, displayTitle, type DocEntry, type LibrarySource } from '@/store/library'
import { settings, setSetting } from '@/store/settings'
import {
  EMPTY_FILTER,
  countByKind,
  selectDocs,
  type LibraryFilter,
  type SortKey,
} from '@/store/query'
import { icon } from './icons'
import { confirmDestructive, openDialog, toast } from './feedback'
import { Enricher, addFolder, pickAndImportFiles, rescanFolder } from './import'
import { openSettings } from './settings-panel'

export interface LibraryCallbacks {
  onOpen(entry: DocEntry): void
  onChanged(): void
}

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Zuletzt gelesen',
  added: 'Zuletzt hinzugefügt',
  name: 'Name',
  size: 'Größe',
  pages: 'Seitenzahl',
}

const KIND_ICON: Record<DocKind, string> = {
  pdf: 'file',
  epub: 'book',
  image: 'image',
  text: 'text',
  other: 'file',
}

export class LibraryView {
  readonly element: HTMLElement

  private docs: DocEntry[] = []
  private sources: LibrarySource[] = []
  private filter: LibraryFilter = { ...EMPTY_FILTER }
  private sort: SortKey = (settings().librarySort as SortKey) ?? 'recent'
  private view: 'raster' | 'liste' = settings().libraryView

  private readonly searchInput: HTMLInputElement
  private readonly filterBar: HTMLElement
  private readonly body: HTMLElement
  private readonly enricher: Enricher

  /** Object URLs of the covers currently on screen, revoked on every redraw. */
  private coverUrls: string[] = []
  /**
   * Which redraw is current.
   *
   * Covers are read asynchronously, so a cover can arrive after the list it was
   * meant for has already been replaced. The generation it was started in is
   * how that is recognised — checking whether the element is still in the
   * document is not enough, because the whole library is detached while the
   * reader is open and every cover would then be discarded.
   */
  private generation = 0

  constructor(private readonly callbacks: LibraryCallbacks) {
    this.searchInput = h('input.field', {
      type: 'search',
      placeholder: 'Suchen …',
      'aria-label': 'Bibliothek durchsuchen',
      oninput: debounce(() => {
        this.filter = { ...this.filter, search: this.searchInput.value }
        this.renderBody()
      }, 140),
    }) as HTMLInputElement

    this.filterBar = h('div.filter-bar')
    this.body = h('div.library-body')

    this.element = h(
      'div.library',
      {},
      this.buildTopBar(),
      this.filterBar,
      this.body,
    )

    this.enricher = new Enricher((entry) => this.replaceEntry(entry))
    void this.loadSources()
  }

  /** Called when the library comes back on screen after the reader. */
  show(): void {
    this.renderBody()
    this.focusSearch()
  }

  focusSearch(): void {
    // Only on a pointer device: raising the on-screen keyboard on arrival would
    // cover half the library.
    if (window.matchMedia('(hover: hover)').matches) this.searchInput.focus()
  }

  setDocs(docs: DocEntry[]): void {
    this.docs = docs
    this.renderFilters()
    this.renderBody()
    void this.enricher.enqueuePending()
  }

  private replaceEntry(entry: DocEntry): void {
    const index = this.docs.findIndex((doc) => doc.id === entry.id)
    if (index >= 0) this.docs[index] = entry
    else this.docs.push(entry)
    this.renderBody()
  }

  private async loadSources(): Promise<void> {
    this.sources = await listSources()
    this.renderFilters()
  }

  /* — Chrome ———————————————————————————————————————————————— */

  private buildTopBar(): HTMLElement {
    return h(
      'header.top-bar',
      {},
      h('span.title', {}, 'Folio'),
      h(
        'div.search-box',
        {},
        h('span', { html: icon('search', 17) }),
        this.searchInput,
      ),
      h('span.spacer'),
      h('button.icon-button', {
        type: 'button',
        title: 'Ordner hinzufügen',
        'aria-label': 'Ordner hinzufügen',
        html: icon('folderPlus'),
        onclick: () => void this.addFolder(),
      }),
      h('button.icon-button', {
        type: 'button',
        title: 'Dateien hinzufügen',
        'aria-label': 'Dateien hinzufügen',
        html: icon('filePlus'),
        onclick: () => void this.addFiles(),
      }),
      h('button.icon-button', {
        type: 'button',
        title: this.view === 'raster' ? 'Als Liste zeigen' : 'Als Raster zeigen',
        'aria-label': 'Ansicht wechseln',
        html: icon(this.view === 'raster' ? 'list' : 'grid'),
        onclick: (event) => this.toggleView(event.currentTarget as HTMLElement),
      }),
      h('button.icon-button', {
        type: 'button',
        title: 'Quellen und Einstellungen',
        'aria-label': 'Quellen und Einstellungen',
        html: icon('settings'),
        onclick: () => void this.openManage(),
      }),
    )
  }

  private toggleView(button: HTMLElement): void {
    this.view = this.view === 'raster' ? 'liste' : 'raster'
    setSetting('libraryView', this.view)
    button.innerHTML = icon(this.view === 'raster' ? 'list' : 'grid')
    button.title = this.view === 'raster' ? 'Als Liste zeigen' : 'Als Raster zeigen'
    this.renderBody()
  }

  private renderFilters(): void {
    clear(this.filterBar)

    const counts = countByKind(this.docs)
    const kinds = (['pdf', 'epub', 'image', 'text', 'other'] as DocKind[]).filter(
      (kind) => counts[kind],
    )

    const chip = (label: string, pressed: boolean, onClick: () => void, count?: number) =>
      h(
        'button.chip',
        { type: 'button', 'aria-pressed': String(pressed), onclick: onClick },
        label,
        count !== undefined ? h('span.count', {}, String(count)) : null,
      )

    this.filterBar.appendChild(
      chip('Alle', this.filter.kinds.length === 0, () => {
        this.filter = { ...this.filter, kinds: [] }
        this.renderFilters()
        this.renderBody()
      }, this.docs.length),
    )

    for (const kind of kinds) {
      this.filterBar.appendChild(
        chip(KIND_LABEL[kind], this.filter.kinds.includes(kind), () => {
          const active = this.filter.kinds.includes(kind)
          this.filter = { ...this.filter, kinds: active ? [] : [kind] }
          this.renderFilters()
          this.renderBody()
        }, counts[kind]),
      )
    }

    this.filterBar.appendChild(h('span', { style: 'width:6px' }))

    this.filterBar.appendChild(
      chip('Mit Notizen', this.filter.onlyAnnotated, () => {
        this.filter = { ...this.filter, onlyAnnotated: !this.filter.onlyAnnotated }
        this.renderFilters()
        this.renderBody()
      }),
    )
    this.filterBar.appendChild(
      chip('Angefangen', this.filter.onlyUnfinished, () => {
        this.filter = { ...this.filter, onlyUnfinished: !this.filter.onlyUnfinished }
        this.renderFilters()
        this.renderBody()
      }),
    )

    if (this.sources.length > 1) {
      for (const source of this.sources) {
        this.filterBar.appendChild(
          chip(source.name, this.filter.sourceId === source.id, () => {
            this.filter = {
              ...this.filter,
              sourceId: this.filter.sourceId === source.id ? null : source.id,
              folder: null,
            }
            this.renderFilters()
            this.renderBody()
          }),
        )
      }
    }

    this.filterBar.appendChild(
      h(
        'button.chip',
        { type: 'button', onclick: () => this.openSort() },
        SORT_LABELS[this.sort],
        h('span', { html: icon('down', 14) }),
      ),
    )
  }

  private openSort(): void {
    const body = h('div.settings-group')
    const { close } = openDialog({ title: 'Sortieren nach', body, acknowledge: true, confirmLabel: 'Schließen' })

    for (const [key, label] of Object.entries(SORT_LABELS)) {
      body.appendChild(
        h(
          'button.button',
          {
            type: 'button',
            style: 'justify-content:flex-start',
            onclick: () => {
              this.sort = key as SortKey
              setSetting('librarySort', key)
              this.renderFilters()
              this.renderBody()
              close(true)
            },
          },
          h('span', { html: icon(this.sort === key ? 'check' : 'page', 16) }),
          label,
        ),
      )
    }
  }

  /* — The list ——————————————————————————————————————————————— */

  private renderBody(): void {
    const token = ++this.generation
    for (const url of this.coverUrls) URL.revokeObjectURL(url)
    this.coverUrls = []

    clear(this.body)
    this.body.classList.toggle('is-empty', this.docs.length === 0)

    if (!this.docs.length) {
      this.body.appendChild(this.buildWelcome())
      return
    }

    const visible = selectDocs(this.docs, this.filter, this.sort)
    if (!visible.length) {
      this.body.classList.add('is-empty')
      this.body.appendChild(
        h(
          'div.empty',
          {},
          h('h2', {}, 'Nichts gefunden'),
          h('p', {}, 'Andere Suchbegriffe oder Filter probieren.'),
          h('button.button', { type: 'button', onclick: () => this.resetFilters() }, 'Filter zurücksetzen'),
        ),
      )
      return
    }

    const container = h(this.view === 'raster' ? 'div.doc-grid' : 'div.doc-list')
    for (const entry of visible) {
      container.appendChild(
        this.view === 'raster' ? this.buildCard(entry, token) : this.buildRow(entry),
      )
    }
    this.body.appendChild(container)
  }

  private resetFilters(): void {
    this.filter = { ...EMPTY_FILTER }
    this.searchInput.value = ''
    this.renderFilters()
    this.renderBody()
  }

  private buildWelcome(): HTMLElement {
    return h(
      'div.empty',
      {},
      h('span', { html: icon('library', 34) }),
      h('h2', {}, 'Noch keine Dokumente'),
      h(
        'p',
        {},
        'Einen Ordner auswählen — Folio durchsucht ihn samt Unterordnern nach PDFs, ' +
          'EPUBs, Bildern und Textdateien. Es wird nichts hochgeladen; alles bleibt auf dem Gerät.',
      ),
      h(
        'div.actions',
        {},
        h(
          'button.button.primary',
          { type: 'button', onclick: () => void this.addFolder() },
          h('span', { html: icon('folderPlus', 17) }),
          'Ordner durchsuchen',
        ),
        h(
          'button.button',
          { type: 'button', onclick: () => void this.addFiles() },
          h('span', { html: icon('filePlus', 17) }),
          'Einzelne Dateien',
        ),
      ),
    )
  }

  private buildCard(entry: DocEntry, token: number): HTMLElement {
    const cover = h('span.cover', {}, h('span.kind-mark', { html: icon(KIND_ICON[entry.kind], 26) }))

    if (entry.markCount) {
      cover.appendChild(
        h('span.badge', {}, h('span', { html: icon('note', 11) }), String(entry.markCount)),
      )
    }
    if (entry.progress && entry.progress > 0.01) {
      cover.appendChild(h('span.progress', {}, h('i', { style: `width:${Math.round(entry.progress * 100)}%` })))
    }
    void this.attachCover(entry, cover, token)

    return h(
      'button.doc-card',
      {
        type: 'button',
        class: entry.missing ? 'is-missing' : '',
        onclick: () => this.callbacks.onOpen(entry),
        oncontextmenu: (event: Event) => {
          event.preventDefault()
          void this.openItemMenu(entry)
        },
      },
      cover,
      h('span.name', {}, displayTitle(entry)),
      h('span.meta', {}, this.metaLine(entry)),
    )
  }

  private buildRow(entry: DocEntry): HTMLElement {
    return h(
      'button.doc-row',
      {
        type: 'button',
        class: entry.missing ? 'is-missing' : '',
        onclick: () => this.callbacks.onOpen(entry),
        oncontextmenu: (event: Event) => {
          event.preventDefault()
          void this.openItemMenu(entry)
        },
      },
      h('span.kind-mark', { html: icon(KIND_ICON[entry.kind], 20) }),
      h(
        'span',
        {},
        h('span.name', {}, displayTitle(entry)),
        h('span.path', {}, entry.folder ? `${entry.folder}/${entry.name}` : entry.name),
      ),
      h('span.side', {}, this.metaLine(entry)),
    )
  }

  private metaLine(entry: DocEntry): string {
    const parts: string[] = [KIND_LABEL[entry.kind]]
    if (entry.pages) parts.push(`${entry.pages} ${entry.kind === 'epub' ? 'Kapitel' : 'Seiten'}`)
    parts.push(formatBytes(entry.size))
    if (entry.openedAt) parts.push(formatWhen(entry.openedAt))
    if (entry.missing) parts.push('nicht erreichbar')
    return parts.join(' · ')
  }

  /**
   * Covers are read lazily and attached when they arrive. Reading a few hundred
   * blobs out of IndexedDB up front would block the first paint of the list for
   * no benefit — most of them are below the fold.
   */
  private async attachCover(entry: DocEntry, cover: HTMLElement, token: number): Promise<void> {
    const blob = await getThumb(entry.id)
    if (!blob || token !== this.generation) return

    const url = URL.createObjectURL(blob)
    this.coverUrls.push(url)

    const image = h('img', { src: url, alt: '', loading: 'lazy' })
    cover.querySelector('.kind-mark')?.replaceWith(image)
  }

  /* — Per-document actions ———————————————————————————————————— */

  private async openItemMenu(entry: DocEntry): Promise<void> {
    const body = h('div.settings-group')
    const { close } = openDialog({
      title: displayTitle(entry),
      body,
      acknowledge: true,
      confirmLabel: 'Schließen',
    })

    body.appendChild(
      h('p', { style: 'color:var(--text-dim);font-size:0.85rem' },
        entry.folder ? `${entry.folder}/${entry.name}` : entry.name),
    )

    body.appendChild(
      h(
        'button.button',
        {
          type: 'button',
          style: 'justify-content:flex-start',
          onclick: () => {
            close(true)
            this.callbacks.onOpen(entry)
          },
        },
        h('span', { html: icon('book', 16) }),
        'Öffnen',
      ),
    )

    body.appendChild(
      h(
        'button.button.danger',
        {
          type: 'button',
          style: 'justify-content:flex-start',
          onclick: async () => {
            close(true)
            const sure = await confirmDestructive(
              'Aus der Bibliothek entfernen?',
              'Der Eintrag und seine Notizen werden gelöscht. Die Datei selbst bleibt unverändert auf dem Gerät.',
              'Entfernen',
            )
            if (!sure) return
            await removeDoc(entry.id)
            this.callbacks.onChanged()
            toast('Eintrag entfernt.', { kind: 'ok' })
          },
        },
        h('span', { html: icon('trash', 16) }),
        'Aus der Bibliothek entfernen',
      ),
    )
  }

  /* — Sources ———————————————————————————————————————————————— */

  private async addFolder(): Promise<void> {
    try {
      const result = await addFolder()
      if (!result.source) return
      await this.loadSources()
      this.callbacks.onChanged()

      if (!result.added && !result.updated) {
        toast('In diesem Ordner wurden keine Dokumente gefunden.', { kind: 'warn' })
        return
      }
      toast(
        `${result.added} neu, ${result.updated} aktualisiert${result.copied ? ' — als Kopie, da dieser Browser keine Ordner behalten kann' : ''}.`,
        { kind: 'ok', duration: result.copied ? 7000 : 3600 },
      )
    } catch (error) {
      toast((error as Error).message || 'Der Ordner konnte nicht gelesen werden.', { kind: 'error' })
    }
  }

  private async addFiles(): Promise<void> {
    try {
      const result = await pickAndImportFiles()
      if (!result.entries.length) return
      await this.loadSources()
      this.callbacks.onChanged()
      toast(`${result.entries.length} ${result.entries.length === 1 ? 'Datei' : 'Dateien'} aufgenommen.`, { kind: 'ok' })
    } catch (error) {
      toast((error as Error).message || 'Die Dateien konnten nicht gelesen werden.', { kind: 'error' })
    }
  }

  private async openManage(): Promise<void> {
    const body = h('div', { style: 'display:grid;gap:18px' })
    const { close } = openDialog({
      title: 'Quellen und Einstellungen',
      body,
      width: 'breit',
      acknowledge: true,
      confirmLabel: 'Schließen',
    })

    const sources = h('div.settings-group')
    sources.appendChild(h('h3', {}, 'Quellen'))

    if (!this.sources.length) {
      sources.appendChild(h('p', { style: 'color:var(--text-dim)' }, 'Noch keine Quelle hinzugefügt.'))
    }

    for (const source of this.sources) {
      const count = this.docs.filter((doc) => doc.sourceId === source.id).length
      sources.appendChild(
        h(
          'div.source-row',
          {},
          h('span', { html: icon(source.kind === 'folder' ? 'folder' : 'file', 18) }),
          h(
            'div.grow',
            {},
            h('div.name', {}, source.name),
            h(
              'div.meta',
              {},
              `${count} Dokumente · ${source.kind === 'folder' ? 'Ordner auf dem Gerät' : 'Kopie in Folio'}` +
                (source.scannedAt ? ` · zuletzt ${formatWhen(source.scannedAt)}` : ''),
            ),
          ),
          source.handle
            ? h('button.icon-button', {
                type: 'button',
                title: 'Erneut durchsuchen',
                html: icon('refresh'),
                onclick: () => void this.rescan(source),
              })
            : null,
          h('button.icon-button', {
            type: 'button',
            title: 'Quelle entfernen',
            html: icon('trash'),
            onclick: async () => {
              const sure = await confirmDestructive(
                `„${source.name}“ entfernen?`,
                'Alle Einträge dieser Quelle und ihre Notizen werden aus Folio gelöscht. Die Dateien selbst bleiben unverändert.',
                'Entfernen',
              )
              if (!sure) return
              await removeSource(source.id)
              await this.loadSources()
              this.callbacks.onChanged()
              close(true)
            },
          }),
        ),
      )
    }

    sources.appendChild(
      h(
        'div',
        { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        h(
          'button.button',
          { type: 'button', onclick: () => { close(true); void this.addFolder() } },
          h('span', { html: icon('folderPlus', 16) }),
          'Ordner hinzufügen',
        ),
        h(
          'button.button',
          { type: 'button', onclick: () => { close(true); void this.addFiles() } },
          h('span', { html: icon('filePlus', 16) }),
          'Dateien hinzufügen',
        ),
      ),
    )

    body.appendChild(sources)
    body.appendChild(await openSettings())
  }

  private async rescan(source: LibrarySource): Promise<void> {
    try {
      const result = await rescanFolder(source)
      await this.loadSources()
      this.callbacks.onChanged()
      toast(
        `${result.added} neu, ${result.updated} unverändert` +
          (result.gone ? `, ${result.gone} nicht mehr gefunden` : '') + '.',
        { kind: 'ok' },
      )
    } catch (error) {
      toast((error as Error).message || 'Der Ordner konnte nicht erneut gelesen werden.', { kind: 'error' })
    }
  }
}
