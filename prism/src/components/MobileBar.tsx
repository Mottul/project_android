import { useShallow } from 'zustand/react/shallow'
import { Download, Play, Plus, Settings2, Square } from 'lucide-react'

import { FORMATS } from '@/lib/formats'
import { cx } from '@/lib/format-utils'
import { useAppStore, selectStats } from '@/store/useAppStore'
import { Button } from './ui/controls'
import { useFilePicker } from './ui/FilePicker'

/**
 * The phone's answer to the inspector footer.
 *
 * Everything a run needs is one thumb away and always on screen: add a file,
 * open the settings sheet, start the conversion. It replaces the status bar
 * below the sidebar breakpoint — a row of statistics is not worth 30px of a
 * landscape phone, and the queue header carries the same counts.
 */
export function MobileBar() {
  const stats = useAppStore(useShallow(selectStats))
  const jobs = useAppStore((s) => s.jobs)
  const settings = useAppStore((s) => s.settings)
  const focusFamily = useAppStore((s) => s.focusFamily)
  const setInspectorOpen = useAppStore((s) => s.setInspectorOpen)
  const startAll = useAppStore((s) => s.startAll)
  const cancelAll = useAppStore((s) => s.cancelAll)
  const downloadAll = useAppStore((s) => s.downloadAll)
  const { input, open: openPicker } = useFilePicker()

  const runnable = stats.queued + stats.failed
  const busy = stats.running > 0
  const empty = jobs.length === 0

  const targetId =
    focusFamily === 'image'
      ? settings.image.format
      : focusFamily === 'audio'
        ? settings.audio.format
        : settings.video.format
  const targetLabel = FORMATS[targetId]?.label ?? 'Einstellungen'

  return (
    <footer className="pad-safe-b relative z-20 shrink-0 border-t border-line-soft bg-bg">
      {input}
      <div className="flex items-center gap-2 px-3 py-2">
        {!empty && (
          <Button
            variant="secondary"
            size="lg"
            aria-label="Dateien hinzufügen"
            title="Dateien hinzufügen"
            className="shrink-0"
            // Inline, because a `px-0` utility and the size's own `px-5` land in
            // the same layer and the winner is whichever Tailwind emits last.
            style={{ width: '2.75rem', paddingInline: 0 }}
            onClick={openPicker}
          >
            <Plus size={18} strokeWidth={2.4} />
          </Button>
        )}

        <Button
          variant="secondary"
          size="lg"
          className={cx('shrink-0', empty ? 'px-4' : 'px-3')}
          icon={<Settings2 size={16} />}
          onClick={() => setInspectorOpen(true)}
        >
          <span className="max-w-[6rem] truncate">{targetLabel}</span>
        </Button>

        {busy ? (
          <Button variant="secondary" size="lg" full icon={<Square size={14} />} onClick={cancelAll}>
            Abbrechen
          </Button>
        ) : empty ? (
          <Button variant="primary" size="lg" full icon={<Plus size={16} strokeWidth={2.4} />} onClick={openPicker}>
            Dateien wählen
          </Button>
        ) : runnable === 0 && stats.done > 0 ? (
          <Button
            variant="primary"
            size="lg"
            full
            icon={<Download size={15} />}
            onClick={() => void downloadAll()}
          >
            {stats.done === 1 ? 'Herunterladen' : `Alle ${stats.done} laden`}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            full
            icon={<Play size={15} strokeWidth={2.4} />}
            disabled={runnable === 0}
            onClick={startAll}
          >
            {runnable === 0 ? 'Nichts zu tun' : `${runnable} konvertieren`}
          </Button>
        )}
      </div>
    </footer>
  )
}
