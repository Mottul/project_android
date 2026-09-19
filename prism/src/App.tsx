import { useEffect } from 'react'

import { DESKTOP_QUERY, useMediaQuery } from './lib/use-media-query'
import { Header } from './components/Header'
import { Inspector, InspectorSheet } from './components/Inspector'
import { JobQueue } from './components/JobQueue'
import { MobileBar } from './components/MobileBar'
import { LogPanel, StatusBar } from './components/StatusBar'
import { useAppStore } from './store/useAppStore'

export default function App() {
  const init = useAppStore((s) => s.init)
  const addFiles = useAppStore((s) => s.addFiles)
  const inspectorOpen = useAppStore((s) => s.inspectorOpen)
  const setInspectorOpen = useAppStore((s) => s.setInspectorOpen)

  // Below this width the inspector cannot be a column without starving the
  // queue: 384px of sidebar on a 390px phone left the drop zone at zero.
  const desktop = useMediaQuery(DESKTOP_QUERY)

  useEffect(() => {
    void init()
  }, [init])

  // Rotating into the sidebar layout must not leave an invisible sheet open.
  useEffect(() => {
    if (desktop) setInspectorOpen(false)
  }, [desktop, setInspectorOpen])

  // Files handed over by the OS ("Open with Prism") when installed as a PWA.
  useEffect(() => {
    const handler = window.launchQueue
    if (!handler) return
    handler.setConsumer(async (params) => {
      const files: File[] = []
      for (const handle of params.files ?? []) {
        try {
          files.push(await handle.getFile())
        } catch {
          /* permission withdrawn */
        }
      }
      if (files.length > 0) addFiles(files)
    })
  }, [addFiles])

  return (
    <div className="app-backdrop relative flex h-full flex-col">
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <Header />
        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col">
            <JobQueue />
            <LogPanel />
          </main>
          {desktop && <Inspector />}
        </div>
        {desktop ? <StatusBar /> : <MobileBar />}
      </div>

      {!desktop && (
        <InspectorSheet open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
      )}
    </div>
  )
}
