"use client"

import { cn } from "@ui/lib/utils"

interface TranscriptViewProps {
  text: string
}

export interface TranscriptTurn {
  speaker: number
  text: string
}

// Theme-aware accents cycled per speaker index. Kept within the blue family
// to match the clinical palette; ordered so the first two speakers (typically
// clinician/patient) get the highest-contrast pair.
const SPEAKER_STYLES = [
  {
    label: "text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500",
    bubble: "bg-blue-50 border-blue-200/70 dark:bg-blue-500/10 dark:border-blue-500/20",
  },
  {
    label: "text-indigo-600 dark:text-indigo-400",
    dot: "bg-indigo-500",
    bubble: "bg-indigo-50 border-indigo-200/70 dark:bg-indigo-500/10 dark:border-indigo-500/20",
  },
  {
    label: "text-sky-600 dark:text-sky-400",
    dot: "bg-sky-500",
    bubble: "bg-sky-50 border-sky-200/70 dark:bg-sky-500/10 dark:border-sky-500/20",
  },
  {
    label: "text-cyan-600 dark:text-cyan-400",
    dot: "bg-cyan-500",
    bubble: "bg-cyan-50 border-cyan-200/70 dark:bg-cyan-500/10 dark:border-cyan-500/20",
  },
] as const

function speakerStyle(speaker: number) {
  return SPEAKER_STYLES[((speaker % SPEAKER_STYLES.length) + SPEAKER_STYLES.length) % SPEAKER_STYLES.length]
}

/**
 * Parse a diarized transcript of the form:
 *   Speaker 0: ...
 *   Speaker 1: ...
 * Returns the speaker turns, or null when the text isn't diarized (so the
 * caller can fall back to plain rendering). Lines without a speaker prefix are
 * appended to the previous turn (defensive against wrapped/multi-line text).
 */
export function parseDiarizedTranscript(raw: string): TranscriptTurn[] | null {
  const turns: TranscriptTurn[] = []
  let matchedAny = false

  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = /^Speaker\s+(\d+)\s*:\s*(.*)$/i.exec(trimmed)
    if (match) {
      matchedAny = true
      turns.push({ speaker: Number(match[1]), text: match[2].trim() })
    } else if (turns.length > 0) {
      const prev = turns[turns.length - 1]
      prev.text = prev.text ? `${prev.text} ${trimmed}` : trimmed
    }
  }

  if (!matchedAny) return null
  return turns.filter((turn) => turn.text.length > 0)
}

export function TranscriptView({ text }: TranscriptViewProps) {
  const trimmed = text?.trim() ?? ""

  if (!trimmed) {
    return (
      <div className="flex h-full items-center justify-center text-center">
        <p className="text-sm text-muted-foreground">No transcript available</p>
      </div>
    )
  }

  const turns = parseDiarizedTranscript(trimmed)

  // Not diarized: preserve the original plain rendering.
  if (!turns || turns.length === 0) {
    return <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground">{trimmed}</pre>
  }

  const distinctSpeakers = Array.from(new Set(turns.map((turn) => turn.speaker))).sort((a, b) => a - b)

  // Single speaker: labels/bubbles would be noise — render as plain prose.
  if (distinctSpeakers.length <= 1) {
    return (
      <div className="space-y-4">
        {turns.map((turn, index) => (
          <p key={index} className="text-[0.95rem] leading-7 text-foreground/85">
            {turn.text}
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border pb-3 text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">{distinctSpeakers.length} speakers</span>
        {distinctSpeakers.map((speaker) => {
          const style = speakerStyle(speaker)
          return (
            <span key={speaker} className="inline-flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", style.dot)} />
              <span className={cn("font-medium", style.label)}>Speaker {speaker + 1}</span>
            </span>
          )
        })}
      </div>
      <div className="space-y-4">
        {turns.map((turn, index) => {
          const style = speakerStyle(turn.speaker)
          const isRight = speakerSide.get(turn.speaker) === "right"
          const showLabel = index === 0 || turns[index - 1].speaker !== turn.speaker
          return (
            <div key={`${turn.speaker}-${index}`} className={cn("flex flex-col", isRight ? "items-end" : "items-start")}>
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
                {turn.text}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
