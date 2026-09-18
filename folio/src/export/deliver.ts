/**
 * Getting a finished file to where it is wanted.
 *
 * Three destinations, in descending order of how good they are:
 *
 * 1. **Over the original.** Only possible for a document that came from a
 *    folder handle with write permission. This is what makes Folio an editor
 *    rather than a converter — the annotated file is the file.
 * 2. **Save as.** A real save dialog, so the file lands where it was asked for
 *    rather than in the downloads folder.
 * 3. **Download.** The fallback that exists everywhere.
 *
 * Sharing is offered alongside rather than instead: on a phone, "an eine App
 * weitergeben" is usually what "export" actually means.
 */

import { downloadBlob } from '@/lib/dom'
import { saveAs, writeHandle } from '@/lib/files'
import { canWriteInPlace, type DocEntry } from '@/store/library'

export type Destination = 'original' | 'speichern-unter' | 'download' | 'teilen'

export interface DeliveryResult {
  destination: Destination
  /** False when the user dismissed the picker or the share sheet. */
  completed: boolean
}

export async function canOverwrite(entry: DocEntry): Promise<boolean> {
  return canWriteInPlace(entry)
}

/** True when the platform can share files at all. */
export function canShare(blob: Blob, filename: string): boolean {
  if (!navigator.canShare || !navigator.share) return false
  try {
    return navigator.canShare({ files: [new File([blob], filename, { type: blob.type })] })
  } catch {
    return false
  }
}

export async function deliver(
  blob: Blob,
  filename: string,
  destination: Destination,
  entry: DocEntry,
): Promise<DeliveryResult> {
  switch (destination) {
    case 'original': {
      if (!entry.handle) throw new Error('Diese Datei kann nicht überschrieben werden.')
      await writeHandle(entry.handle, blob)
      return { destination, completed: true }
    }

    case 'speichern-unter': {
      const handle = await saveAs(blob, filename, blob.type, `.${extensionOf(filename)}`)
      if (handle) return { destination, completed: true }
      // No picker, or it was dismissed. A download is the honest fallback; the
      // caller reports which one happened.
      downloadBlob(blob, filename)
      return { destination: 'download', completed: true }
    }

    case 'teilen': {
      try {
        await navigator.share?.({
          files: [new File([blob], filename, { type: blob.type })],
          title: filename,
        })
        return { destination, completed: true }
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') {
          return { destination, completed: false }
        }
        throw error
      }
    }

    case 'download':
    default:
      downloadBlob(blob, filename)
      return { destination: 'download', completed: true }
  }
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot + 1) : 'bin'
}

/** Wording for the toast after a successful delivery. */
export function describeDelivery(result: DeliveryResult, filename: string): string {
  switch (result.destination) {
    case 'original':
      return 'Über die Originaldatei gespeichert.'
    case 'speichern-unter':
      return `„${filename}“ gespeichert.`
    case 'teilen':
      return 'An die andere App übergeben.'
    default:
      return `„${filename}“ heruntergeladen.`
  }
}
