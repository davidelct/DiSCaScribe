"use client"

import { cn } from "@ui/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@ui/lib/ui/tooltip"
import {
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  lowConfidenceRangesFor,
  parseDiarizedTranscript,
  type TranscriptMarkRange,
  type TranscriptWordSpan,
} from "@pipeline-errors"

// Re-exported for consumers that step through turns (e.g. stimulated recall).
export { parseDiarizedTranscript }
export type { TranscriptSegment, TranscriptTurn } from "@pipeline-errors"

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

// Theme-aware accents cycled per speaker index. Kept within the blue family
// to match the clinical palette; ordered so the first two speakers (typically
// clinician/patient) get the highest-contrast pair.
const SPEAKER_STYLES = [
  {
    label: "text-blue-600 dark:text-blue-400",
    bubble: "bg-blue-50 border-blue-200/70 dark:bg-blue-500/10 dark:border-blue-500/20",
  },
  {
    label: "text-indigo-600 dark:text-indigo-400",
    bubble: "bg-indigo-50 border-indigo-200/70 dark:bg-indigo-500/10 dark:border-indigo-500/20",
  },
  {
    label: "text-sky-600 dark:text-sky-400",
    bubble: "bg-sky-50 border-sky-200/70 dark:bg-sky-500/10 dark:border-sky-500/20",
  },
  {
    label: "text-cyan-600 dark:text-cyan-400",
    bubble: "bg-cyan-50 border-cyan-200/70 dark:bg-cyan-500/10 dark:border-cyan-500/20",
  },
] as const

function speakerStyle(speaker: number) {
  return SPEAKER_STYLES[((speaker % SPEAKER_STYLES.length) + SPEAKER_STYLES.length) % SPEAKER_STYLES.length]
}

const LOW_CONFIDENCE_MARK =
  "rounded-[3px] bg-amber-100/80 px-0.5 text-amber-900 underline decoration-amber-500 decoration-dotted " +
  "decoration-2 underline-offset-[3px] dark:bg-amber-400/15 dark:text-amber-200 dark:decoration-amber-400"

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

  // Not diarized: preserve the original plain rendering.
  if (!turns || turns.length === 0) {
    const ranges = spans
      .filter((span) => span.confidence < threshold && span.start >= 0 && span.end <= trimmed.length)
      .map((span) => ({ start: span.start, end: span.end, confidence: span.confidence }))
      .sort((a, b) => a.start - b.start)
    return (
      <div className="space-y-4">
        <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground">
          <MarkedText text={trimmed} ranges={ranges} />
        </pre>
      </div>
    )
  }

  const distinctSpeakers = Array.from(new Set(turns.map((turn) => turn.speaker))).sort((a, b) => a - b)

  // Single speaker: labels/bubbles would be noise — render as plain prose.
  if (distinctSpeakers.length <= 1) {
    return (
      <div className="space-y-4">
        {turns.map((turn, index) => (
          <p key={index} className="text-[0.95rem] leading-7 text-foreground/85">
            <MarkedText text={turn.text} ranges={lowConfidenceRangesFor(turn, spans, threshold)} />
          </p>
        ))}
      </div>
    )
  }

  // Chat-style layout: alternate sides for the first two speakers; extra
  // speakers stay left-aligned and are distinguished by color.
  const speakerSide = new Map<number, "left" | "right">()
  distinctSpeakers.forEach((speaker, index) => speakerSide.set(speaker, index % 2 === 1 ? "right" : "left"))

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        {turns.map((turn, index) => {
          const style = speakerStyle(turn.speaker)
          const isRight = speakerSide.get(turn.speaker) === "right"
          const showLabel = index === 0 || turns[index - 1].speaker !== turn.speaker
          return (
            <div
              key={`${turn.speaker}-${index}`}
              className={cn(
                "flex flex-col",
                // Each turn arrives from the side it sits on, so the exchange
                // reads as two people rather than one column of blocks.
                isRight ? "animate-enter-right items-end" : "animate-enter-left items-start",
              )}
              // Capped so a long consultation still lands in under half a
              // second — the stagger is a settling cue, not a reveal.
              style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
            >
              {showLabel && (
                <span className={cn("mb-1 px-1 text-xs font-semibold uppercase tracking-wide", style.label)}>
                  Speaker {turn.speaker + 1}
                </span>
              )}
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl border px-4 py-2.5 text-[0.95rem] leading-7 text-foreground shadow-soft",
                  style.bubble,
                  isRight ? "rounded-tr-sm" : "rounded-tl-sm",
                )}
              >
                <MarkedText text={turn.text} ranges={lowConfidenceRangesFor(turn, spans, threshold)} />
              </div>
            </div>
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
