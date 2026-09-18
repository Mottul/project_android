/**
 * Service worker registration.
 *
 * Registered by hand rather than through the plugin's generated snippet so the
 * scope stays `./` — this repository hosts several apps side by side under one
 * origin, and a worker that claimed the parent path would intercept all of
 * them.
 *
 * Updates are applied on the next visit rather than forced: reloading a reader
 * out from under someone who is annotating a document would lose the gesture
 * they are in the middle of, and the annotations themselves are already safe in
 * IndexedDB either way.
 */

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((error) => {
      console.warn('[Folio] Service Worker konnte nicht registriert werden:', error)
    })
  })
}
