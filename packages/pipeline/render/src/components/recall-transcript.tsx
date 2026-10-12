"use client"

import { Check } from "lucide-react"
import { cn } from "@ui/lib/utils"
import type { TranscriptTurn } from "@pipeline-errors"

/**
 * The transcript for stimulated recall: a checkbox before every turn, then
 * the speaker and their words on one line, as the template writes them
 * ("GP: …", "Patient: …"), so the words get the column's width. Ticking a
 * turn highlights it: the words of every highlighted turn stay marked in
 * yellow for the rest of the interview, with a bracket and a number per
 * entry, and clicking a highlighted turn opens its entry. The boxes show
 * the open entry's turns.
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
  entries: RecallTranscriptEntry[]
  openEntryId: string | null
  /** The ticked turns: the open entry's. */
  checked: number[]
  onToggleTurn: (index: number, checked: boolean) => void
  /** A turn of an entry other than the open one was clicked. */
  onOpenEntry: (entryId: string) => void
  registerTurn: (index: number, element: HTMLElement | null) => void
}

// Larger type than the consultation view: participants read this column
// aloud with an interviewer, from across a desk (Eoin, October 2026).
const ROW = "relative grid w-full grid-cols-[14px_minmax(0,1fr)] gap-x-3 rounded-md py-1 pl-4 pr-2 text-left transition-colors"
const TURN_TEXT = "text-[18px] leading-7 text-foreground"
/** The highlighter: the words of a turn in an entry, marked like a pen would. */
const HIGHLIGHT = "-mx-0.5 rounded-sm bg-amber-200/80 px-0.5 [box-decoration-break:clone]"

export function RecallTranscript({
  turns,
  speakerLabel,
  accentSpeaker,
  entries,
  openEntryId,
  checked,
  onToggleTurn,
  onOpenEntry,
  registerTurn,
}: RecallTranscriptProps) {
  const entryOf = new Map<number, RecallTranscriptEntry>()
  for (const entry of entries) for (const index of entry.turns) entryOf.set(index, entry)
  const checkedSet = new Set(checked)

  // The bracket runs over consecutive turns of one entry.
  const segmentOf = (index: number): string | null => {
    if (index < 0 || index >= turns.length) return null
    const entry = entryOf.get(index)
    return entry ? entry.id : null
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
        const chip = entry !== undefined && entry.turns[0] === index && (
          <span className="mt-[5px] inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded bg-primary px-1.5 font-mono text-[10.5px] font-semibold text-primary-foreground">
            {entry.number}
          </span>
        )
        const bracket = segment && (
          <span
            aria-hidden
            className={cn(
              "absolute left-[3px] w-[3px] rounded-full bg-primary",
              first ? "top-1.5" : "-top-0.5",
              last ? "bottom-1.5" : "-bottom-0.5",
            )}
          />
        )
        // The speaker opens every turn, so each line stands on its own.
        const label = (
          <span className={cn("font-semibold", turn.speaker === accentSpeaker ? "text-primary" : "text-foreground/70")}>
            {speakerLabel(turn.speaker)}:{" "}
          </span>
        )
        const box = (
          <span
            aria-hidden
            className={cn(
              "mt-[7px] flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring/40",
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
              <span className="flex items-start gap-2.5">
                <span className={cn("min-w-0 flex-1", TURN_TEXT)}>
                  {label}
                  <span className={HIGHLIGHT}>{turn.text}</span>
                </span>
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
            className={cn(ROW, "cursor-pointer hover:bg-accent")}
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
            <span className="flex items-start gap-2.5">
              <span className={cn("min-w-0 flex-1", TURN_TEXT)}>
                {label}
                {entry ? <span className={HIGHLIGHT}>{turn.text}</span> : turn.text}
              </span>
              {chip}
            </span>
          </label>
        )
      })}
    </div>
  )
}
