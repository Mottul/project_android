/**
 * Getting access to a folder back after a restart.
 *
 * A directory handle survives in IndexedDB, but the permission that came with
 * it does not: the browser hands it back in the `prompt` state and will only
 * move it to `granted` from inside a user gesture. That is deliberate — a page
 * that could silently regain access to someone's documents on load would be a
 * hole, not a feature — so the question is not how to avoid asking, but how to
 * ask once instead of constantly.
 *
 * Two things make that work:
 *
 * * **Ask on the folder, never on the file.** Permission granted on a directory
 *   covers everything inside it, so one answer restores the whole library.
 *   Asking per document would mean one dialog per document.
 * * **Ask at the moment it is needed**, from the tap that needs it — opening a
 *   document, or the button in the library — so the answer is a single tap
 *   rather than an error message followed by a hunt for the right menu.
 *
 * Installed as an app, Chromium offers "Allow on every visit" in that dialog,
 * and then the question stops coming back at all. Folio cannot choose that for
 * the reader, but it is the reason the prompt is worth showing properly rather
 * than working around.
 */

import { ensurePermission, hasPermission } from '@/lib/files'
import { getSource, listSources, type DocEntry, type LibrarySource } from '@/store/library'
import { h } from '@/lib/dom'
import { openDialog } from './feedback'
import { icon } from './icons'

/**
 * Asks for a folder, read and write.
 *
 * Read-write because that is what "save over the original" needs and what the
 * folder was picked with. A platform that refuses it outright still leaves a
 * readable library worth having, so that is tried once afterwards.
 */
async function grant(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if (await ensurePermission(handle, 'readwrite')) return true
  return ensurePermission(handle, 'read')
}

/** Folder sources that would prompt before they can be read. */
export async function lapsedSources(): Promise<LibrarySource[]> {
  const sources = await listSources()
  const lapsed: LibrarySource[] = []

  for (const source of sources) {
    if (!source.handle) continue
    if (!(await hasPermission(source.handle, 'read'))) lapsed.push(source)
  }
  return lapsed
}

/** True when this document can be read without asking anyone. */
export async function isReadable(entry: DocEntry): Promise<boolean> {
  if (!entry.handle) return true
  return hasPermission(entry.handle, 'read')
}

/**
 * Restores access to every folder that needs it.
 *
 * Must be called from a user gesture. One dialog per folder is unavoidable —
 * the browser will not batch them — but most libraries have one.
 */
export async function requestAllAccess(): Promise<{ granted: number; total: number }> {
  const lapsed = await lapsedSources()
  let granted = 0

  for (const source of lapsed) {
    if (source.handle && (await grant(source.handle))) granted += 1
  }
  return { granted, total: lapsed.length }
}

/**
 * Asks for the folder a document came from, with an explanation first.
 *
 * The explanation matters: a permission dialog that appears out of nowhere when
 * someone taps a document reads like an error. Saying what is about to be asked
 * and why turns it into one expected step.
 */
export async function requestAccessFor(entry: DocEntry): Promise<boolean> {
  const source = await getSource(entry.sourceId)
  const handle = source?.handle
  if (!handle) return false

  const body = h(
    'div',
    { style: 'display:grid;gap:12px' },
    h(
      'p',
      {},
      `„${entry.name}“ liegt im Ordner „${source?.name ?? ''}“. Der Browser gibt den Zugriff ` +
        'darauf nach jedem Neustart erst wieder frei, wenn er bestätigt wird — Folio kann das ' +
        'nicht umgehen und soll es auch nicht.',
    ),
    h(
      'div.notice.info',
      {},
      h('span', { html: icon('info', 16) }),
      h(
        'span',
        {},
        'Einmal bestätigen genügt für den ganzen Ordner. Ist Folio als App installiert, ' +
          'bietet der Browser dabei „Bei jedem Besuch zulassen“ an — dann bleibt es dauerhaft.',
      ),
    ),
  )

  const { result } = openDialog({
    title: 'Zugriff auf den Ordner',
    body,
    confirmLabel: 'Zugriff erlauben',
    cancelLabel: 'Nicht jetzt',
  })

  if (!(await result)) return false
  if (!(await grant(handle))) return false

  // A file handle under a freshly granted folder normally reports granted
  // straight away; where it does not, one targeted question is still better
  // than sending someone back to the library empty handed.
  if (entry.handle && !(await hasPermission(entry.handle, 'read'))) {
    return ensurePermission(entry.handle, 'read')
  }
  return true
}
