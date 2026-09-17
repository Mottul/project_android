import { useCallback, useEffect, useRef, useState } from 'react'
import { FileAudio, FileImage, FileVideo, FolderOpen, Plus } from 'lucide-react'

import { acceptedExtensions } from '@/lib/formats'
import { cx } from '@/lib/format-utils'
import { useAppStore } from '@/store/useAppStore'
import { Button } from './ui/controls'
import { LogoMark } from './ui/Logo'

/**
 * File intake.
 *
 * Drag state is tracked with a counter rather than a boolean: dragenter and
 * dragleave both fire when the pointer crosses a child element, so a naive
 * boolean flickers the whole time the user moves across the zone.
 */
function useWindowDrag(onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      depth.current += 1
      setDragging(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      // Without both of these the browser navigates to the dropped file.
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = () => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length > 0) onFiles(files)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [onFiles])

  return dragging
}

export function DropZone({ compact }: { compact: boolean }) {
  const addFiles = useAppStore((s) => s.addFiles)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback((files: File[]) => addFiles(files), [addFiles])
  const dragging = useWindowDrag(handleFiles)

  // Pasting a screenshot straight into the app is the fastest path there is.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length > 0) {
        e.preventDefault()
        handleFiles(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [handleFiles])

  const openPicker = () => inputRef.current?.click()

  const input = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept={acceptedExtensions().join(',')}
      className="hidden"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? [])
        if (files.length > 0) handleFiles(files)
        // Reset so picking the same file twice still fires a change event.
        e.target.value = ''
      }}
    />
  )

  if (compact) {
    return (
      <>
        {input}
        <button
          onClick={openPicker}
          className={cx(
            'group flex w-full items-center gap-3 rounded-lg border border-dashed px-4 py-3',
            'transition-all duration-200 [transition-timing-function:var(--ease-prism)]',
            dragging
              ? 'border-accent bg-accent-sunk/50 shadow-md'
              : 'border-line hover:border-accent-line hover:bg-surface-2',
          )}
        >
          <span
            className={cx(
              'grid size-8 place-items-center rounded-md transition-colors duration-200',
              dragging ? 'bg-accent text-on-accent' : 'bg-surface-2 text-dim group-hover:text-accent',
            )}
          >
            <Plus size={16} strokeWidth={2.4} />
          </span>
          <span className="text-[13px] font-medium text-dim group-hover:text-text">
            {dragging ? 'Loslassen zum Hinzufügen' : 'Weitere Dateien hinzufügen'}
          </span>
          <span className="ml-auto hidden text-[11px] text-faint sm:inline">
            Ziehen, klicken oder einfügen
          </span>
        </button>
      </>
    )
  }

  return (
    <>
      {input}
      <div
        className={cx(
          'relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-xl',
          'border border-dashed transition-all duration-300',
          '[transition-timing-function:var(--ease-prism)]',
          dragging
            ? 'border-accent bg-accent-sunk/40 shadow-pop'
            : 'border-line bg-surface/40 hover:border-line-strong',
        )}
      >
        {/* A soft spotlight that only appears while dragging. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-opacity duration-300"
          style={{
            opacity: dragging ? 1 : 0,
            background:
              'radial-gradient(38rem 24rem at 50% 42%, color-mix(in oklch, var(--accent) 18%, transparent), transparent 70%)',
          }}
        />

        <div className="relative flex flex-col items-center gap-6 px-8 py-12 text-center">
          <div
            className={cx(
              'transition-transform duration-500 [transition-timing-function:var(--ease-prism)]',
              dragging ? 'scale-110' : 'scale-100',
            )}
          >
            <LogoMark size={64} className="text-text" />
          </div>

          <div className="flex flex-col items-center gap-2">
            <h2 className="text-[22px] font-semibold tracking-[-0.015em] text-text">
              {dragging ? 'Jetzt loslassen' : 'Dateien hierher ziehen'}
            </h2>
            <p className="max-w-[34rem] text-[13.5px] leading-relaxed text-dim">
              Video, Bild und Audio in jedes gängige Format — vollständig auf diesem Gerät
              berechnet. Nichts wird hochgeladen.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="primary" size="lg" icon={<FolderOpen size={16} />} onClick={openPicker}>
              Dateien auswählen
            </Button>
            <span className="px-1 text-[12px] text-faint">oder Strg + V</span>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <FamilyHint icon={<FileVideo size={13} />} color="var(--fam-video)" label="MP4 · MOV · WebM · MKV · GIF · HAP" />
            <FamilyHint icon={<FileImage size={13} />} color="var(--fam-image)" label="JPEG · PNG · WebP · AVIF · TIFF · ICO" />
            <FamilyHint icon={<FileAudio size={13} />} color="var(--fam-audio)" label="MP3 · AAC · Opus · FLAC · WAV" />
          </div>
        </div>
      </div>
    </>
  )
}

function FamilyHint({
  icon,
  color,
  label,
}: {
  icon: React.ReactNode
  color: string
  label: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-faint">
      <span style={{ color }}>{icon}</span>
      {label}
    </span>
  )
}
