/**
 * The export dialog.
 *
 * One dialog for every document kind, because the questions are the same ones:
 * what comes out, how big may it be, do the marks come along, and where does it
 * go. What changes per kind is which of those are answerable — a PDF has a
 * resolution, an EPUB has picture sizes, a text file has neither.
 *
 * The size estimate is measured, never guessed. Pressing "Größe schätzen"
 * really does encode a sample of the document; "Zielgröße" really does search
 * for a setting that fits. Anything else would be a number that looks like an
 * answer and is not one.
 */

import { h } from '@/lib/dom'
import { formatBytes, suffixFileName } from '@/lib/format'
import type { DocEntry } from '@/store/library'
import type { Mark } from '@/store/marks'
import { settings, setSetting } from '@/store/settings'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EpubBook } from '@/epub/parse'

import {
  DPI_CHOICES,
  TARGET_PRESETS,
  describeStep,
  estimateTotalBytes,
  samplePages,
} from '@/pdf/compress'
import { exportPdf, isCancelled, renderPageToJpeg, exportPageImage } from '@/pdf/export'
import { exportEpub } from '@/epub/export'
import { composeImage, drawMarksOnCanvas } from '@/export/canvas-marks'
import { notesToJson, notesToMarkdown } from '@/export/notes'
import { formatPageRange, parsePageRange } from '@/export/range'
import { canOverwrite, canShare, deliver, describeDelivery, type Destination } from '@/export/deliver'
import { openDialog, progressToast, toast } from './feedback'
import { icon } from './icons'

export interface ExportRequest {
  kind: 'pdf' | 'epub' | 'image' | 'text'
  entry: DocEntry
  marks: Mark[]
  pdf?: { doc: PDFDocumentProxy; source: ArrayBuffer }
  epub?: { book: EpubBook }
  image?: { element: HTMLImageElement }
  text?: { content: string }
}

type Format =
  | 'pdf-original'
  | 'pdf-komprimiert'
  | 'seiten-bild'
  | 'epub'
  | 'bild'
  | 'text'
  | 'notizen-md'
  | 'notizen-json'

interface State {
  format: Format
  includeMarks: boolean
  range: string
  /* PDF */
  dpi: number
  quality: number
  grayscale: boolean
  useTarget: boolean
  targetBytes: number
  /* EPUB and image */
  imageQuality: number
  maxEdge: number
  notesChapter: boolean
  imageFormat: 'image/jpeg' | 'image/png'
}

export async function openExportDialog(request: ExportRequest): Promise<void> {
  const state: State = {
    format: defaultFormat(request.kind),
    includeMarks: request.marks.length > 0,
    range: '',
    dpi: settings().exportDpi,
    quality: settings().exportQuality,
    grayscale: false,
    useTarget: false,
    targetBytes: TARGET_PRESETS[1].bytes,
    imageQuality: 0.82,
    maxEdge: 1600,
    notesChapter: true,
    imageFormat: 'image/jpeg',
  }

  const body = h('div', { style: 'display:grid;gap:16px' })
  const options = h('div', { style: 'display:grid;gap:14px' })
  const estimate = h('div.estimate')

  const { footer, dialog, close } = openDialog({
    title: 'Exportieren',
    body,
    width: 'breit',
    acknowledge: true,
    confirmLabel: 'Schließen',
  })

  body.appendChild(buildFormatPicker(request, state, () => redraw()))
  body.appendChild(options)
  body.appendChild(estimate)

  const redraw = () => {
    options.replaceChildren(...buildOptions(request, state, redraw))
    showEstimate(estimate, request, state)
    buildActions()
  }

  /* — The footer carries the destinations, which depend on the format. —— */
  const buildActions = () => {
    footer.replaceChildren()

    void (async () => {
      const overwritable =
        state.format === 'pdf-original' &&
        request.kind === 'pdf' &&
        (await canOverwrite(request.entry))

      if (overwritable) {
        footer.appendChild(
          h(
            'button.button',
            { type: 'button', onclick: () => void run('original') },
            h('span', { html: icon('save', 16) }),
            'Über Original speichern',
          ),
        )
      }

      footer.appendChild(
        h(
          'button.button',
          { type: 'button', onclick: () => void run('teilen') },
          h('span', { html: icon('share', 16) }),
          'Teilen',
        ),
      )
      footer.appendChild(
        h(
          'button.button.primary',
          { type: 'button', onclick: () => void run('speichern-unter') },
          h('span', { html: icon('download', 16) }),
          'Speichern',
        ),
      )
    })()
  }

  const run = async (destination: Destination) => {
    const progress = progressToast('Export wird vorbereitet')
    try {
      const produced = await produce(request, state, (fraction, label) =>
        progress.update(fraction, label),
      )
      progress.done()

      if (destination === 'teilen' && !canShare(produced.blob, produced.filename)) {
        toast('Dieses Gerät kann Dateien nicht direkt teilen — die Datei wird gespeichert.', {
          kind: 'warn',
        })
        destination = 'speichern-unter'
      }

      const result = await deliver(produced.blob, produced.filename, destination, request.entry)
      if (!result.completed) return

      close(true)
      toast(
        `${describeDelivery(result, produced.filename)} ${formatBytes(produced.blob.size)}.` +
          (produced.note ? ` ${produced.note}` : ''),
        { kind: 'ok', duration: produced.note ? 8000 : 4000 },
      )
    } catch (error) {
      progress.done()
      if (isCancelled(error)) return
      toast((error as Error).message || 'Der Export ist fehlgeschlagen.', { kind: 'error' })
    }
  }

  redraw()
  dialog.addEventListener('close', () => undefined)
}

function defaultFormat(kind: ExportRequest['kind']): Format {
  switch (kind) {
    case 'pdf':
      return 'pdf-original'
    case 'epub':
      return 'epub'
    case 'image':
      return 'bild'
    default:
      return 'text'
  }
}

/* ===========================================================================
   Format picker
   ======================================================================== */

function buildFormatPicker(request: ExportRequest, state: State, onChange: () => void): HTMLElement {
  const formats: [Format, string, string][] = []

  if (request.kind === 'pdf') {
    formats.push(
      ['pdf-original', 'PDF, unverändert', 'Text bleibt Text, Qualität bleibt wie sie ist'],
      ['pdf-komprimiert', 'PDF, verkleinert', 'Seiten werden neu gerastert — kleiner, aber Bild statt Text'],
      ['seiten-bild', 'Seiten als Bild', 'JPEG oder PNG, eine Datei je Seite'],
    )
  }
  if (request.kind === 'epub') {
    formats.push(['epub', 'EPUB', 'Mit Markierungen und, auf Wunsch, kleineren Bildern'])
  }
  if (request.kind === 'image') {
    formats.push(['bild', 'Bild', 'Mit eingebrannten Markierungen'])
  }
  if (request.kind === 'text') {
    formats.push(['text', 'Textdatei', 'Unverändert'])
  }

  formats.push(
    ['notizen-md', 'Notizen als Markdown', 'Alle Markierungen und Kommentare als Text'],
    ['notizen-json', 'Notizen als JSON', 'Zum Sichern oder für andere Programme'],
  )

  const list = h('div', { style: 'display:grid;gap:7px' })

  for (const [value, label, hint] of formats) {
    const input = h('input', {
      type: 'radio',
      name: 'folio-format',
      checked: state.format === value,
      onchange: () => {
        state.format = value
        onChange()
      },
    })
    list.appendChild(
      h('label.switch-row', {}, input, h('span', {}, label, h('span.hint', {}, hint))),
    )
  }

  return list
}

/* ===========================================================================
   Options
   ======================================================================== */

function buildOptions(request: ExportRequest, state: State, onChange: () => void): HTMLElement[] {
  const blocks: HTMLElement[] = []

  const marksToggle = () =>
    h(
      'label.switch-row',
      {},
      h('input', {
        type: 'checkbox',
        checked: state.includeMarks,
        disabled: request.marks.length === 0,
        onchange: (event: Event) => {
          state.includeMarks = (event.target as HTMLInputElement).checked
          onChange()
        },
      }),
      h(
        'span',
        {},
        'Markierungen und Kommentare einbetten',
        h(
          'span.hint',
          {},
          request.marks.length
            ? `${request.marks.length} vorhanden`
            : 'Noch keine Markierungen in diesem Dokument',
        ),
      ),
    )

  if (state.format === 'notizen-md' || state.format === 'notizen-json') {
    blocks.push(
      h('div.notice.info', {}, h('span', { html: icon('info', 16) }),
        h('span', {}, `${request.marks.length} Einträge werden ausgegeben. Das Dokument selbst bleibt unberührt.`)),
    )
    return blocks
  }

  if (state.format === 'pdf-original') {
    blocks.push(marksToggle())
    blocks.push(pageRangeField(request, state, onChange))
    blocks.push(
      h('div.notice.info', {}, h('span', { html: icon('info', 16) }),
        h('span', {}, 'Die Datei behält ihre Struktur. Kommentare werden zusätzlich als PDF-Notizen eingebettet, ' +
          'sodass jedes andere Programm sie ebenfalls anzeigt.')),
    )
    const covering = coveredMarks(request.marks)
    if (state.includeMarks && covering > 0) blocks.push(coverWarning(covering))
  }

  if (state.format === 'pdf-komprimiert') {
    blocks.push(marksToggle())
    blocks.push(pageRangeField(request, state, onChange))

    blocks.push(
      h(
        'div.segmented',
        {},
        h('button', {
          type: 'button',
          'aria-pressed': String(!state.useTarget),
          onclick: () => {
            state.useTarget = false
            onChange()
          },
        }, 'Qualität wählen'),
        h('button', {
          type: 'button',
          'aria-pressed': String(state.useTarget),
          onclick: () => {
            state.useTarget = true
            onChange()
          },
        }, 'Zielgröße vorgeben'),
      ),
    )

    if (state.useTarget) {
      const chips = h('div', { style: 'display:flex;gap:7px;flex-wrap:wrap' })
      for (const preset of TARGET_PRESETS) {
        chips.appendChild(
          h(
            'button.chip',
            {
              type: 'button',
              'aria-pressed': String(state.targetBytes === preset.bytes),
              onclick: () => {
                state.targetBytes = preset.bytes
                onChange()
              },
            },
            preset.label,
          ),
        )
      }
      blocks.push(
        h('div.field-label', {}, h('span', {}, 'Höchstens'), chips,
          h('span.hint', { style: 'font-size:0.8rem;color:var(--text-faint)' },
            'Folio probiert an einigen Seiten aus, welche Einstellung passt, und nimmt die beste, die darunter bleibt.')),
      )
    } else {
      blocks.push(dpiField(state, onChange))
      blocks.push(qualityField(state, onChange))
    }

    blocks.push(
      h(
        'label.switch-row',
        {},
        h('input', {
          type: 'checkbox',
          checked: state.grayscale,
          onchange: (event: Event) => {
            state.grayscale = (event.target as HTMLInputElement).checked
            onChange()
          },
        }),
        h('span', {}, 'In Graustufen', h('span.hint', {}, 'Spart bei Scans oft ein Drittel.')),
      ),
    )

    blocks.push(
      h('div.notice.warn', {}, h('span', { html: icon('warn', 16) }),
        h('span', {}, 'Die Seiten werden zu Bildern. Text lässt sich danach nicht mehr markieren oder durchsuchen — ' +
          'gut zum Verschicken, nicht zum Weiterarbeiten.')),
    )
    if (state.includeMarks && coveredMarks(request.marks) > 0) {
      blocks.push(
        h('div.notice.info', {}, h('span', { html: icon('info', 16) }),
          h('span', {}, 'Bei dieser Ausgabe verschwindet abgedeckter Text wirklich: die Seite ist danach ein Bild, ' +
            'unter dem nichts mehr liegt.')),
      )
    }
  }

  if (state.format === 'seiten-bild') {
    blocks.push(marksToggle())
    blocks.push(pageRangeField(request, state, onChange))
    blocks.push(imageFormatField(state, onChange))
    blocks.push(dpiField(state, onChange))
    if (state.imageFormat === 'image/jpeg') blocks.push(qualityField(state, onChange))
  }

  if (state.format === 'bild') {
    blocks.push(marksToggle())
    blocks.push(imageFormatField(state, onChange))
    blocks.push(maxEdgeField(state, onChange))
    if (state.imageFormat === 'image/jpeg') {
      blocks.push(
        sliderField('Qualität', `${Math.round(state.imageQuality * 100)} %`, state.imageQuality, 0.3, 1, 0.05, (value) => {
          state.imageQuality = value
          onChange()
        }),
      )
    }
  }

  if (state.format === 'epub') {
    blocks.push(marksToggle())
    blocks.push(
      h(
        'label.switch-row',
        {},
        h('input', {
          type: 'checkbox',
          checked: state.notesChapter,
          onchange: (event: Event) => {
            state.notesChapter = (event.target as HTMLInputElement).checked
            onChange()
          },
        }),
        h('span', {}, 'Notizkapitel anhängen', h('span.hint', {}, 'Ein zusätzliches Kapitel am Ende mit allen Notizen.')),
      ),
    )
    blocks.push(maxEdgeField(state, onChange))
    blocks.push(
      sliderField('Bildqualität', `${Math.round(state.imageQuality * 100)} %`, state.imageQuality, 0.3, 1, 0.05, (value) => {
        state.imageQuality = value
        onChange()
      }),
    )
    blocks.push(
      h('div.notice.info', {}, h('span', { html: icon('info', 16) }),
        h('span', {}, 'Bei Büchern mit vielen Abbildungen macht die Bildqualität den Unterschied. ' +
          'Reiner Text bleibt in jedem Fall unverändert.')),
    )
  }

  if (state.format === 'text') {
    blocks.push(
      h('div.notice.info', {}, h('span', { html: icon('info', 16) }),
        h('span', {}, 'Textdateien werden unverändert ausgegeben. Markierungen liegen im Notizen-Export.')),
    )
  }

  return blocks
}

/** Marks that hide something underneath rather than adding something on top. */
function coveredMarks(marks: readonly Mark[]): number {
  return marks.filter((mark) => mark.type === 'redact' || mark.type === 'replace').length
}

/**
 * The warning that matters most in this dialog.
 *
 * "Abdecken" and "Text bearbeiten" paint over the page. They do not remove
 * anything: the original glyphs are still in the file and can be copied out of
 * it by any reader. For a struck-through draft that is fine, and for a covered
 * address it is the opposite of what was intended — so it is said plainly, with
 * the one export that really does remove it.
 */
function coverWarning(count: number): HTMLElement {
  return h(
    'div.notice.warn',
    {},
    h('span', { html: icon('warn', 16) }),
    h(
      'span',
      {},
      `${count === 1 ? 'Eine Stelle wird' : `${count} Stellen werden`} überdeckt. ` +
        'Der ursprüngliche Text bleibt dabei in der Datei und lässt sich weiterhin herauskopieren. ' +
        'Wirklich entfernt wird er nur beim verkleinerten Export, weil die Seiten dort zu Bildern werden.',
    ),
  )
}

function pageRangeField(request: ExportRequest, state: State, onChange: () => void): HTMLElement {
  const total = request.pdf?.doc.numPages ?? 1
  const field = h('input.field', {
    type: 'text',
    placeholder: `alle (1–${total})`,
    value: state.range,
    oninput: (event: Event) => {
      state.range = (event.target as HTMLInputElement).value
      onChange()
    },
  })

  const parsed = parsePageRange(state.range, total)
  return h(
    'label.field-label',
    {},
    h('span', {}, 'Seiten'),
    field,
    h(
      'span',
      { style: `font-size:0.8rem;color:${parsed.problem ? 'var(--warn)' : 'var(--text-faint)'}` },
      parsed.problem ?? (parsed.whole ? 'Alle Seiten' : `${parsed.pages.length} Seiten: ${formatPageRange(parsed.pages)}`),
    ),
  )
}

function dpiField(state: State, onChange: () => void): HTMLElement {
  const chips = h('div', { style: 'display:flex;gap:7px;flex-wrap:wrap' })
  for (const dpi of DPI_CHOICES) {
    chips.appendChild(
      h(
        'button.chip',
        {
          type: 'button',
          'aria-pressed': String(state.dpi === dpi),
          onclick: () => {
            state.dpi = dpi
            setSetting('exportDpi', dpi)
            onChange()
          },
        },
        `${dpi} dpi`,
      ),
    )
  }
  return h(
    'div.field-label',
    {},
    h('span', {}, 'Auflösung'),
    chips,
    h('span', { style: 'font-size:0.8rem;color:var(--text-faint)' },
      state.dpi >= 240 ? 'Druckfein' : state.dpi >= 150 ? 'Scharf am Bildschirm' : state.dpi >= 96 ? 'Gut lesbar' : 'Nur zur Ansicht'),
  )
}

function qualityField(state: State, onChange: () => void): HTMLElement {
  return sliderField(
    'Qualität',
    `${Math.round(state.quality * 100)} %`,
    state.quality,
    0.3,
    0.95,
    0.05,
    (value) => {
      state.quality = value
      setSetting('exportQuality', value)
      onChange()
    },
  )
}

function imageFormatField(state: State, onChange: () => void): HTMLElement {
  return h(
    'div.settings-row',
    {},
    h('span', {}, 'Format'),
    h(
      'div.segmented',
      {},
      h('button', {
        type: 'button',
        'aria-pressed': String(state.imageFormat === 'image/jpeg'),
        onclick: () => {
          state.imageFormat = 'image/jpeg'
          onChange()
        },
      }, 'JPEG'),
      h('button', {
        type: 'button',
        'aria-pressed': String(state.imageFormat === 'image/png'),
        onclick: () => {
          state.imageFormat = 'image/png'
          onChange()
        },
      }, 'PNG'),
    ),
  )
}

function maxEdgeField(state: State, onChange: () => void): HTMLElement {
  const choices = [0, 1200, 1600, 2000, 2600]
  const chips = h('div', { style: 'display:flex;gap:7px;flex-wrap:wrap' })

  for (const edge of choices) {
    chips.appendChild(
      h(
        'button.chip',
        {
          type: 'button',
          'aria-pressed': String(state.maxEdge === edge),
          onclick: () => {
            state.maxEdge = edge
            onChange()
          },
        },
        edge === 0 ? 'Original' : `${edge} px`,
      ),
    )
  }

  return h('div.field-label', {}, h('span', {}, 'Längste Kante'), chips)
}

function sliderField(
  label: string,
  value: string,
  current: number,
  min: number,
  max: number,
  step: number,
  onInput: (value: number) => void,
): HTMLElement {
  return h(
    'div.field-label',
    {},
    h('div', { style: 'display:flex;justify-content:space-between' },
      h('span', {}, label),
      h('span', { style: 'color:var(--text-faint);font-variant-numeric:tabular-nums' }, value)),
    h('input.slider', {
      type: 'range',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(current),
      oninput: (event: Event) => onInput(Number((event.target as HTMLInputElement).value)),
    }),
  )
}

/* ===========================================================================
   Estimate
   ======================================================================== */

function showEstimate(container: HTMLElement, request: ExportRequest, state: State): void {
  container.replaceChildren()

  if (state.format === 'notizen-md' || state.format === 'notizen-json' || state.format === 'text') {
    container.appendChild(
      h('div', {}, h('div.value', {}, '—'), h('div.note', {}, 'Textausgabe, wenige Kilobyte')),
    )
    return
  }

  const info = h('div', {},
    h('div.value', {}, formatBytes(request.entry.size)),
    h('div.note', {}, 'Ausgangsgröße'))
  container.appendChild(info)

  if (state.format !== 'pdf-komprimiert' || !request.pdf) {
    container.appendChild(h('div.note', {}, state.format === 'pdf-original' ? 'Ergebnis etwa gleich groß' : ''))
    return
  }

  const result = h('div.note', {}, '')
  const button = h(
    'button.button',
    {
      type: 'button',
      onclick: async () => {
        button.setAttribute('disabled', '')
        result.textContent = 'wird gemessen …'
        try {
          const bytes = await measure(request, state)
          result.textContent = `geschätzt ${formatBytes(bytes)}`
        } catch {
          result.textContent = 'Schätzung nicht möglich'
        } finally {
          button.removeAttribute('disabled')
        }
      },
    },
    'Größe schätzen',
  )

  container.appendChild(h('div', { style: 'display:flex;align-items:center;gap:10px' }, result, button))
}

/**
 * Encodes a sample of the pages at the chosen setting and extrapolates.
 *
 * The same routine the target-size search uses, so the number shown here and
 * the number the search works from cannot disagree.
 */
async function measure(request: ExportRequest, state: State): Promise<number> {
  if (!request.pdf) return 0
  const total = request.pdf.doc.numPages
  const pages = parsePageRange(state.range, total).pages
  const sample = samplePages(pages.length).map((index) => pages[index])

  let sum = 0
  for (const pageIndex of sample) {
    const rendered = await renderPageToJpeg(
      request.pdf.doc,
      pageIndex,
      { dpi: state.dpi, quality: state.quality },
      state.grayscale,
    )
    sum += rendered.bytes.byteLength
  }

  return estimateTotalBytes([sum / Math.max(1, sample.length)], pages.length)
}

/* ===========================================================================
   Producing the file
   ======================================================================== */

interface Produced {
  blob: Blob
  filename: string
  /** Something the reader should know about the result. */
  note?: string
}

async function produce(
  request: ExportRequest,
  state: State,
  onProgress: (fraction: number, label: string) => void,
): Promise<Produced> {
  const marks = state.includeMarks ? request.marks : []
  const title = request.entry.title || request.entry.name

  switch (state.format) {
    case 'notizen-md':
      return {
        blob: new Blob([notesToMarkdown(request.marks, { title, fileName: request.entry.name })], {
          type: 'text/markdown;charset=utf-8',
        }),
        filename: suffixFileName(request.entry.name, '-notizen', 'md'),
      }

    case 'notizen-json':
      return {
        blob: new Blob([notesToJson(request.marks, { title, fileName: request.entry.name })], {
          type: 'application/json',
        }),
        filename: suffixFileName(request.entry.name, '-notizen', 'json'),
      }

    case 'text':
      return {
        blob: new Blob([request.text?.content ?? ''], { type: 'text/plain;charset=utf-8' }),
        filename: request.entry.name,
      }

    case 'bild': {
      if (!request.image) throw new Error('Kein Bild geladen.')
      const blob = await composeImage(request.image.element, marks, {
        maxEdge: state.maxEdge,
        quality: state.imageQuality,
        format: state.imageFormat,
      })
      return {
        blob,
        filename: suffixFileName(
          request.entry.name,
          marks.length ? '-kommentiert' : '',
          state.imageFormat === 'image/png' ? 'png' : 'jpg',
        ),
      }
    }

    case 'epub': {
      if (!request.epub) throw new Error('Kein Buch geladen.')
      const result = await exportEpub({
        book: request.epub.book,
        marks,
        includeMarks: state.includeMarks,
        includeNotesChapter: state.notesChapter && state.includeMarks,
        imageQuality: state.imageQuality,
        maxImageEdge: state.maxEdge,
        onProgress,
      })
      return {
        blob: result.blob,
        filename: suffixFileName(request.entry.name, '-folio', 'epub'),
        note:
          (result.imageSavings > 0 ? `Bilder: ${formatBytes(result.imageSavings)} gespart.` : '') +
          (result.unanchored > 0 ? ` ${result.unanchored} Markierungen konnten nicht zugeordnet werden.` : ''),
      }
    }

    case 'seiten-bild': {
      if (!request.pdf) throw new Error('Kein Dokument geladen.')
      const pages = parsePageRange(state.range, request.pdf.doc.numPages).pages

      if (pages.length === 1) {
        const blob = await renderSinglePage(request, state, pages[0], marks)
        return {
          blob,
          filename: suffixFileName(
            request.entry.name,
            `-seite-${pages[0] + 1}`,
            state.imageFormat === 'image/png' ? 'png' : 'jpg',
          ),
        }
      }

      // Several pages become a ZIP rather than a burst of downloads, which most
      // browsers block after the first two anyway.
      const { zipSync, strToU8 } = await import('fflate')
      const entries: Record<string, Uint8Array> = {}
      const extension = state.imageFormat === 'image/png' ? 'png' : 'jpg'

      for (let index = 0; index < pages.length; index += 1) {
        onProgress(index / pages.length, `Seite ${index + 1} von ${pages.length}`)
        const blob = await renderSinglePage(request, state, pages[index], marks)
        entries[`seite-${String(pages[index] + 1).padStart(3, '0')}.${extension}`] = new Uint8Array(
          await blob.arrayBuffer(),
        )
      }
      void strToU8

      return {
        blob: new Blob([zipSync(entries, { level: 0 }) as BlobPart], { type: 'application/zip' }),
        filename: suffixFileName(request.entry.name, '-seiten', 'zip'),
        note: `${pages.length} Seiten im Archiv.`,
      }
    }

    case 'pdf-komprimiert':
    case 'pdf-original':
    default: {
      if (!request.pdf) throw new Error('Kein Dokument geladen.')
      const parsed = parsePageRange(state.range, request.pdf.doc.numPages)

      const result = await exportPdf({
        source: request.pdf.source,
        doc: request.pdf.doc,
        marks,
        includeMarks: state.includeMarks,
        pages: parsed.whole ? undefined : parsed.pages,
        mode: state.format === 'pdf-komprimiert' ? 'komprimiert' : 'original',
        dpi: state.dpi,
        quality: state.quality,
        grayscale: state.grayscale,
        targetBytes: state.format === 'pdf-komprimiert' && state.useTarget ? state.targetBytes : undefined,
        onProgress,
      })

      const notes: string[] = []
      if (result.step && state.useTarget) notes.push(`Gewählt: ${describeStep(result.step)}.`)
      if (result.missedTarget) notes.push('Die Zielgröße war nicht erreichbar; es wurde die kleinste Stufe verwendet.')
      if (result.droppedCharacters.length) {
        notes.push(
          `Nicht darstellbare Zeichen ersetzt: ${result.droppedCharacters.slice(0, 6).join(' ')}.`,
        )
      }

      return {
        blob: result.blob,
        filename: suffixFileName(
          request.entry.name,
          state.format === 'pdf-komprimiert' ? '-klein' : marks.length ? '-kommentiert' : '-export',
          'pdf',
        ),
        note: notes.join(' ') || undefined,
      }
    }
  }
}

/** One page as an image, with the marks drawn on top if they are wanted. */
async function renderSinglePage(
  request: ExportRequest,
  state: State,
  pageIndex: number,
  marks: readonly Mark[],
): Promise<Blob> {
  if (!request.pdf) throw new Error('Kein Dokument geladen.')

  const plain = await exportPageImage(request.pdf.doc, pageIndex, {
    dpi: state.dpi,
    quality: state.quality,
    format: state.imageFormat,
  })
  if (!marks.length) return plain

  // Re-drawn through a canvas so the marks land on the page at the same
  // relative positions they have on screen.
  const bitmap = await createImageBitmap(plain)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height

  const context = canvas.getContext('2d', { alpha: state.imageFormat === 'image/png' })
  if (!context) throw new Error('Die Seite konnte nicht gezeichnet werden.')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()

  drawMarksOnCanvas(context, marks, { width: canvas.width, height: canvas.height, page: pageIndex })

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, state.imageFormat, state.quality),
  )
  canvas.width = 0
  canvas.height = 0
  if (!blob) throw new Error('Die Seite konnte nicht erzeugt werden.')
  return blob
}
