import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { registerServiceWorker } from './register-sw'
import { useAppStore } from './store/useAppStore'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root fehlt im HTML')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline support, and on GitHub Pages the only route to cross-origin
// isolation. No-op during development.
registerServiceWorker()

// Dev-only handle for poking at state from the console: __prism.getState().
if (import.meta.env.DEV) {
  ;(window as unknown as { __prism: typeof useAppStore }).__prism = useAppStore
}
