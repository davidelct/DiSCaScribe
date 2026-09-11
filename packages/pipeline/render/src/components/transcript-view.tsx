"use client"

import { Fragment } from "react"
import { cn } from "@ui/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@ui/lib/ui/tooltip"
import {
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  lowConfidenceRangesFor,
  parseDiarizedTranscript,
  type TranscriptMarkRange,
  type TranscriptTurn,
  type TranscriptWordSpan,
} from "@pipeline-errors"

// Re-exported for consumers that step through turns (e.g. stimulated recall).
export { parseDiarizedTranscript }
export type { TranscriptSegment, TranscriptTurn } from "@pipeline-errors"

/**
 * The transcript as a script: speaker in a fixed gutter, the words in one
 * column beside it. Reads down like a page rather than across like a chat,
 * so a clinician can skim one speaker's turns down the gutter and a long
 * consultation stays short on screen.
 */

interface TranscriptViewProps {
  text: string
  /**
   * Per-word confidence, as character offsets into `text`. Words below the
   * threshold are marked so the clinician can check them against the audio —
   * a mis-heard drug name or dose is the error worth catching.
   */
  confidence?: TranscriptWordSpan[]
  /** Defaults to NEXT_PUBLIC_TRANSCRIPT_CONFIDENCE_THRESHOLD, else 0.7. */
  lowConfidenceThreshold?: number
}

function resolveDefaultThreshold(): number {
  const configured = Number.parseFloat(process.env.NEXT_PUBLIC_TRANSCRIPT_CONFIDENCE_THRESHOLD ?? "")
  return Number.isFinite(configured) && configured > 0 && configured <= 1
    ? configured
    : DEFAULT_LOW_CONFIDENCE_THRESHOLD
}

// Speaker label colours. The first speaker (usually the clinician) takes the
// brand accent and the second reads in ink; any further speakers cycle through
// the semantic hues so they stay distinguishable without new colours.
const SPEAKER_LABEL = ["text-primary", "text-foreground/75", "text-success", "text-warning-foreground"] as const

function speakerLabelClass(speaker: number): string {
  return SPEAKER_LABEL[((speaker % SPEAKER_LABEL.length) + SPEAKER_LABEL.length) % SPEAKER_LABEL.length]
}

// A dotted underline and nothing else: the word stays legible in its
// sentence, and the header counts the marks so none is missed.
const LOW_CONFIDENCE_MARK =
  "bg-transparent text-inherit underline decoration-amber-600 decoration-dotted decoration-2 " +
  "underline-offset-[3px] dark:decoration-amber-400"

const TURN_TEXT = "m-0 text-[15px] leading-6 text-foreground"

/**
 * One uncertain word. Focusable so the tooltip is reachable by keyboard, not
 * hover alone — and the mark itself still carries the meaning if the tooltip
 * never opens (touch), which is why the word stays visibly flagged.
 */
function UncertainWord({ word, confidence }: { word: string; confidence: number }) {
  const percent = Math.round(confidence * 100)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <mark tabIndex={0} className={LOW_CONFIDENCE_MARK}>
          {word}
        </mark>
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-medium text-foreground">{percent}% confidence</span>
        <span className="mt-0.5 block text-muted-foreground">
          The scribe was unsure of this word. Check it against the recording before filing the note.
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

/** Render `text`, marking the given ranges. Ranges must be sorted by start. */
function MarkedText({ text, ranges }: { text: string; ranges: TranscriptMarkRange[] }) {
  if (ranges.length === 0) return <>{text}</>

  const parts: React.ReactNode[] = []
  let cursor = 0

  ranges.forEach((range, index) => {
    // Defensive: ignore anything out of bounds or overlapping what we've drawn.
    const start = Math.max(range.start, cursor)
    const end = Math.min(range.end, text.length)
    if (start >= end) return

    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(
      <UncertainWord key={`${range.start}-${index}`} word={text.slice(start, end)} confidence={range.confidence} />,
    )
    cursor = end
  })

  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

/**
 * The line above the turns: what this is, how many voices, and how many
 * words the scribe was unsure of — so the check is a count to work through,
 * not a hunt for underlines.
 */
function MetaRow({ speakers, uncertain }: { speakers: number; uncertain: number }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
      <div className="flex items-baseline gap-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Transcript</span>
        {speakers > 0 && (
          <span className="text-xs text-muted-foreground">
            {speakers} speaker{speakers === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {uncertain > 0 && (
        <span className="flex h-[22px] items-center gap-1.5 rounded-md border border-border px-2 text-[11px] font-medium text-foreground">
          <span aria-hidden className="inline-block h-2 w-3.5 border-b-2 border-dotted border-amber-600 dark:border-amber-400" />
          {uncertain} word{uncertain === 1 ? "" : "s"} to check
        </span>
      )}
    </div>
  )
}

function TranscriptViewContent({ text, confidence, lowConfidenceThreshold }: TranscriptViewProps) {
  const source = text ?? ""
  const trimmed = source.trim()

  if (!trimmed) {
    return (
      <div className="flex h-full items-center justify-center text-center">
        <p className="text-sm text-muted-foreground">No transcript available</p>
      </div>
    )
  }

  const threshold = lowConfidenceThreshold ?? resolveDefaultThreshold()
  // Spans index into the untrimmed string; rendering uses the trimmed one.
  const leadingTrim = source.length - source.trimStart().length
  const spans = (confidence ?? []).map((span) => ({
    ...span,
    start: span.start - leadingTrim,
    end: span.end - leadingTrim,
  }))
  const turns = parseDiarizedTranscript(trimmed)

  // Not diarized: one block of prose, still marked.
  if (!turns || turns.length === 0) {
    const ranges = spans
      .filter((span) => span.confidence < threshold && span.start >= 0 && span.end <= trimmed.length)
      .map((span) => ({ start: span.start, end: span.end, confidence: span.confidence }))
      .sort((a, b) => a.start - b.start)
    return (
      <div>
        <MetaRow speakers={0} uncertain={ranges.length} />
        <p className={cn(TURN_TEXT, "whitespace-pre-wrap")}>
          <MarkedText text={trimmed} ranges={ranges} />
        </p>
      </div>
    )
  }

  const marked: Array<{ turn: TranscriptTurn; ranges: TranscriptMarkRange[] }> = turns.map((turn) => ({
    turn,
    ranges: lowConfidenceRangesFor(turn, spans, threshold),
  }))
  const uncertain = marked.reduce((count, entry) => count + entry.ranges.length, 0)
  const speakers = new Set(turns.map((turn) => turn.speaker)).size

  // Single speaker: a gutter would label every line the same — plain prose.
  if (speakers <= 1) {
    return (
      <div>
        <MetaRow speakers={1} uncertain={uncertain} />
        <div className="space-y-2.5">
          {marked.map(({ turn, ranges }, index) => (
            <p key={index} className={TURN_TEXT}>
              <MarkedText text={turn.text} ranges={ranges} />
            </p>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <MetaRow speakers={speakers} uncertain={uncertain} />
      <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-2.5">
        {marked.map(({ turn, ranges }, index) => {
          const showLabel = index === 0 || turns[index - 1].speaker !== turn.speaker
          // Capped so a long consultation still lands in under half a second —
          // the stagger is a settling cue, not a reveal.
          const delay = `${Math.min(index, 8) * 40}ms`
          return (
            <Fragment key={`${turn.speaker}-${index}`}>
              <div
                className={cn(
                  "animate-rise whitespace-nowrap pt-[5px] text-[11px] font-semibold uppercase tracking-[0.06em]",
                  speakerLabelClass(turn.speaker),
                )}
                style={{ animationDelay: delay }}
              >
                {showLabel ? `Speaker ${turn.speaker + 1}` : ""}
              </div>
              <p className={cn("animate-rise", TURN_TEXT)} style={{ animationDelay: delay }}>
                <MarkedText text={turn.text} ranges={ranges} />
              </p>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

export function TranscriptView(props: TranscriptViewProps) {
  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={400}>
      <TranscriptViewContent {...props} />
    </TooltipProvider>
  )
}
