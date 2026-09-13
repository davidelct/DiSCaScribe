"use client"

import { Check } from "lucide-react"
import { cn } from "@ui/lib/utils"
import type { RecallExchangeRange, TranscriptTurn } from "@pipeline-errors"

/**
 * The transcript for stimulated recall: the same script layout as the
 * consultation view (speaker in a fixed gutter, words beside it), with every
 * turn clickable. A thin bracket marks each question–answer exchange; a
 * solid one with a number marks the turns an entry is about; ticks mark the
 * current selection.
 */

export interface RecallTranscriptEntry {
  id: string
  number: number
  turns: number[]
}

interface RecallTranscriptProps {
  turns: TranscriptTurn[]
  speakerLabel: (speaker: number) => string
  /** The speaker shown in the brand accent (the clinician when known, else the first). */
  accentSpeaker: number
  exchanges: RecallExchangeRange[]
  entries: RecallTranscriptEntry[]
  activeEntryId: string | null
  selected: number[]
  onTurnClick: (index: number) => void
  registerTurn: (index: number, element: HTMLButtonElement | null) => void
}

const TURN_TEXT = "text-[15px] leading-6 text-foreground"

export function RecallTranscript({
  turns,
  speakerLabel,
  accentSpeaker,
  exchanges,
  entries,
  activeEntryId,
  selected,
  onTurnClick,
  registerTurn,
}: RecallTranscriptProps) {
  // What each turn belongs to. An entry outranks an exchange: once a table
  // is anchored on a pair, the solid bracket is the one that matters.
  const exchangeOf = new Map<number, number>()
  exchanges.forEach((exchange, index) => {
    for (let i = exchange.question; i <= exchange.answer_end; i++) exchangeOf.set(i, index)
  })
  const entryOf = new Map<number, RecallTranscriptEntry>()
  for (const entry of entries) for (const index of entry.turns) entryOf.set(index, entry)
  const selectedSet = new Set(selected)

  const segmentOf = (index: number): string | null => {
    if (index < 0 || index >= turns.length) return null
    const entry = entryOf.get(index)
    if (entry) return `entry:${entry.id}`
    const exchange = exchangeOf.get(index)
    return exchange === undefined ? null : `exchange:${exchange}`
  }

  return (
    <div className="flex flex-col gap-0.5">
      {turns.map((turn, index) => {
        const entry = entryOf.get(index)
        const segment = segmentOf(index)
        const first = segment !== segmentOf(index - 1)
        const last = segment !== segmentOf(index + 1)
        const isSelected = selectedSet.has(index)
        const highlighted = isSelected || (entry !== undefined && entry.id === activeEntryId)
        const showLabel = index === 0 || turns[index - 1].speaker !== turn.speaker
        const isFirstOfEntry = entry !== undefined && entry.turns[0] === index
        return (
          <button
            key={index}
            type="button"
            ref={(element) => registerTurn(index, element)}
            onClick={() => onTurnClick(index)}
            aria-pressed={isSelected}
            className={cn(
              "relative grid w-full grid-cols-[96px_minmax(0,1fr)] gap-x-4 rounded-md py-1 pl-4 pr-2 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              highlighted ? "bg-brand-soft/55" : "hover:bg-accent",
            )}
          >
            {segment && (
              <span
                aria-hidden
                className={cn(
                  "absolute rounded-full",
                  entry ? "left-[3px] w-[3px] bg-primary" : "left-1 w-0.5 bg-primary/40",
                  first ? "top-1.5" : "-top-0.5",
                  last ? "bottom-1.5" : "-bottom-0.5",
                )}
              />
            )}
            <span
              className={cn(
                "whitespace-nowrap pt-[5px] text-[11px] font-semibold uppercase tracking-[0.06em]",
                turn.speaker === accentSpeaker ? "text-primary" : "text-foreground/75",
              )}
            >
              {showLabel ? speakerLabel(turn.speaker) : ""}
            </span>
            <span className="flex items-start gap-2.5">
              <span className={cn("min-w-0 flex-1", TURN_TEXT)}>{turn.text}</span>
              {isFirstOfEntry && (
                <span className="mt-[3px] inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded px-1.5 font-mono text-[10.5px] font-semibold text-primary-foreground bg-primary">
                  {entry.number}
                </span>
              )}
              {isSelected && (
                <span className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] bg-primary text-primary-foreground">
                  <Check className="h-[11px] w-[11px]" strokeWidth={2.5} />
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
