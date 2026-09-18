/**
 * Editing a mark after it has been made: its comment, its colour, or whether it
 * stays at all.
 *
 * One dialog for all eight kinds. What differs between them is small — a
 * highlight shows the text it covers, a replacement shows what it replaced —
 * and splitting it into a dialog per kind would mean eight places to keep the
 * delete button consistent.
 */

import { h } from '@/lib/dom'
import {
  HIGHLIGHT_COLORS,
  INK_COLORS,
  MARK_LABEL,
  type Mark,
} from '@/store/marks'
import { openDialog } from './feedback'
import { icon } from './icons'
import type { MarksSession } from './marks-session'

export async function openMarkEditor(mark: Mark, session: MarksSession): Promise<void> {
  const body = h('div', { style: 'display:grid;gap:14px' })

  if (mark.quote) {
    body.appendChild(
      h(
        'blockquote',
        {
          style:
            'margin:0;padding:9px 11px;border-left:3px solid var(--line);' +
            'background:var(--surface-2);border-radius:var(--radius-sm);font-size:0.9rem',
        },
        mark.quote,
      ),
    )
  }

  if (mark.type === 'replace') {
    body.appendChild(
      h(
        'div',
        { style: 'font-size:0.88rem;display:grid;gap:4px' },
        h('div', { style: 'color:var(--text-faint)' }, 'Vorher'),
        h('div', { style: 'text-decoration:line-through' }, mark.original || '—'),
        h('div', { style: 'color:var(--text-faint);margin-top:4px' }, 'Nachher'),
        h('div', {}, mark.text || '(gelöscht)'),
      ),
    )
  }

  const comment = h('textarea.field', {
    rows: 4,
    placeholder: 'Kommentar …',
  }) as HTMLTextAreaElement
  comment.value = mark.comment ?? ''
  body.appendChild(h('label.field-label', {}, h('span', {}, 'Kommentar'), comment))

  // Text replacements keep their sampled colour; changing it would only make
  // the new text stop matching the rest of the line.
  let color = mark.color
  if (mark.type !== 'replace' && mark.type !== 'redact') {
    const palette = mark.type === 'highlight' ? HIGHLIGHT_COLORS : INK_COLORS
    const swatches = h('div.swatches')

    for (const entry of palette) {
      swatches.appendChild(
        h('button.swatch', {
          type: 'button',
          title: entry.name,
          'aria-label': entry.name,
          'aria-pressed': String(entry.value === color),
          style: `background:${entry.value}`,
          onclick: (event: Event) => {
            color = entry.value
            for (const button of swatches.querySelectorAll('button')) {
              button.setAttribute('aria-pressed', 'false')
            }
            ;(event.currentTarget as HTMLElement).setAttribute('aria-pressed', 'true')
          },
        }),
      )
    }
    body.appendChild(h('div.field-label', {}, h('span', {}, 'Farbe'), swatches))
  }

  const { footer, result, close } = openDialog({
    title: MARK_LABEL[mark.type],
    body,
    confirmLabel: 'Speichern',
  })

  footer.prepend(
    h(
      'button.button.ghost',
      {
        type: 'button',
        style: 'color:var(--danger);margin-right:auto',
        onclick: async () => {
          await session.remove(mark.id)
          close(false)
        },
      },
      h('span', { html: icon('trash', 16) }),
      'Löschen',
    ),
  )

  if (!(await result)) return

  await session.update(mark.id, {
    comment: comment.value.trim() || undefined,
    color,
  })
}
