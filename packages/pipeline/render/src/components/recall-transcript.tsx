"use client"

import { Check } from "lucide-react"
import { cn } from "@ui/lib/utils"
import type { RecallExchangeRange, TranscriptTurn } from "@pipeline-errors"

/**
 * The transcript for stimulated recall: the same script layout as the
 * consultation view (speaker in a fixed gutter, words beside it), with a
 * checkbox before every turn. The boxes show one selection: the turns of
 * the open entry, or the turns picked for a new one. A thin bracket marks
 * each question–answer exchange (ticking one turn ticks both); a solid
 * bracket with a number marks an entry's turns, and clicking those opens it.
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
  openEntryId: string | null
  /** The ticked turns: the open entry's, or the new selection. */
  checked: number[]
  onToggleTurn: (index: number, checked: boolean) => void
  /** A turn of an entry other than the open one was clicked. */
  onOpenEntry: (entryId: string) => void
  registerTurn: (index: number, element: HTMLElement | null) => void
}

const ROW =
  "relative grid w-full grid-cols-[14px_96px_minmax(0,1fr)] gap-x-3 rounded-md py-1 pl-4 pr-2 text-left transition-colors"
const TURN_TEXT = "text-[15px] leading-6 text-foreground"

export function RecallTranscript({
  turns,
  speakerLabel,
  accentSpeaker,
  exchanges,
  entries,
  openEntryId,
  checked,
  onToggleTurn,
  onOpenEntry,
  registerTurn,
}: RecallTranscriptProps) {
  const exchangeOf = new Map<number, number>()
  exchanges.forEach((exchange, index) => {
    for (let i = exchange.question; i <= exchange.answer_end; i++) exchangeOf.set(i, index)
  })
  const entryOf = new Map<number, RecallTranscriptEntry>()
  for (const entry of entries) for (const index of entry.turns) entryOf.set(index, entry)
  const checkedSet = new Set(checked)

  // An entry outranks an exchange: once a table is anchored on a pair, the
  // solid bracket is the one that matters.
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
        const otherEntry = entry !== undefined && entry.id !== openEntryId ? entry : undefined
        const segment = segmentOf(index)
        const first = segment !== segmentOf(index - 1)
        const last = segment !== segmentOf(index + 1)
        const isChecked = checkedSet.has(index)
        const showLabel = index === 0 || turns[index - 1].speaker !== turn.speaker
        const chip = entry !== undefined && entry.turns[0] === index && (
          <span className="mt-[3px] inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded bg-primary px-1.5 font-mono text-[10.5px] font-semibold text-primary-foreground">
            {entry.number}
          </span>
        )
        const bracket = segment && (
          <span
            aria-hidden
            className={cn(
              "absolute rounded-full",
              entry ? "left-[3px] w-[3px] bg-primary" : "left-1 w-0.5 bg-primary/40",
              first ? "top-1.5" : "-top-0.5",
              last ? "bottom-1.5" : "-bottom-0.5",
            )}
          />
        )
        const label = (
          <span
            className={cn(
              "whitespace-nowrap pt-[5px] text-[11px] font-semibold uppercase tracking-[0.06em]",
              turn.speaker === accentSpeaker ? "text-primary" : "text-foreground/75",
            )}
          >
            {showLabel ? speakerLabel(turn.speaker) : ""}
          </span>
        )
        const box = (
          <span
            aria-hidden
            className={cn(
              "mt-[5px] flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring/40",
              isChecked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card",
            )}
          >
            {isChecked && <Check className="h-[10px] w-[10px]" strokeWidth={3} />}
          </span>
        )

        // A turn of another entry: the row opens that entry.
        if (otherEntry) {
          return (
            <div
              key={index}
              ref={(element) => registerTurn(index, element)}
              role="button"
              tabIndex={0}
              onClick={() => onOpenEntry(otherEntry.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  onOpenEntry(otherEntry.id)
                }
              }}
              title={`Open entry ${otherEntry.number}`}
              className={cn(ROW, "cursor-pointer hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40")}
            >
              {bracket}
              {box}
              {label}
              <span className="flex items-start gap-2.5">
                <span className={cn("min-w-0 flex-1", TURN_TEXT)}>{turn.text}</span>
                {chip}
              </span>
            </div>
          )
        }

        // Any other turn: the row is the checkbox's label, so a click
        // anywhere on it ticks or unticks the box.
        return (
          <label
            key={index}
            ref={(element) => registerTurn(index, element)}
            className={cn(ROW, "cursor-pointer", isChecked ? "bg-brand-soft/55" : "hover:bg-accent")}
          >
            {bracket}
            {/* The real checkbox is kept for keyboard and screen readers; the
                box beside it is drawn by hand so the tick looks the same in
                every browser. */}
            <input
              type="checkbox"
              checked={isChecked}
              onChange={(event) => onToggleTurn(index, event.target.checked)}
              aria-label={`Select turn ${index + 1}`}
              className="peer sr-only"
            />
            {box}
            {label}
            <span className="flex items-start gap-2.5">
              <span className={cn("min-w-0 flex-1", TURN_TEXT)}>{turn.text}</span>
              {chip}
            </span>
          </label>
        )
      })}
    </div>
  )
}
