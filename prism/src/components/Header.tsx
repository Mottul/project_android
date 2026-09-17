import { Cpu, Gauge, HardDriveDownload, Moon, ShieldCheck, Sun, Terminal } from 'lucide-react'

import { formatBytes } from '@/lib/format-utils'
import { useAppStore } from '@/store/useAppStore'
import { IconButton, Pill } from './ui/controls'
import { LogoMark, Wordmark } from './ui/Logo'

/**
 * The capability pills are not decoration. They are the honest answer to
 * "why is this slow / why did my big file get refused", visible before the
 * user hits the limit rather than after.
 */
export function Header() {
  const caps = useAppStore((s) => s.caps)
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const showLog = useAppStore((s) => s.showLog)
  const setShowLog = useAppStore((s) => s.setShowLog)

  const hardware = caps?.webcodecs && caps.hardwareCodecs.length > 0
  const maxBytes = caps?.limits.hardMaxBytes ?? 0
  const maxLabel = Number.isFinite(maxBytes) ? formatBytes(maxBytes) : 'unbegrenzt'

  return (
    <header
      className="relative z-20 flex h-[var(--header-h)] shrink-0 items-center gap-3 border-b border-line-soft px-4"
      style={{ background: 'color-mix(in oklch, var(--bg) 82%, transparent)' }}
    >
      <div className="flex items-center gap-2.5">
        <LogoMark size={26} />
        <Wordmark />
      </div>

      <div className="ml-2 hidden items-center gap-1.5 lg:flex">
        <Pill
          tone="ok"
          title="Alles läuft lokal in diesem Browser. Es wird keine Datei hochgeladen — auch nicht zwischengespeichert."
        >
          <ShieldCheck size={11} strokeWidth={2.4} />
          Lokal
        </Pill>

        {caps && (
          <>
            <Pill
              tone={hardware ? 'accent' : 'neutral'}
              title={
                hardware
                  ? `Hardware-Encoder verfügbar: ${caps.hardwareCodecs.join(', ').toUpperCase()}. Diese Codecs laufen um ein Vielfaches schneller.`
                  : 'Kein Hardware-Encoder verfügbar — es wird vollständig in Software kodiert.'
              }
            >
              <Cpu size={11} strokeWidth={2.4} />
              {hardware ? caps.hardwareCodecs.join(' · ').toUpperCase() : 'Software'}
            </Pill>

            <Pill
              tone={caps.limits.threads > 1 ? 'accent' : 'warn'}
              title={
                caps.limits.threads > 1
                  ? `ffmpeg nutzt ${caps.limits.threads} Threads (SharedArrayBuffer aktiv).`
                  : 'Nur ein Thread: SharedArrayBuffer ist nicht verfügbar. Der Server muss dafür COOP/COEP-Header senden.'
              }
            >
              <Gauge size={11} strokeWidth={2.4} />
              {caps.limits.threads} {caps.limits.threads === 1 ? 'Thread' : 'Threads'}
            </Pill>

            <Pill
              tone={caps.streamingWrite ? 'accent' : 'neutral'}
              title={
                caps.streamingWrite
                  ? `Ausgabe kann direkt auf die Festplatte geschrieben werden. Maximale Dateigröße: ${maxLabel}.`
                  : `Ausgabe muss im Arbeitsspeicher gehalten werden. Maximale Dateigröße: ${maxLabel}.`
              }
            >
              <HardDriveDownload size={11} strokeWidth={2.4} />
              max {maxLabel}
            </Pill>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <IconButton
          label={showLog ? 'Protokoll schließen' : 'ffmpeg-Protokoll anzeigen'}
          onClick={() => setShowLog(!showLog)}
          className={showLog ? 'bg-surface-3 text-text' : undefined}
        >
          <Terminal size={16} strokeWidth={2} />
        </IconButton>
        <IconButton
          label={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun size={16} strokeWidth={2} /> : <Moon size={16} strokeWidth={2} />}
        </IconButton>
      </div>
    </header>
  )
}
