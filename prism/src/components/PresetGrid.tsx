import * as Icons from 'lucide-react'
import { useMemo } from 'react'

import { PRESET_GROUP_LABEL, presetsFor, type Preset, type PresetGroup } from '@/lib/presets'
import { cx } from '@/lib/format-utils'
import { useAppStore } from '@/store/useAppStore'

/**
 * Presets, grouped by intent rather than by technical property — people arrive
 * knowing where the file is going ("this is for WhatsApp"), not which CRF they
 * want. The technical spec is still on every card, so the preset teaches the
 * controls instead of hiding them.
 */
export function PresetGrid() {
  const focusFamily = useAppStore((s) => s.focusFamily)
  const activePresetId = useAppStore((s) => s.activePresetId)
  const usePresetAction = useAppStore((s) => s.usePreset)
  const caps = useAppStore((s) => s.caps)

  const grouped = useMemo(() => {
    const map = new Map<PresetGroup, Preset[]>()
    for (const preset of presetsFor(focusFamily)) {
      if (!map.has(preset.group)) map.set(preset.group, [])
      map.get(preset.group)!.push(preset)
    }
    return [...map.entries()]
  }, [focusFamily])

  if (grouped.length === 0) {
    return <p className="text-[12px] text-faint">Für diesen Dateityp gibt es noch keine Vorlagen.</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {grouped.map(([group, presets]) => (
        <div key={group} className="flex flex-col gap-2">
          <h4 className="text-[10.5px] font-semibold tracking-[0.07em] text-faint uppercase">
            {PRESET_GROUP_LABEL[group]}
          </h4>
          <div className="grid grid-cols-2 gap-1.5">
            {presets.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                active={preset.id === activePresetId}
                // A preset needing the extended core is offered, but flagged.
                flagged={Boolean(preset.requiresCore)}
                hardware={Boolean(caps?.webcodecs)}
                onSelect={() => usePresetAction(preset.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function PresetCard({
  preset,
  active,
  flagged,
  hardware,
  onSelect,
}: {
  preset: Preset
  active: boolean
  flagged: boolean
  hardware: boolean
  onSelect: () => void
}) {
  // Icon names come from the preset table; fall back rather than crash if one
  // is ever misspelled.
  const Icon =
    (Icons as unknown as Record<string, Icons.LucideIcon>)[preset.icon] ?? Icons.Settings2

  const slowWithoutHardware = preset.video?.codec === 'av1' && !hardware

  return (
    <button
      onClick={onSelect}
      title={`${preset.hint}${slowWithoutHardware ? '\n\nHinweis: ohne Hardware-Encoder sehr langsam.' : ''}`}
      className={cx(
        'group relative flex flex-col gap-1.5 rounded-md border p-2.5 text-left',
        'transition-all duration-200 [transition-timing-function:var(--ease-prism)]',
        active
          ? 'border-accent-line bg-accent-sunk shadow-sm'
          : 'border-line-soft bg-surface-2 hover:border-line-strong hover:bg-surface-3',
      )}
    >
      <span className="flex items-center gap-1.5">
        <Icon
          size={13}
          strokeWidth={2.1}
          className={cx('shrink-0', active ? 'text-accent' : 'text-dim')}
        />
        <span
          className={cx(
            'min-w-0 truncate text-[12px] font-medium',
            active ? 'text-text' : 'text-text',
          )}
        >
          {preset.label}
        </span>
        {flagged && (
          <span
            className="ml-auto size-1.5 shrink-0 rounded-full bg-warn"
            title="Benötigt den erweiterten ffmpeg-Core"
          />
        )}
      </span>
      <span className="truncate text-[10.5px] text-faint">{preset.spec}</span>
    </button>
  )
}
