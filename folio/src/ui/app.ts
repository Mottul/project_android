/**
 * The shell.
 *
 * Two views — the library and the reader — and a hash route that decides which
 * one is on screen. The hash matters more than it looks: on Android the system
 * back gesture is a history step, and a reader that cannot be left with a back
 * gesture feels broken. Routing through `location.hash` makes back mean "out of
 * the document" for free, and makes a document link something that can be
 * bookmarked and reopened.
 */

import { clear, h } from '@/lib/dom'
import { requestPersistence } from '@/lib/idb'
import { getDoc, listDocs, updateDoc, type DocEntry } from '@/store/library'
import { effectiveAppTheme, loadSettings, onSettingsChange, settings } from '@/store/settings'
import { kindOf } from '@/lib/kinds'
import { LibraryView } from './library'
import { ReaderView } from './reader'
import { toast } from './feedback'
import { importFiles } from './import'

export class App {
  private readonly root: HTMLElement
  private readonly library: LibraryView
  private reader: ReaderView | null = null
  private docs: DocEntry[] = []

  constructor(root: HTMLElement) {
    this.root = root
    this.library = new LibraryView({
      onOpen: (entry) => this.open(entry),
      onChanged: () => void this.refresh(),
    })
  }

  async start(): Promise<void> {
    await loadSettings()
    applyTheme()
    onSettingsChange(applyTheme)
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme)

    // Asked for once, at start-up: without it a browser under disk pressure may
    // drop the library — and with it every annotation made on a file that is
    // only in Folio as a copy.
    void requestPersistence()

    await this.refresh()

    window.addEventListener('hashchange', () => void this.route())
    this.acceptLaunchFiles()
    this.acceptDroppedFiles()

    await this.route()
  }

  /** Re-reads the library index and refreshes whatever is on screen. */
  async refresh(): Promise<void> {
    this.docs = await listDocs()
    this.library.setDocs(this.docs)
  }

  private async route(): Promise<void> {
    const match = /^#\/doc\/(.+)$/.exec(location.hash)

    if (!match) {
      this.showLibrary()
      return
    }

    const entry = await getDoc(decodeURIComponent(match[1]))
    if (!entry) {
      toast('Das Dokument ist nicht mehr in der Bibliothek.', { kind: 'warn' })
      location.hash = '#/'
      return
    }
    await this.showReader(entry)
  }

  private open(entry: DocEntry): void {
    location.hash = `#/doc/${encodeURIComponent(entry.id)}`
  }

  private showLibrary(): void {
    this.reader?.destroy()
    this.reader = null
    clear(this.root)
    this.root.appendChild(this.library.element)
    // Redrawn on arrival: covers that finished loading while the reader was
    // open belong to a list that is no longer on screen.
    this.library.show()
  }

  private async showReader(entry: DocEntry): Promise<void> {
    this.reader?.destroy()

    const reader = new ReaderView(entry, {
      onClose: () => {
        location.hash = '#/'
      },
      onEntryChanged: (patch: Partial<DocEntry>) => void this.updateEntry(entry.id, patch),
    })
    this.reader = reader

    clear(this.root)
    this.root.appendChild(reader.element)
    await reader.load()
  }

  private async updateEntry(id: string, patch: Partial<DocEntry>): Promise<void> {
    const updated = await updateDoc(id, patch)
    if (!updated) return
    const index = this.docs.findIndex((doc) => doc.id === id)
    if (index >= 0) this.docs[index] = updated
    this.library.setDocs(this.docs)
  }

  /* — Files handed over by the operating system ————————————————— */

  /**
   * "Öffnen mit Folio". The installed app is launched with file handles, which
   * are imported like any other pick and then opened straight away.
   */
  private acceptLaunchFiles(): void {
    window.launchQueue?.setConsumer(({ files }) => {
      if (!files?.length) return
      void (async () => {
        const scanned = await Promise.all(
          files.map(async (handle) => {
            const file = await handle.getFile()
            return {
              path: file.name,
              name: file.name,
              kind: kindOf(file.name, file.type),
              size: file.size,
              modifiedAt: file.lastModified,
              handle,
              file,
            }
          }),
        )
        const result = await importFiles(scanned)
        await this.refresh()
        if (result.entries.length) this.open(result.entries[0])
      })()
    })
  }

  /** Dropping a file anywhere in the window imports it. */
  private acceptDroppedFiles(): void {
    const stop = (event: DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', (event) => {
      stop(event)
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (!files.length) return

      void (async () => {
        const result = await importFiles(
          files.map((file) => ({
            path: file.name,
            name: file.name,
            kind: kindOf(file.name, file.type),
            size: file.size,
            modifiedAt: file.lastModified,
            file,
          })),
        )
        await this.refresh()
        toast(
          result.entries.length === 1
            ? `„${result.entries[0].name}“ wurde aufgenommen.`
            : `${result.entries.length} Dateien wurden aufgenommen.`,
          { kind: 'ok' },
        )
        if (result.entries.length === 1) this.open(result.entries[0])
      })()
    })
  }
}

function applyTheme(): void {
  document.documentElement.dataset.theme = effectiveAppTheme()
  document.documentElement.dataset.paper = settings().readerTheme

  const color = effectiveAppTheme() === 'dunkel' ? '#181b21' : '#ffffff'
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = h('meta', { name: 'theme-color' })
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', color)
}
