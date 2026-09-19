import { useShallow } from 'zustand/react/shallow'
import { CheckCheck, Trash2 } from 'lucide-react'

import { useAppStore, selectStats } from '@/store/useAppStore'
import { DropZone } from './DropZone'
import { JobCard } from './JobCard'
import { Button } from './ui/controls'

export function JobQueue() {
  const jobs = useAppStore((s) => s.jobs)
  const stats = useAppStore(useShallow(selectStats))
  const clearCompleted = useAppStore((s) => s.clearCompleted)
  const clearAll = useAppStore((s) => s.clearAll)

  if (jobs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        <DropZone compact={false} />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2 sm:gap-3 sm:px-4 sm:pt-4 sm:pb-3">
        <h2 className="min-w-0 truncate text-[13px] font-semibold text-text">
          Warteschlange
          {/* The counts live here as well as in the status bar, because the
              status bar is not on screen on a phone. */}
          <span className="tnum ml-2 font-normal text-faint">
            {stats.total} {stats.total === 1 ? 'Datei' : 'Dateien'}
            {stats.done > 0 && ` · ${stats.done} fertig`}
          </span>
          {stats.failed > 0 && (
            <span className="tnum ml-1.5 font-normal text-danger">
              · {stats.failed} fehlgeschlagen
            </span>
          )}
        </h2>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {stats.done > 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon={<CheckCheck size={13} />}
              onClick={clearCompleted}
            >
              Fertige entfernen
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={clearAll}>
            Leeren
          </Button>
        </div>
      </div>

      <div className="scroll-area flex flex-1 flex-col gap-2 px-3 pb-4 sm:px-4">
        <DropZone compact />
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    </div>
  )
}
