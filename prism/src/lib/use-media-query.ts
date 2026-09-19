import { useCallback, useSyncExternalStore } from 'react'

/**
 * Media queries are shared per query string: a `MediaQueryList` is cheap but
 * not free, and `useSyncExternalStore` calls the snapshot on every render.
 */
const cache = new Map<string, MediaQueryList>()

function listFor(query: string): MediaQueryList {
  let list = cache.get(query)
  if (!list) {
    list = window.matchMedia(query)
    cache.set(query, list)
  }
  return list
}

/**
 * Layout decisions that cannot be expressed as a CSS class — mounting the
 * inspector as a sidebar versus as a sheet, for instance, where rendering both
 * and hiding one would run the whole control tree twice.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = listFor(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )

  return useSyncExternalStore(
    subscribe,
    () => listFor(query).matches,
    () => false,
  )
}

/** The one breakpoint that changes the shell: sidebar or sheet. */
export const DESKTOP_QUERY = '(min-width: 1024px)'
