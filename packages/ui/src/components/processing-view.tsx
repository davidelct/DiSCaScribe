"use client"

import { Button } from "@ui/lib/ui/button"
import { Check, Loader2, X, RotateCcw } from "lucide-react"
import { cn } from "@ui/lib/utils"

type StepStatus = "pending" | "in-progress" | "done" | "failed"

interface ProcessingViewProps {
  patientName: string
  transcriptionStatus: StepStatus
  noteGenerationStatus: StepStatus
  transcriptionErrorMessage?: string
  onRetryTranscription?: () => void
  onRetryNoteGeneration?: () => void
}

export function ProcessingView({
  patientName,
  transcriptionStatus,
  noteGenerationStatus,
  transcriptionErrorMessage,
  onRetryTranscription,
  onRetryNoteGeneration,
}: ProcessingViewProps) {
  return (
    <div className="animate-fade-up flex w-full flex-col items-center">
      <div className="mb-10 text-center">
        <p className="font-display text-2xl font-medium tracking-tight text-foreground">
          {patientName || "Unknown Patient"}
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">Processing encounter…</p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        <ProcessingStep
          label="Transcribing audio"
          status={transcriptionStatus}
          errorMessage={transcriptionErrorMessage}
          onRetry={onRetryTranscription}
        />
        <ProcessingStep label="Generating clinical note" status={noteGenerationStatus} onRetry={onRetryNoteGeneration} />
      </div>
    </div>
  )
}

function ProcessingStep({
  label,
  status,
  errorMessage,
  onRetry,
}: {
  label: string
  status: StepStatus
  errorMessage?: string
  onRetry?: () => void
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-2xl border p-4 transition-all duration-300",
        status === "failed" && "border-destructive/30 bg-destructive/5",
        status === "done" && "border-primary/20 bg-brand-soft/50",
        status === "in-progress" && "border-primary/30 bg-card shadow-soft",
        status === "pending" && "border-border bg-card/40",
      )}
    >
      <StepIcon status={status} />
      <div className="flex-1">
        <p
          className={cn(
            "text-sm font-medium",
            status === "pending" && "text-muted-foreground",
            status === "in-progress" && "text-foreground",
            status === "done" && "text-foreground",
            status === "failed" && "text-destructive",
          )}
        >
          {label}
        </p>
        {status === "failed" && (
          <p className="mt-0.5 text-xs text-muted-foreground">{errorMessage || "An error occurred"}</p>
        )}
      </div>
      {status === "failed" && onRetry && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "pending") {
    return (
      <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border">
        <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
      </div>
    )
  }

  if (status === "in-progress") {
    return (
      <div className="flex h-7 w-7 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    )
  }

  if (status === "done") {
    return (
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft">
        <Check className="h-4 w-4" />
      </div>
    )
  }

  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
      <X className="h-4 w-4" />
    </div>
  )
}
