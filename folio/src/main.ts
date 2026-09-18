/**
 * Entry point.
 *
 * Styles, the shell, the service worker — and one safety net, because the
 * alternative to catching a failed start-up is a white page with nothing on it.
 */

import './styles/app.css'
import { App } from './ui/app'
import { registerServiceWorker } from './register-sw'

const root = document.getElementById('app')

if (root) {
  const app = new App(root)
  app.start().catch((error) => {
    console.error('[Folio] Start fehlgeschlagen:', error)
    root.innerHTML =
      '<div class="busy">' +
      '<p><strong>Folio konnte nicht starten.</strong></p>' +
      `<p style="color:var(--text-dim)">${escapeHtml(String((error as Error)?.message ?? error))}</p>` +
      '<p style="color:var(--text-faint);font-size:0.85rem">' +
      'Meist hilft es, die Seite neu zu laden. Bleibt es dabei, blockiert der Browser vermutlich ' +
      'den lokalen Speicher — im privaten Modus ist das üblich.</p>' +
      '</div>'
  })
}

registerServiceWorker()

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) =>
    char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&quot;',
  )
}
