/**
 * Service worker registration.
 *
 * Registered by hand rather than by vite-plugin-pwa's generated snippet,
 * because the isolation workaround needs one controlled reload: on the very
 * first visit the document is fetched before any worker exists, so it arrives
 * without COOP/COEP and `crossOriginIsolated` is false. Re-fetching the
 * document *through* the worker attaches the headers — and `SharedArrayBuffer`
 * becomes available.
 *
 * In development the dev server sends the headers itself, so none of this runs.
 */

/** Guards against a reload loop on hosts where isolation is impossible. */
const RELOAD_FLAG = 'prism.coi-reload'

export interface IsolationState {
  /** `crossOriginIsolated` — the only thing that actually matters. */
  isolated: boolean
  /** A reload was already spent this session. */
  alreadyReloaded: boolean
  /** The registration has an activated worker. */
  hasActiveWorker: boolean
  /** A worker is installing or waiting and may still become active. */
  hasPendingWorker: boolean
}

export type IsolationAction =
  /** Nothing to do — either isolated already or out of options. */
  | 'none'
  /** A worker is active; re-fetch the document through it. */
  | 'reload'
  /** Wait for the pending worker to activate, then reload. */
  | 'wait-then-reload'

/**
 * Decide what to do about a page that is not cross-origin isolated.
 *
 * Deliberately does *not* consider `navigator.serviceWorker.controller`. Being
 * controlled is not the same as being isolated: `clients.claim()` takes control
 * of the very first, header-less page too. Treating "controlled" as "done" was
 * a real bug — it skipped exactly the reload that creates the isolation.
 */
export function decideIsolationAction(state: IsolationState): IsolationAction {
  if (state.isolated) return 'none'
  if (state.alreadyReloaded) return 'none'
  if (state.hasActiveWorker) return 'reload'
  if (state.hasPendingWorker) return 'wait-then-reload'
  return 'none'
}

/** Resolves once the registration has an activated worker, or gives up. */
function whenActivated(registration: ServiceWorkerRegistration): Promise<boolean> {
  if (registration.active) return Promise.resolve(true)

  const pending = registration.installing ?? registration.waiting
  if (!pending) return Promise.resolve(false)

  return new Promise((resolve) => {
    const onChange = () => {
      if (pending.state === 'activated') {
        pending.removeEventListener('statechange', onChange)
        resolve(true)
      } else if (pending.state === 'redundant') {
        pending.removeEventListener('statechange', onChange)
        resolve(false)
      }
    }
    pending.addEventListener('statechange', onChange)
  })
}

function reloadOnce(): void {
  try {
    sessionStorage.setItem(RELOAD_FLAG, '1')
  } catch {
    // Private mode without storage: skip the reload rather than risk a loop we
    // cannot detect.
    return
  }
  window.location.reload()
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    void (async () => {
      try {
        // Scope stays inside this app's folder, so the other PWAs in the
        // repository keep their own workers untouched.
        const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' })

        const action = decideIsolationAction({
          isolated: globalThis.crossOriginIsolated === true,
          alreadyReloaded: sessionStorage.getItem(RELOAD_FLAG) !== null,
          hasActiveWorker: registration.active !== null,
          hasPendingWorker: (registration.installing ?? registration.waiting) !== null,
        })

        if (globalThis.crossOriginIsolated) {
          // Clear the guard so a later session can try again if it ever needs to.
          try {
            sessionStorage.removeItem(RELOAD_FLAG)
          } catch {
            /* no storage */
          }
          return
        }

        if (action === 'reload') {
          reloadOnce()
          return
        }

        if (action === 'wait-then-reload') {
          if (await whenActivated(registration)) reloadOnce()
          return
        }

        // Out of options: the app runs single-threaded. Say why, once, so the
        // difference between "not isolated" and "broken" is visible.
        reportFailure(registration)
      } catch (error) {
        console.warn('[Prism] Service Worker konnte nicht registriert werden:', error)
      }
    })()
  })
}

/**
 * One diagnostic line when isolation could not be achieved. Only logged in the
 * failing case, and only after a reload was already spent — so it never shows
 * up on a healthy load.
 */
function reportFailure(registration: ServiceWorkerRegistration): void {
  if (globalThis.crossOriginIsolated) return

  console.warn(
    '[Prism] Ohne Cross-Origin-Isolation — ffmpeg läuft einthreadig.',
    {
      crossOriginIsolated: globalThis.crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      kontrolliert: Boolean(navigator.serviceWorker.controller),
      workerAktiv: registration.active !== null,
      scope: registration.scope,
      reloadVerbraucht: sessionStorage.getItem(RELOAD_FLAG) !== null,
    },
  )
}
