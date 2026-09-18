/**
 * Parts of the interface that are loaded only when they are first needed.
 *
 * The export dialog pulls in pdf-lib and the EPUB writer — roughly a third of
 * the application's code, behind one button. Loading it with the reader would
 * make every document open pay for an export most of them never do.
 */

import type { ExportRequest } from './export-dialog'

export async function openExport(request: ExportRequest): Promise<void> {
  const { openExportDialog } = await import('./export-dialog')
  await openExportDialog(request)
}
