"use client"

import { Fragment } from "react"
import { Skeleton } from "@ui/lib/ui/skeleton"

/**
 * Placeholder for the transcript.
 *
 * It borrows TranscriptView's own shape — a speaker gutter beside a column
 * of turns — so when the real transcript arrives it
 * fades in over the same layout instead of replacing a centred spinner with a
 * wall of text. The line widths below are a plausible consultation opening:
 * two short greetings, a longer patient answer, and so on.
 */

const TURNS: number[][] = [[18], [22], [96, 34], [98, 58], [97, 26], [88]]

export function TranscriptSkeleton() {
  return (
    <div role="status" aria-label="Transcribing the consultation">
      <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-2.5">
        {TURNS.map((lines, index) => (
          <Fragment key={index}>
            <div className="animate-rise pt-[7px]" style={{ animationDelay: `${index * 60}ms` }}>
              <Skeleton className="h-2.5 w-16" />
            </div>
            <div className="animate-rise space-y-2.5 py-[5px]" style={{ animationDelay: `${index * 60}ms` }}>
              {lines.map((width, lineIndex) => (
                <Skeleton key={lineIndex} className="h-3.5" style={{ width: `${width}%` }} />
              ))}
            </div>
          </Fragment>
        ))}
      </div>
      <span className="sr-only">Transcribing the consultation…</span>
    </div>
  )
}
