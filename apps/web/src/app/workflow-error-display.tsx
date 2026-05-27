"use client"

import type { PipelineError } from "@pipeline-errors"
import { Button } from "@ui/lib/ui/button"

interface WorkflowErrorDisplayProps {
  error: PipelineError
  onRetry?: () => void
}

export function WorkflowErrorDisplay({ error, onRetry }: WorkflowErrorDisplayProps) {
  return (
    <div className="mb-6 w-full max-w-xl rounded-2xl border border-destructive/30 bg-destructive/5 p-4 shadow-soft">
      <p className="text-sm font-medium text-destructive">{error.message}</p>
      {error.recoverable && onRetry && (
        <Button className="mt-3 rounded-full" size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}
