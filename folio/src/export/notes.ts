/**
 * Getting the marks back out as text.
 *
 * Notes made while reading are frequently worth more than the annotated file
 * itself — they go into a summary, an e-mail, a set of notes somewhere else.
 * Both formats here are plain: Markdown for reading and pasting, JSON for
 * getting the marks into another tool or back into Folio.
 */

import { MARK_LABEL, type Mark } from '@/store/marks'
import { compareMarks } from '@/store/marks'

export interface NotesContext {
  title: string
  /** File name of the document the marks belong to. */
  fileName: string
  /** Chapter titles by spine path, for EPUB documents. */
  chapterTitles?: Map<string, string>
}

export function notesToMarkdown(
  marks: readonly Mark[],
  context: NotesContext,
  now = new Date(),
): string {
  const sorted = [...marks].sort(compareMarks)
  const lines: string[] = [
    `# ${context.title}`,
    '',
    `Notizen aus \`${context.fileName}\`, ${sorted.length} ${sorted.length === 1 ? 'Eintrag' : 'Einträge'}, ` +
      `Stand ${now.toLocaleDateString('de-DE')}.`,
    '',
  ]

  let currentSection = ''

  for (const mark of sorted) {
    const section = sectionOf(mark, context)
    if (section !== currentSection) {
      currentSection = section
      lines.push(`## ${section}`, '')
    }

    const label = MARK_LABEL[mark.type]
    const quote = mark.quote?.trim()
    const text = mark.text?.trim()

    if (quote) {
      lines.push(`> ${quote.replace(/\n+/g, ' ')}`, '')
    }
    if (mark.type === 'replace') {
      lines.push(`**${label}:** „${mark.original?.trim() ?? ''}“ → „${text ?? ''}“`, '')
    } else if (text) {
      lines.push(`**${label}:** ${text}`, '')
    } else if (!quote) {
      lines.push(`**${label}**`, '')
    }
    if (mark.comment?.trim()) {
      lines.push(mark.comment.trim(), '')
    }
  }

  if (!sorted.length) lines.push('_Keine Notizen vorhanden._', '')

  return lines.join('\n')
}

function sectionOf(mark: Mark, context: NotesContext): string {
  if (mark.href) {
    return context.chapterTitles?.get(mark.href) ?? mark.href
  }
  return `Seite ${(mark.page ?? 0) + 1}`
}

/** The exchange format: everything a mark carries, nothing else. */
export function notesToJson(marks: readonly Mark[], context: NotesContext): string {
  return JSON.stringify(
    {
      format: 'folio-marks',
      version: 1,
      document: { title: context.title, fileName: context.fileName },
      exportedAt: new Date().toISOString(),
      marks: [...marks].sort(compareMarks).map(({ docId: _docId, ...rest }) => rest),
    },
    null,
    2,
  )
}

export interface ImportedMarks {
  marks: Omit<Mark, 'docId'>[]
  title?: string
}

/**
 * Reads a file written by `notesToJson`.
 *
 * Validates rather than trusts: an imported file is the one place where a mark
 * can arrive with a shape the app never produced, and a malformed mark that
 * reaches the renderer takes the whole document view down with it.
 */
export function parseNotesJson(text: string): ImportedMarks {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Die Datei enthält kein gültiges JSON.')
  }

  const root = data as { format?: string; marks?: unknown; document?: { title?: string } }
  if (root.format !== 'folio-marks' || !Array.isArray(root.marks)) {
    throw new Error('Die Datei enthält keine Folio-Notizen.')
  }

  const marks = root.marks.filter(isMarkLike) as Omit<Mark, 'docId'>[]
  if (!marks.length) throw new Error('Die Datei enthält keine lesbaren Notizen.')

  return { marks, title: root.document?.title }
}

function isMarkLike(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const mark = value as Partial<Mark>
  if (typeof mark.id !== 'string' || typeof mark.type !== 'string') return false
  if (!(mark.type in MARK_LABEL)) return false
  // A mark has to be locatable, either on a page or in a chapter.
  return typeof mark.page === 'number' || typeof mark.href === 'string'
}
