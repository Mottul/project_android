/**
 * The settings block.
 *
 * Returned as an element rather than opened as its own dialog, so it can sit
 * underneath the source list in the library's management sheet — settings and
 * sources are the same kind of question ("how is Folio set up for me") and
 * splitting them across two dialogs would mean two trips.
 */

import { h } from '@/lib/dom'
import { formatBytes } from '@/lib/format'
import { storageEstimate } from '@/lib/idb'
import { settings, setSetting, type ReaderTheme, type Settings } from '@/store/settings'

export async function openSettings(): Promise<HTMLElement> {
  const group = h('div.settings-group')
  group.appendChild(h('h3', {}, 'Darstellung'))

  group.appendChild(
    row(
      'Oberfläche',
      segmented<Settings['appTheme']>(
        [
          ['system', 'System'],
          ['hell', 'Hell'],
          ['dunkel', 'Dunkel'],
        ],
        settings().appTheme,
        (value) => setSetting('appTheme', value),
      ),
    ),
  )

  group.appendChild(
    row(
      'Seitenhintergrund',
      segmented<ReaderTheme>(
        [
          ['hell', 'Weiß'],
          ['sepia', 'Sepia'],
          ['grau', 'Grau'],
          ['dunkel', 'Dunkel'],
        ],
        settings().readerTheme,
        (value) => {
          setSetting('readerTheme', value)
          document.documentElement.dataset.paper = value
        },
      ),
    ),
  )

  group.appendChild(
    row(
      'Schrift in EPUB und Text',
      segmented<Settings['fontFamily']>(
        [
          ['serif', 'Serif'],
          ['sans', 'Sans'],
        ],
        settings().fontFamily,
        (value) => setSetting('fontFamily', value),
      ),
    ),
  )

  const keepAwake = h('input', {
    type: 'checkbox',
    checked: settings().keepAwake,
    onchange: (event: Event) =>
      setSetting('keepAwake', (event.target as HTMLInputElement).checked),
  })
  group.appendChild(
    h(
      'label.switch-row',
      {},
      keepAwake,
      h(
        'span',
        {},
        'Bildschirm beim Lesen anlassen',
        h('span.hint', {}, 'Verhindert, dass das Gerät während des Lesens abdunkelt.'),
      ),
    ),
  )

  group.appendChild(h('h3', { style: 'margin-top:8px' }, 'Speicher'))
  group.appendChild(await storageRow())

  group.appendChild(
    h(
      'p',
      { style: 'font-size:0.82rem;color:var(--text-faint);margin-top:4px' },
      'Folio arbeitet ausschließlich auf diesem Gerät. Es gibt kein Konto, keinen Server und keinen Upload — ' +
        'Dokumente werden dort gelesen, wo sie liegen.',
    ),
  )

  return group
}

function row(label: string, control: HTMLElement): HTMLElement {
  return h('div.settings-row', {}, h('span', {}, label), control)
}

function segmented<T extends string>(
  options: [T, string][],
  current: T,
  onChange: (value: T) => void,
): HTMLElement {
  const wrapper = h('div.segmented')

  for (const [value, label] of options) {
    wrapper.appendChild(
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(value === current),
          onclick: (event: Event) => {
            for (const button of wrapper.querySelectorAll('button')) {
              button.setAttribute('aria-pressed', 'false')
            }
            ;(event.currentTarget as HTMLElement).setAttribute('aria-pressed', 'true')
            onChange(value)
          },
        },
        label,
      ),
    )
  }

  return wrapper
}

/**
 * How much of the browser's quota Folio uses.
 *
 * Worth showing because the number is not obvious: a library built from folder
 * handles takes almost nothing, while the same library built from imported
 * copies takes as much as the documents themselves.
 */
async function storageRow(): Promise<HTMLElement> {
  const estimate = await storageEstimate()
  if (!estimate) {
    return h('p', { style: 'font-size:0.85rem;color:var(--text-dim)' },
      'Der Browser gibt keine Auskunft über den belegten Speicher.')
  }

  const share = estimate.quota ? estimate.usage / estimate.quota : 0
  return h(
    'div.estimate',
    {},
    h(
      'div',
      {},
      h('div.value', {}, formatBytes(estimate.usage)),
      h('div.note', {}, estimate.quota ? `von etwa ${formatBytes(estimate.quota)} verfügbar` : 'belegt'),
    ),
    h('div.note', {}, share > 0 ? `${(share * 100).toFixed(1).replace('.', ',')} %` : ''),
  )
}
