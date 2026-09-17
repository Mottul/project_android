import { useEffect } from 'react'

import { Header } from './components/Header'
import { Inspector } from './components/Inspector'
import { JobQueue } from './components/JobQueue'
import { LogPanel, StatusBar } from './components/StatusBar'
import { useAppStore } from './store/useAppStore'

export default function App() {
  const init = useAppStore((s) => s.init)
  const addFiles = useAppStore((s) => s.addFiles)

  useEffect(() => {
    void init()
  }, [init])

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
      <div className="relative z-10 flex h-full flex-col">
        <Header />
        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col">
            <JobQueue />
            <LogPanel />
          </main>
          <Inspector />
        </div>
        <StatusBar />
      </div>
    </div>
  )
}
