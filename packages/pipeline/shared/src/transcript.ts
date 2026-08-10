/**
 * Word-level transcription confidence.
 *
 * The transcript travels through the app as a single string (diarized as
 * `Speaker N: …` lines). Rather than replace that with a structured type —
 * which every consumer, the note LLM and the archival manifest would have to
 * learn — confidence rides alongside as character offsets into that same
 * string. Consumers that don't care keep treating the transcript as text.
 *
 * This module holds the pure half of that scheme: the span type, and the
 * parsing/mapping needed to put a span back on the right characters once the
 * transcript has been split into speaker turns for display.
 */

/** A word's span in the rendered transcript, with the provider's confidence. */
export interface TranscriptWordSpan {
  /** Inclusive character offset into the transcript text. */
  start: number
  /** Exclusive character offset into the transcript text. */
  end: number
  /** Provider confidence in [0, 1]. Deepgram word confidence usually sits >0.9. */
  confidence: number
}

/**
 * Below this, a word is worth a second look.
 *
 * Deepgram word confidence clusters high — on the synthetic Derek consultation
 * (nova-3, 881 words) the median is 1.000 and the 5th percentile 0.879 — so the
 * threshold has to sit low or the marks become noise. Measured on one take:
 *
 *   < 0.6 → 4 words (0.5%)   < 0.7 → 7 words (0.8%)   < 0.8 → 23 words (2.6%)
 *
 * 0.7 marks well under 1% of the transcript while still catching the case that
 * matters. On that take Deepgram garbled the blood pressure as "130 twoone
 * 104", and the bad token scored 0.610 — a mangled vital sign is exactly what
 * must not reach the note unnoticed, and at 0.6 it slips through.
 *
 * Note that Deepgram is not deterministic across requests: a second run of the
 * same audio rendered that passage correctly ("one thirty two over one zero
 * four") and flagged nothing there. So this is a floor chosen from an observed
 * failure, not a stable per-word contract. Tune per-deployment with
 * NEXT_PUBLIC_TRANSCRIPT_CONFIDENCE_THRESHOLD.
 */
export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.7

export function isLowConfidence(
  span: TranscriptWordSpan,
  threshold: number = DEFAULT_LOW_CONFIDENCE_THRESHOLD,
): boolean {
  return span.confidence < threshold
}

/** A piece of a turn's text, with its offset in the source transcript. */
export interface TranscriptSegment {
  sourceStart: number
  text: string
}

export interface TranscriptTurn {
  speaker: number
  text: string
  /**
   * Pieces that make up `text`, for mapping source offsets onto it. Always set
   * by parseDiarizedTranscript; absent on turns built by other means (e.g. a
   * sentence split of a plain transcript), which simply get no marks.
   */
  segments?: TranscriptSegment[]
}

/** A half-open range within a turn's own text. */
export interface TranscriptMarkRange {
  start: number
  end: number
  confidence: number
}

/**
 * Parse a diarized transcript of the form:
 *   Speaker 0: ...
 *   Speaker 1: ...
 * Returns the speaker turns, or null when the text isn't diarized (so the
 * caller can fall back to plain rendering). Lines without a speaker prefix are
 * appended to the previous turn (defensive against wrapped/multi-line text).
 *
 * Each turn keeps the source offsets of the pieces it was built from, so word
 * confidence spans — which index into the original string — can be mapped onto
 * the turn's own text.
 */
export function parseDiarizedTranscript(raw: string): TranscriptTurn[] | null {
  const turns: TranscriptTurn[] = []
  let matchedAny = false
  let lineStart = 0

  for (const line of raw.split("\n")) {
    const leading = line.length - line.trimStart().length
    const trimmed = line.trim()
    if (!trimmed) {
      lineStart += line.length + 1
      continue
    }

    const match = /^Speaker\s+(\d+)\s*:\s*(.*)$/i.exec(trimmed)
    if (match) {
      matchedAny = true
      // `\s*` already ate any gap after the colon, so what remains of the
      // prefix is exactly the offset of the captured text within the line.
      const text = match[2].trimEnd()
      const sourceStart = lineStart + leading + (trimmed.length - match[2].length)
      turns.push({ speaker: Number(match[1]), text, segments: text ? [{ sourceStart, text }] : [] })
    } else if (turns.length > 0) {
      const previous = turns[turns.length - 1]
      previous.segments?.push({ sourceStart: lineStart + leading, text: trimmed })
      previous.text = previous.text ? `${previous.text} ${trimmed}` : trimmed
    }

    lineStart += line.length + 1
  }

  if (!matchedAny) return null
  return turns.filter((turn) => turn.text.length > 0)
}

/**
 * Map source-indexed spans onto a turn's own text, keeping only those below
 * the threshold. Segments are joined with a single space, so a segment's local
 * base is the running total of the pieces before it. Spans that don't fall
 * wholly inside one segment are dropped — a partial mark would sit on the
 * wrong characters.
 */
export function lowConfidenceRangesFor(
  turn: TranscriptTurn,
  spans: TranscriptWordSpan[],
  threshold: number = DEFAULT_LOW_CONFIDENCE_THRESHOLD,
): TranscriptMarkRange[] {
  if (!turn.segments?.length) return []
  const ranges: TranscriptMarkRange[] = []
  let base = 0

  for (const segment of turn.segments) {
    const segmentEnd = segment.sourceStart + segment.text.length
    for (const span of spans) {
      if (span.confidence >= threshold) continue
      if (span.start < segment.sourceStart || span.end > segmentEnd) continue
      const start = base + (span.start - segment.sourceStart)
      ranges.push({ start, end: start + (span.end - span.start), confidence: span.confidence })
    }
    base += segment.text.length + 1 // the joining space
  }

  return ranges.sort((a, b) => a.start - b.start)
}
