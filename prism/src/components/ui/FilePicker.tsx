import { useCallback, useRef } from 'react'

import { acceptAttribute } from '@/lib/formats'
import { useAppStore } from '@/store/useAppStore'

/**
 * A single hidden file input plus the function that opens it.
 *
 * It exists as a hook because the picker is now reachable from two places —
 * the drop zone and the mobile action bar — and a phone has no drag, no
 * clipboard shortcut and no "Open with" for a browser tab, so the button is
 * the only way in.
 */
export function useFilePicker() {
  const addFiles = useAppStore((s) => s.addFiles)
  const ref = useRef<HTMLInputElement>(null)

  const open = useCallback(() => ref.current?.click(), [])

  const input = (
    <input
      ref={ref}
      type="file"
      multiple
      accept={acceptAttribute()}
      className="hidden"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? [])
        if (files.length > 0) addFiles(files)
        // Reset so picking the same file twice still fires a change event.
        e.target.value = ''
      }}
    />
  )

  return { input, open }
}
