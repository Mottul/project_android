/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

declare module '*?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

/**
 * The File Handling API is not in lib.dom yet. Declared narrowly rather than
 * cast away at the call site, so the consumer in App.tsx stays typed.
 */
interface LaunchParams {
  readonly files?: readonly FileSystemFileHandle[]
  readonly targetURL?: string
}

interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void | Promise<void>): void
}

interface Window {
  launchQueue?: LaunchQueue
}
