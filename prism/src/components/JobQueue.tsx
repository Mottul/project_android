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
      <div className="flex flex-1 flex-col p-4">
        <DropZone compact={false} />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-3">
        <h2 className="text-[13px] font-semibold text-text">
          Warteschlange
          <span className="tnum ml-2 font-normal text-faint">
            {stats.total} {stats.total === 1 ? 'Datei' : 'Dateien'}
          </span>
        </h2>

        <div className="ml-auto flex items-center gap-1">
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

      <div className="scroll-area flex flex-1 flex-col gap-2 px-4 pb-4">
        <DropZone compact />
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    </div>
  )
}
