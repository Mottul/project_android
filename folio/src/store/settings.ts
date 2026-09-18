/**
 * Settings.
 *
 * Read once at start-up into a plain object so the rest of the app can use them
 * synchronously; writes go back to IndexedDB in the background. Losing the last
 * write of a setting is not worth making every caller await.
 */

import { STORE, idbGet, idbPut } from '@/lib/idb'

export type ReaderTheme = 'hell' | 'sepia' | 'grau' | 'dunkel'
export type ViewMode = 'fortlaufend' | 'einzeln' | 'doppel'

export interface Settings {
  /** Interface theme. `system` follows the operating system. */
  appTheme: 'system' | 'hell' | 'dunkel'
  /** Page background in the reader — independent of the interface. */
  readerTheme: ReaderTheme
  viewMode: ViewMode
  /** 1 = 100 %. `fit` values are handled by the reader, not stored here. */
  zoom: number | 'breite' | 'seite'
  /** EPUB and text documents. */
  fontSize: number
  lineHeight: number
  fontFamily: 'serif' | 'sans' | 'system'
  /** Library display. */
  libraryView: 'raster' | 'liste'
  librarySort: string
  /** Last used annotation settings, so the toolbar opens where it was left. */
  highlightColor: string
  inkColor: string
  inkWidth: number
  /** Export defaults. */
  exportQuality: number
  exportDpi: number
  /** Whether the reader keeps the screen awake. */
  keepAwake: boolean
}

export const DEFAULTS: Settings = {
  appTheme: 'system',
  readerTheme: 'hell',
  viewMode: 'fortlaufend',
  zoom: 'breite',
  fontSize: 18,
  lineHeight: 1.6,
  fontFamily: 'serif',
  libraryView: 'raster',
  librarySort: 'recent',
  highlightColor: '#ffd60a',
  inkColor: '#e11d48',
  inkWidth: 0.003,
  exportQuality: 0.8,
  exportDpi: 150,
  keepAwake: false,
}

const KEY = 'settings'

let current: Settings = { ...DEFAULTS }
const listeners = new Set<(settings: Settings) => void>()

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await idbGet<Partial<Settings>>(STORE.settings, KEY)
    // Merged rather than replaced: a settings object written by an older
    // version must not remove keys added since.
    current = { ...DEFAULTS, ...(stored ?? {}) }
  } catch {
    current = { ...DEFAULTS }
  }
  mirrorTheme()
  return current
}

export function settings(): Settings {
  return current
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  if (current[key] === value) return
  current = { ...current, [key]: value }
  for (const listener of listeners) listener(current)
  void idbPut(STORE.settings, current, KEY).catch(() => undefined)
  mirrorTheme()
}

/**
 * The two settings that decide what the first frame looks like are mirrored
 * into localStorage.
 *
 * IndexedDB is asynchronous, so the real settings arrive a frame or two after
 * the document does — long enough for a white page to flash before a dark
 * theme is applied. The inline script in index.html reads these two keys
 * before the first paint; everything else waits for the database.
 */
function mirrorTheme(): void {
  try {
    localStorage.setItem('folio.theme', effectiveAppTheme())
    localStorage.setItem('folio.paper', current.readerTheme)
  } catch {
    // Private mode without storage. The flash is a cosmetic problem only.
  }
}

export function onSettingsChange(listener: (settings: Settings) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Resolves `system` against the operating system's current preference. */
export function effectiveAppTheme(): 'hell' | 'dunkel' {
  if (current.appTheme !== 'system') return current.appTheme
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'hell' : 'dunkel'
}
