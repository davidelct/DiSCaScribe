"use client"

import { Button } from "@ui/lib/ui/button"
import { Mic, Square, Pause, Play } from "lucide-react"
import { cn } from "@ui/lib/utils"

interface RecordingViewProps {
  patientName: string
  patientId: string
  duration: number
  isPaused: boolean
  onStop: () => void
  onPause: () => void
  onResume: () => void
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
}

export function RecordingView({
  patientName,
  patientId,
  duration,
  isPaused,
  onStop,
  onPause,
  onResume,
}: RecordingViewProps) {
  return (
    <div className="animate-fade-up flex flex-col items-center">
      {/* Patient info header */}
      <div className="mb-12 text-center">
        <p className="font-display text-2xl font-medium tracking-tight text-foreground">
          {patientName || "Unknown Patient"}
        </p>
        {patientId && <p className="mt-1 text-sm text-muted-foreground">ID: {patientId}</p>}
      </div>

      <div className="relative mb-10">
        <div
          className={cn(
            "flex h-32 w-32 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lifted transition-all duration-500",
            !isPaused ? "animate-breathe" : "opacity-80 grayscale-[35%]",
          )}
        >
          <Mic className={cn("h-12 w-12 transition-opacity", isPaused && "opacity-60")} />
        </div>
        {!isPaused && (
          <span className="absolute right-1 top-1 flex h-4 w-4">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-50" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-primary ring-2 ring-background" />
          </span>
        )}
      </div>

      {/* Status text */}
      <div className="mb-3 flex items-center gap-2">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full transition-colors",
            isPaused ? "bg-muted-foreground" : "bg-primary",
          )}
        />
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {isPaused ? "Paused" : "Recording"}
        </p>
      </div>

      {/* Timer */}
      <p className="mb-12 font-mono text-5xl font-light tabular-nums tracking-tight text-foreground">
        {formatDuration(duration)}
      </p>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="lg"
          onClick={isPaused ? onResume : onPause}
          className="h-14 w-14 rounded-full border-border bg-card p-0 shadow-soft hover:bg-accent hover:text-accent-foreground"
        >
          {isPaused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
          <span className="sr-only">{isPaused ? "Resume" : "Pause"}</span>
        </Button>

        <Button
          size="lg"
          onClick={onStop}
          className="h-14 rounded-full bg-primary px-7 text-base text-primary-foreground shadow-soft hover:bg-brand-strong"
        >
          <Square className="mr-2 h-4 w-4 fill-current" />
          End Interview
        </Button>
      </div>
    </div>
  )
}
