import { useShallow } from 'zustand/react/shallow'
import { useMemo, useState } from 'react'
import {
  ChevronDown,
  Download,
  FileAudio,
  FileImage,
  FileVideo,
  Info,
  Play,
  Square,
} from 'lucide-react'

import {
  codecsFor,
  FAMILY_VAR,
  FORMATS,
  outputFormatsFor,
  VIDEO_CODECS,
  type MediaFamily,
} from '@/lib/formats'
import { cx } from '@/lib/format-utils'
import { useAppStore, selectStats } from '@/store/useAppStore'
import type { QualityMode, ResolutionPreset } from '@/engine/types'
import { PresetGrid } from './PresetGrid'
import {
  Button,
  Field,
  NumberInput,
  Section,
  Segmented,
  Select,
  Slider,
  Toggle,
} from './ui/controls'

const FAMILY_TABS: Array<{ value: MediaFamily; label: string; icon: typeof FileVideo }> = [
  { value: 'video', label: 'Video', icon: FileVideo },
  { value: 'image', label: 'Bild', icon: FileImage },
  { value: 'audio', label: 'Audio', icon: FileAudio },
]

export function Inspector() {
  const focusFamily = useAppStore((s) => s.focusFamily)
  const setFocusFamily = useAppStore((s) => s.setFocusFamily)
  const stats = useAppStore(useShallow(selectStats))
  const startAll = useAppStore((s) => s.startAll)
  const cancelAll = useAppStore((s) => s.cancelAll)
  const downloadAll = useAppStore((s) => s.downloadAll)

  const runnable = stats.queued + stats.failed
  const busy = stats.running > 0

  return (
    <aside className="flex w-[var(--inspector-w)] shrink-0 flex-col border-l border-line-soft bg-bg">
      {/* Family switch: which set of controls is being edited. */}
      <div className="flex shrink-0 gap-0.5 border-b border-line-soft px-3 py-2">
        {FAMILY_TABS.map(({ value, label, icon: Icon }) => {
          const active = focusFamily === value
          return (
            <button
              key={value}
              onClick={() => setFocusFamily(value)}
              className={cx(
                'relative flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5',
                'text-[12px] font-medium transition-colors duration-200',
                '[transition-timing-function:var(--ease-prism)]',
                active ? 'bg-surface-2 text-text' : 'text-faint hover:text-dim',
              )}
            >
              <Icon
                size={13}
                strokeWidth={2.1}
                style={active ? { color: FAMILY_VAR[value] } : undefined}
              />
              {label}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-3 -bottom-2 h-[2px] rounded-full"
                  style={{ background: FAMILY_VAR[value] }}
                />
              )}
            </button>
          )
        })}
      </div>

      <div className="scroll-area flex-1 divide-y divide-line-soft">
        <TargetFormatSection family={focusFamily} />

        <Section title="Vorlagen">
          <PresetGrid />
        </Section>

        {focusFamily === 'video' && <VideoQuality />}
        {focusFamily === 'image' && <ImageQuality />}
        {focusFamily === 'audio' && <AudioQuality />}

        {focusFamily === 'video' && <VideoAdvanced />}
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t border-line-soft bg-surface/60 p-3">
        {busy ? (
          <Button variant="secondary" size="lg" full icon={<Square size={14} />} onClick={cancelAll}>
            Alles abbrechen
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
            {runnable === 0
              ? 'Keine Dateien in der Warteschlange'
              : `${runnable} ${runnable === 1 ? 'Datei' : 'Dateien'} konvertieren`}
          </Button>
        )}

        {stats.done > 0 && (
          <Button
            variant="secondary"
            size="md"
            full
            icon={<Download size={14} />}
            onClick={() => void downloadAll()}
          >
            {stats.done === 1
              ? 'Ergebnis herunterladen'
              : `Alle ${stats.done} als ZIP herunterladen`}
          </Button>
        )}
      </footer>
    </aside>
  )
}

/* ===========================================================================
   Target format
   ======================================================================== */

function TargetFormatSection({ family }: { family: MediaFamily }) {
  const settings = useAppStore((s) => s.settings)
  const setTargetFormat = useAppStore((s) => s.setTargetFormat)
  const patchVideo = useAppStore((s) => s.patchVideo)

  const currentId =
    family === 'image'
      ? settings.image.format
      : family === 'audio'
        ? settings.audio.format
        : settings.video.format

  const options = useMemo(() => {
    return outputFormatsFor(family).map((format) => ({
      value: format.id,
      label:
        format.availability === 'planned'
          ? `${format.label} — geplant`
          : format.availability === 'requires-core'
            ? `${format.label} — erweiterter Core`
            : format.label,
      disabled: format.availability === 'planned',
      group:
        format.family === 'video' ? 'Video' : format.family === 'audio' ? 'Audio' : 'Bild',
    }))
  }, [family])

  const format = FORMATS[currentId]
  const codecs = format ? codecsFor(format) : []
  const showCodec = family === 'video' && codecs.length > 1 && format?.family === 'video'
  const activeCodec = VIDEO_CODECS[settings.video.codec]

  return (
    <Section title="Zielformat">
      <Field label="Format">
        <Select value={currentId} options={options} onChange={setTargetFormat} />
      </Field>

      {showCodec && (
        <Field label="Codec" hint={activeCodec?.note}>
          <Select
            value={settings.video.codec}
            options={codecs.map((codec) => ({
              value: codec.id,
              label:
                codec.availability === 'requires-core'
                  ? `${codec.label} — erweiterter Core`
                  : codec.label,
            }))}
            onChange={(codec) => patchVideo({ codec })}
          />
        </Field>
      )}

      {format?.note && !showCodec && (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-faint">
          <Info size={12} className="mt-[1px] shrink-0" />
          {format.note}
        </p>
      )}
    </Section>
  )
}

/* ===========================================================================
   Quality - video
   ======================================================================== */

const QUALITY_MODES: Array<{ value: QualityMode; label: string; title: string }> = [
  {
    value: 'quality',
    label: 'Qualität',
    title: 'Konstante Qualität (CRF). Die Bitrate passt sich dem Bildinhalt an — meist die beste Wahl.',
  },
  { value: 'bitrate', label: 'Bitrate', title: 'Feste durchschnittliche Datenrate.' },
  {
    value: 'size',
    label: 'Größe',
    title: 'Auf eine Dateigröße hin rechnen. Die Bitrate wird aus der Laufzeit abgeleitet.',
  },
  { value: 'lossless', label: 'Verlustfrei', title: 'Keine Requantisierung. Große Dateien.' },
]

/** Words for a CRF value, relative to that codec's own usable range. */
function qualityWord(value: number, range: [number, number, number]): string {
  const [best, worst] = range
  const t = (value - best) / (worst - best)
  if (t <= 0.15) return 'nahezu verlustfrei'
  if (t <= 0.35) return 'sehr gut'
  if (t <= 0.6) return 'gut'
  if (t <= 0.8) return 'sichtbar komprimiert'
  return 'stark komprimiert'
}

function VideoQuality() {
  const settings = useAppStore((s) => s.settings)
  const patchVideo = useAppStore((s) => s.patchVideo)
  const v = settings.video

  const codec = VIDEO_CODECS[v.codec]
  const range = codec?.qualityRange ?? [14, 40, 23]
  const isCopy = v.codec === 'copy'

  if (isCopy) {
    return (
      <Section title="Qualität">
        <p className="flex items-start gap-1.5 rounded-md bg-surface-2 p-2.5 text-[11.5px] leading-snug text-dim">
          <Info size={12} className="mt-[1px] shrink-0 text-accent" />
          Stream Copy kodiert nicht neu — Qualität und Auflösung bleiben exakt erhalten, und die
          Konvertierung dauert nur Sekunden.
        </p>
      </Section>
    )
  }

  return (
    <Section title="Qualität">
      <Segmented
        value={v.mode}
        options={QUALITY_MODES}
        onChange={(mode) => patchVideo({ mode })}
      />

      {v.mode === 'quality' && (
        <Field
          label="Kompression"
          value={`CRF ${v.quality} · ${qualityWord(v.quality, range)}`}
          hint="Niedriger heißt besser und größer. Eine Stufe entspricht grob 10 % Dateigröße."
        >
          <Slider
            min={range[0]}
            max={range[1]}
            value={v.quality}
            onChange={(quality) => patchVideo({ quality })}
            marks={['beste Qualität', 'kleinste Datei']}
          />
        </Field>
      )}

      {v.mode === 'bitrate' && (
        <Field label="Videobitrate" hint="Durchschnitt über die gesamte Laufzeit.">
          <NumberInput
            value={v.bitrateKbps}
            min={100}
            max={200_000}
            suffix="kbit/s"
            onChange={(bitrateKbps) => patchVideo({ bitrateKbps })}
          />
        </Field>
      )}

      {v.mode === 'size' && (
        <Field
          label="Zielgröße"
          hint="Die Videobitrate wird aus Laufzeit und Tonspur zurückgerechnet. Zweipass empfohlen."
        >
          <NumberInput
            value={v.targetSizeMB}
            min={1}
            max={50_000}
            suffix="MB"
            onChange={(targetSizeMB) => patchVideo({ targetSizeMB })}
          />
        </Field>
      )}

      {v.mode === 'lossless' && (
        <p className="text-[11.5px] leading-snug text-faint">
          Der gewählte Codec schreibt in seiner verlustfreien Betriebsart. Bei HAP und ProRes ist
          das der Normalfall.
        </p>
      )}

      <ResolutionControls />
    </Section>
  )
}

const RESOLUTION_OPTIONS: Array<{ value: ResolutionPreset; label: string }> = [
  { value: 'source', label: 'Wie Quelle' },
  { value: '2160p', label: '2160p — 4K UHD' },
  { value: '1440p', label: '1440p — QHD' },
  { value: '1080p', label: '1080p — Full HD' },
  { value: '720p', label: '720p — HD' },
  { value: '480p', label: '480p — SD' },
  { value: '360p', label: '360p' },
  { value: 'custom', label: 'Eigene Maße…' },
]

function ResolutionControls() {
  const settings = useAppStore((s) => s.settings)
  const patchVideo = useAppStore((s) => s.patchVideo)
  const v = settings.video

  return (
    <>
      <Field
        label="Auflösung"
        hint={
          v.resolution !== 'source' && v.resolution !== 'custom'
            ? 'Kleinere Quellen werden nicht hochskaliert.'
            : undefined
        }
      >
        <Select
          value={v.resolution}
          options={RESOLUTION_OPTIONS}
          onChange={(resolution) => patchVideo({ resolution: resolution as ResolutionPreset })}
        />
      </Field>

      {v.resolution === 'custom' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Breite">
              <NumberInput
                value={v.customWidth}
                min={2}
                max={16384}
                suffix="px"
                onChange={(customWidth) => patchVideo({ customWidth })}
              />
            </Field>
            <Field label="Höhe">
              <NumberInput
                value={v.customHeight}
                min={2}
                max={16384}
                suffix="px"
                onChange={(customHeight) => patchVideo({ customHeight })}
              />
            </Field>
          </div>
          <Field label="Anpassung">
            <Segmented
              size="sm"
              value={v.fit}
              options={[
                { value: 'contain', label: 'Einpassen', title: 'Vollständig sichtbar, mit schwarzen Balken.' },
                { value: 'cover', label: 'Füllen', title: 'Bildfüllend, Überstand wird beschnitten.' },
                { value: 'stretch', label: 'Verzerren', title: 'Auf die Maße gestreckt.' },
              ]}
              onChange={(fit) => patchVideo({ fit })}
            />
          </Field>
        </>
      )}
    </>
  )
}

/* ===========================================================================
   Quality - image
   ======================================================================== */

function ImageQuality() {
  const settings = useAppStore((s) => s.settings)
  const patchImage = useAppStore((s) => s.patchImage)
  const i = settings.image
  const format = FORMATS[i.format]
  const supportsLossless = Boolean(format?.lossless) || i.format === 'webp'

  return (
    <Section title="Qualität & Größe">
      {format?.id !== 'ico' && (
        <>
          {supportsLossless && (
            <Toggle
              checked={i.lossless}
              onChange={(lossless) => patchImage({ lossless })}
              label="Verlustfrei"
              hint="Größere Datei, mathematisch identisches Bild."
            />
          )}

          {!i.lossless && (
            <Field
              label="Qualität"
              value={`${i.quality}`}
              hint={
                i.quality >= 92
                  ? 'Über 92 wächst die Datei deutlich, ohne sichtbar besser zu werden.'
                  : i.quality < 60
                    ? 'Unter 60 werden Artefakte an Kanten sichtbar.'
                    : undefined
              }
            >
              <Slider
                min={1}
                max={100}
                value={i.quality}
                onChange={(quality) => patchImage({ quality })}
                marks={['kleinste Datei', 'beste Qualität']}
              />
            </Field>
          )}
        </>
      )}

      <Field label="Skalierung">
        <Segmented
          size="sm"
          value={i.resizeMode}
          options={[
            { value: 'none', label: 'Original' },
            { value: 'fit', label: 'Einpassen' },
            { value: 'fill', label: 'Füllen' },
            { value: 'percent', label: 'Prozent' },
          ]}
          onChange={(resizeMode) => patchImage({ resizeMode })}
        />
      </Field>

      {(i.resizeMode === 'fit' || i.resizeMode === 'fill') && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Breite">
              <NumberInput
                value={i.width}
                min={1}
                max={32768}
                suffix="px"
                onChange={(width) => patchImage({ width })}
              />
            </Field>
            <Field label="Höhe">
              <NumberInput
                value={i.height}
                min={1}
                max={32768}
                suffix="px"
                onChange={(height) => patchImage({ height })}
              />
            </Field>
          </div>
          {i.resizeMode === 'fit' && (
            <Toggle
              checked={i.noUpscale}
              onChange={(noUpscale) => patchImage({ noUpscale })}
              label="Nicht vergrößern"
              hint="Kleinere Bilder bleiben, wie sie sind."
            />
          )}
        </>
      )}

      {i.resizeMode === 'percent' && (
        <Field label="Maßstab" value={`${i.percent} %`}>
          <Slider
            min={5}
            max={400}
            step={5}
            value={i.percent}
            onChange={(percent) => patchImage({ percent })}
            marks={['5 %', '400 %']}
          />
        </Field>
      )}

      <Toggle
        checked={i.stripMetadata}
        onChange={(stripMetadata) => patchImage({ stripMetadata })}
        label="Metadaten entfernen"
        hint="Löscht EXIF, also auch GPS-Position und Kameramodell."
      />
    </Section>
  )
}

/* ===========================================================================
   Quality - audio
   ======================================================================== */

function AudioQuality() {
  const settings = useAppStore((s) => s.settings)
  const patchAudio = useAppStore((s) => s.patchAudio)
  const a = settings.audio
  const format = FORMATS[a.format]

  return (
    <Section title="Qualität">
      {format?.lossless ? (
        <p className="flex items-start gap-1.5 rounded-md bg-surface-2 p-2.5 text-[11.5px] leading-snug text-dim">
          <Info size={12} className="mt-[1px] shrink-0 text-accent" />
          {format.label} speichert verlustfrei — eine Bitrate gibt es hier nicht.
        </p>
      ) : (
        <Field label="Bitrate" hint="128 kbit/s reichen für Musik meist aus, 64 für Sprache.">
          <NumberInput
            value={a.bitrateKbps}
            min={8}
            max={640}
            suffix="kbit/s"
            onChange={(bitrateKbps) => patchAudio({ bitrateKbps })}
          />
        </Field>
      )}

      <Field label="Kanäle">
        <Segmented
          size="sm"
          value={String(a.channels)}
          options={[
            { value: '0', label: 'Wie Quelle' },
            { value: '1', label: 'Mono' },
            { value: '2', label: 'Stereo' },
          ]}
          onChange={(channels) => patchAudio({ channels: Number(channels) as 0 | 1 | 2 })}
        />
      </Field>

      <Toggle
        checked={a.normalize}
        onChange={(normalize) => patchAudio({ normalize })}
        label="Lautheit angleichen"
        hint="Hebt leise Passagen an. Für Sprachaufnahmen sinnvoll, für Musik selten."
      />
    </Section>
  )
}

/* ===========================================================================
   Advanced - video
   ======================================================================== */

const SPEED_HINT =
  'Langsamer heißt kleinere Datei bei gleicher Qualität — nicht besseres Bild. ' +
  'Von "medium" auf "slow" kostet etwa doppelte Rechenzeit für rund 5 % Ersparnis.'

function VideoAdvanced() {
  const [open, setOpen] = useState(false)
  const settings = useAppStore((s) => s.settings)
  const patchVideo = useAppStore((s) => s.patchVideo)
  const caps = useAppStore((s) => s.caps)
  const v = settings.video
  const isHap = v.codec.startsWith('hap')
  const isCopy = v.codec === 'copy'

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
          Erweitert
        </span>
        <ChevronDown
          size={14}
          className={cx(
            'text-faint transition-transform duration-200',
            '[transition-timing-function:var(--ease-prism)]',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-3.5 px-4 pb-4">
          <Field label="Bildrate">
            <Select
              value={String(v.fps)}
              options={[
                { value: '0', label: 'Wie Quelle' },
                { value: '60', label: '60 fps' },
                { value: '50', label: '50 fps' },
                { value: '30', label: '30 fps' },
                { value: '25', label: '25 fps' },
                { value: '24', label: '24 fps — Kino' },
                { value: '15', label: '15 fps' },
              ]}
              onChange={(fps) => patchVideo({ fps: Number(fps) })}
            />
          </Field>

          {!isCopy && !isHap && (
            <Field label="Encoder-Tempo" hint={SPEED_HINT}>
              <Select
                value={v.speed}
                options={[
                  { value: 'ultrafast', label: 'Sehr schnell' },
                  { value: 'veryfast', label: 'Schnell' },
                  { value: 'fast', label: 'Zügig' },
                  { value: 'medium', label: 'Ausgewogen' },
                  { value: 'slow', label: 'Langsam' },
                  { value: 'veryslow', label: 'Sehr langsam' },
                ]}
                onChange={(speed) => patchVideo({ speed: speed as typeof v.speed })}
              />
            </Field>
          )}

          {isHap && (
            <Field
              label="HAP-Chunks"
              value={String(v.hapChunks)}
              hint="Teilt jedes Bild auf, damit der Medienserver es beim Abspielen über mehrere Kerne dekodieren kann. 4 ist üblich."
            >
              <Slider
                min={1}
                max={8}
                value={v.hapChunks}
                onChange={(hapChunks) => patchVideo({ hapChunks })}
                marks={['1', '8']}
              />
            </Field>
          )}

          {!isCopy && (
            <Field label="Tonspur">
              <Select
                value={v.audioCodec}
                options={[
                  { value: 'aac', label: 'AAC' },
                  { value: 'mp3', label: 'MP3' },
                  { value: 'opus', label: 'Opus' },
                  { value: 'flac', label: 'FLAC — verlustfrei' },
                  { value: 'pcm', label: 'PCM — unkomprimiert' },
                  { value: 'copy', label: 'Unverändert übernehmen' },
                  { value: 'none', label: 'Kein Ton' },
                ]}
                onChange={(audioCodec) => patchVideo({ audioCodec })}
              />
            </Field>
          )}

          <Toggle
            checked={v.twoPass}
            onChange={(twoPass) => patchVideo({ twoPass })}
            label="Zweipass-Kodierung"
            hint="Wirkt nur bei Bitraten- oder Zielgrößen-Modus. Verdoppelt die Rechenzeit, trifft die Zielgröße aber genau."
          />

          <Toggle
            checked={v.faststart}
            onChange={(faststart) => patchVideo({ faststart })}
            label="Faststart"
            hint="Verschiebt den Index an den Dateianfang. Nötig, damit ein Video im Browser sofort startet."
          />

          <Toggle
            checked={v.stripMetadata}
            onChange={(stripMetadata) => patchVideo({ stripMetadata })}
            label="Metadaten entfernen"
            hint="Entfernt Kameradaten, Aufnahmeort und Software-Signaturen."
          />

          {caps && !caps.sharedArrayBuffer && (
            <p className="rounded-md bg-warn/10 p-2.5 text-[11px] leading-snug text-warn">
              Nur ein Thread aktiv. Für Mehrkern-Kodierung muss der Server die Header
              <code className="mx-1 font-mono text-[10.5px]">Cross-Origin-Opener-Policy</code>
              und
              <code className="mx-1 font-mono text-[10.5px]">Cross-Origin-Embedder-Policy</code>
              senden.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
