"use client"

import { Skeleton } from "@ui/lib/ui/skeleton"
import { cn } from "@ui/lib/utils"

/**
 * Placeholder for the diarized transcript.
 *
 * It borrows TranscriptView's own layout — legend row, alternating speaker
 * bubbles, the same radii and tints — so when the real transcript arrives it
 * fades in over the same shape instead of replacing a centred spinner with a
 * wall of text. The turn shapes below are a plausible consultation opening:
 * a short clinician question, a longer patient answer, and so on.
 */

const TURNS: Array<{ side: "left" | "right"; lines: number[] }> = [
  { side: "left", lines: [62] },
  { side: "right", lines: [94, 88, 71] },
  { side: "left", lines: [78, 44] },
  { side: "right", lines: [91, 63] },
  { side: "left", lines: [55] },
  { side: "right", lines: [86, 79, 48] },
]

const BUBBLE_TINT = {
  left: "bg-blue-50 border-blue-200/70 dark:bg-blue-500/10 dark:border-blue-500/20",
  right: "bg-indigo-50 border-indigo-200/70 dark:bg-indigo-500/10 dark:border-indigo-500/20",
} as const

export function TranscriptSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Transcribing the consultation">
      <div className="space-y-4">
        {TURNS.map((turn, index) => (
          <div
            key={index}
            className={cn(
              "flex flex-col",
              // Enters from the same side the real turn will, so the loading
              // state and the transcript share one motion language.
              turn.side === "right" ? "animate-enter-right items-end" : "animate-enter-left items-start",
            )}
            style={{ animationDelay: `${index * 70}ms` }}
          >
            <Skeleton className="mb-1.5 h-2.5 w-16 rounded-full" />
            <div
              className={cn(
                "w-[85%] space-y-2.5 rounded-2xl border px-4 py-3.5 shadow-soft",
                BUBBLE_TINT[turn.side],
                turn.side === "right" ? "rounded-tr-sm" : "rounded-tl-sm",
              )}
            >
              {turn.lines.map((width, lineIndex) => (
                <Skeleton key={lineIndex} className="h-3.5 rounded-full" style={{ width: `${width}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <span className="sr-only">Transcribing the consultation…</span>
    </div>
  )
}
