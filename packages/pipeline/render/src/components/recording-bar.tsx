"use client"

import { Button } from "@ui/lib/ui/button"
import { WaveformVisualizer } from "@ui/components/waveform-visualizer"
import { cn } from "@ui/lib/utils"
import { Pause, Play, Square } from "lucide-react"

export interface RecordingBarProps {
  /** Elapsed recording time in seconds. */
  duration: number
  isPaused: boolean
  /** Live mic analyser for the waveform; null until recording is running. */
  analyser: AnalyserNode | null
  onStop: () => void
  onPause: () => void
  onResume: () => void
  /** Label for the stop action, stating what stopping triggers. */
  stopLabel: string
  className?: string
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
}

/**
 * The live recording strip: pause/resume, waveform, timer, stop. Shared by the
 * consultation capture and the stimulated-recall recorder, and laid out to
 * match the playback strip so the leftmost control morphs in place from
 * pause/resume into play when the recording becomes playable.
 */
export function RecordingBar({
  duration,
  isPaused,
  analyser,
  onStop,
  onPause,
  onResume,
  stopLabel,
  className,
}: RecordingBarProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Button
        variant="outline"
        onClick={isPaused ? onResume : onPause}
        className="h-9 w-9 shrink-0 rounded-full border-border bg-card p-0 shadow-soft hover:bg-accent"
      >
        {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        <span className="sr-only">{isPaused ? "Resume" : "Pause"}</span>
      </Button>
      <WaveformVisualizer analyser={analyser} isPaused={isPaused} className="h-9 min-w-0 flex-1" />
      <span className="flex shrink-0 items-center gap-2">
        <span
          title={isPaused ? "Paused" : "Recording"}
          className={cn("h-2.5 w-2.5 rounded-full", isPaused ? "bg-muted-foreground" : "animate-pulse bg-recording")}
        >
          <span className="sr-only">{isPaused ? "Paused" : "Recording"}</span>
        </span>
        <span className="font-mono text-sm font-light tabular-nums text-foreground">{formatDuration(duration)}</span>
      </span>
      <Button
        onClick={onStop}
        className="h-9 shrink-0 rounded-full bg-primary px-4 text-primary-foreground shadow-soft hover:bg-brand-strong"
      >
        <Square className="mr-2 h-3.5 w-3.5 fill-current" />
        {stopLabel}
      </Button>
    </div>
  )
}
