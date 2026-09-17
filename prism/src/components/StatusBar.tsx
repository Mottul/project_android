import { useShallow } from 'zustand/react/shallow'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { cx, formatBytes, formatSizeDelta } from '@/lib/format-utils'
import { useAppStore, selectStats } from '@/store/useAppStore'
import { IconButton } from './ui/controls'

export function StatusBar() {
  const stats = useAppStore(useShallow(selectStats))
  const caps = useAppStore((s) => s.caps)

  const delta = stats.bytesOut > 0 ? formatSizeDelta(stats.bytesIn, stats.bytesOut) : null

  return (
    <footer className="flex h-[var(--status-h)] shrink-0 items-center gap-3 border-t border-line-soft bg-bg px-4 text-[11px] text-faint">
      <span className="flex items-center gap-1.5">
        <span
          className={cx(
            'size-1.5 rounded-full',
            stats.running > 0 ? 'animate-breathe bg-accent' : 'bg-line-strong',
          )}
        />
        {stats.running > 0
          ? `${stats.running} ${stats.running === 1 ? 'Datei' : 'Dateien'} in Arbeit`
          : 'Bereit'}
      </span>

      {stats.total > 0 && (
        <>
          <Divider />
          <span className="tnum">
            {stats.done} fertig · {stats.queued} wartend
            {stats.failed > 0 && <span className="text-danger"> · {stats.failed} fehlgeschlagen</span>}
          </span>
        </>
      )}

      {stats.bytesOut > 0 && (
        <>
          <Divider />
          <span className="tnum">
            {formatBytes(stats.bytesIn)} → {formatBytes(stats.bytesOut)}
          </span>
          {delta && (
            <span className={cx('tnum font-medium', delta.better ? 'text-ok' : 'text-warn')}>
              {delta.text}
            </span>
          )}
        </>
      )}

      <span className="ml-auto hidden items-center gap-3 md:flex">
        {caps?.isInstalled && <span>Installiert</span>}
        <span className="font-mono text-[10px] tracking-tight">
          {caps?.cores ?? '?'} Kerne
          {caps?.deviceMemory ? ` · ${caps.deviceMemory} GB RAM` : ''}
        </span>
      </span>
    </footer>
  )
}

function Divider() {
  return <span className="h-3 w-px bg-line" />
}

/**
 * The raw ffmpeg output. Hidden by default, but the first thing anyone needs
 * when a conversion fails for a reason the friendly message did not cover.
 */
export function LogPanel() {
  const log = useAppStore((s) => s.log)
  const showLog = useAppStore((s) => s.showLog)
  const setShowLog = useAppStore((s) => s.setShowLog)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showLog) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log, showLog])

  if (!showLog) return null

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-line bg-surface-sunk">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line-soft px-3">
        <span className="text-[11px] font-semibold tracking-wide text-dim uppercase">
          ffmpeg-Protokoll
        </span>
        <span className="tnum text-[10.5px] text-faint">{log.length} Zeilen</span>
        <IconButton label="Protokoll schließen" className="ml-auto" onClick={() => setShowLog(false)}>
          <X size={14} />
        </IconButton>
      </div>
      <div ref={scrollRef} className="scroll-area flex-1 px-3 py-2">
        {log.length === 0 ? (
          <p className="text-[11.5px] text-faint">
            Noch keine Ausgabe. Das Protokoll füllt sich, sobald eine Video- oder Audiodatei
            konvertiert wird.
          </p>
        ) : (
          <pre className="font-mono text-[10.5px] leading-[1.5] whitespace-pre-wrap text-dim">
            {log.join('\n')}
          </pre>
        )}
      </div>
    </div>
  )
}
