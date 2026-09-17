/**
 * Service worker registration.
 *
 * Registered by hand rather than by vite-plugin-pwa's generated snippet,
 * because the isolation workaround needs one controlled reload: on the very
 * first visit the document is fetched before any worker exists, so it arrives
 * without COOP/COEP and `crossOriginIsolated` is false. Once the worker is in
 * control, a single reload re-fetches the document *through* the worker, which
 * attaches the headers — and `SharedArrayBuffer` becomes available.
 *
 * In development the dev server sends the headers itself, so none of this runs.
 */

/** Guards against a reload loop on hosts where isolation is impossible. */
const RELOAD_FLAG = 'prism.coi-reload'

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    void (async () => {
      try {
        // Scope stays inside this app's folder, so the other PWAs in the
        // repository keep their own workers untouched.
        const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' })

        if (globalThis.crossOriginIsolated) {
          // Isolation achieved — either the host sends the headers itself or
          // our earlier reload worked. Clear the guard for the next session.
          sessionStorage.removeItem(RELOAD_FLAG)
          return
        }

        // Reload at most once per session. If the page is still not isolated
        // afterwards, the host genuinely cannot provide it and Prism carries on
        // single-threaded — capabilities.ts already reports that honestly.
        if (sessionStorage.getItem(RELOAD_FLAG)) return

        const activating = registration.installing ?? registration.waiting
        if (registration.active && navigator.serviceWorker.controller) {
          // Controlled but still not isolated: nothing more a reload can fix.
          return
        }

        const reloadOnce = () => {
          try {
            sessionStorage.setItem(RELOAD_FLAG, '1')
          } catch {
            // Private mode without storage: skip the reload rather than risk a
            // loop we cannot detect.
            return
          }
          window.location.reload()
        }

        if (registration.active && !navigator.serviceWorker.controller) {
          reloadOnce()
          return
        }

        activating?.addEventListener('statechange', function onChange() {
          if ((this as ServiceWorker).state === 'activated') {
            activating.removeEventListener('statechange', onChange)
            reloadOnce()
          }
        })
      } catch {
        // No service worker means no offline mode and no isolation. The app
        // still works; it just runs on the single-threaded core.
      }
    })()
  })
}
