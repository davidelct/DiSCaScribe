"use client"

import { Button } from "@ui/lib/ui/button"
import { Square, Pause, Play } from "lucide-react"
import { cn } from "@ui/lib/utils"
import { WaveformVisualizer } from "./waveform-visualizer"

interface RecordingViewProps {
  patientName: string
  patientId: string
  duration: number
  isPaused: boolean
  /** Live mic analyser for the waveform; null until recording is running. */
  analyser: AnalyserNode | null
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
  analyser,
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

      {/* Live microphone waveform — real signal, so the clinician can see their
          voice is being captured. */}
      <WaveformVisualizer analyser={analyser} isPaused={isPaused} className="mb-8 h-24 w-full max-w-sm" />

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
