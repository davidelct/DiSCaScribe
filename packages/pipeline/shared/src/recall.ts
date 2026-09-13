import type { TranscriptTurn } from "./transcript"

/**
 * A question–answer exchange as a pair of turn indices: the question turn
 * and the last turn of the answer. Mirrors RecallExchange in @storage/types;
 * kept here so the pipeline stays free of the storage package.
 */
export interface RecallExchangeRange {
  question: number
  answer_end: number
}

/**
 * Normalise exchanges from an untrusted source (the model's JSON): keep only
 * integer pairs inside the transcript with question < answer_end, in
 * transcript order, dropping any that overlap an earlier one.
 */
export function sanitizeRecallExchanges(raw: unknown, turnCount: number): RecallExchangeRange[] {
  if (!Array.isArray(raw)) return []
  const valid: RecallExchangeRange[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const { question, answer_end } = item as { question?: unknown; answer_end?: unknown }
    if (!Number.isInteger(question) || !Number.isInteger(answer_end)) continue
    const q = question as number
    const end = answer_end as number
    if (q < 0 || end >= turnCount || q >= end) continue
    valid.push({ question: q, answer_end: end })
  }
  valid.sort((a, b) => a.question - b.question)
  const out: RecallExchangeRange[] = []
  let lastEnd = -1
  for (const exchange of valid) {
    if (exchange.question <= lastEnd) continue
    out.push(exchange)
    lastEnd = exchange.answer_end
  }
  return out
}

/**
 * The clinician, guessed without a model: whoever asks the most questions.
 * Undefined with fewer than two speakers or a tie.
 */
export function guessClinicianSpeaker(turns: TranscriptTurn[]): number | undefined {
  const questions = new Map<number, number>()
  for (const turn of turns) {
    if (!questions.has(turn.speaker)) questions.set(turn.speaker, 0)
    if (/\?\s*$/.test(turn.text)) questions.set(turn.speaker, (questions.get(turn.speaker) ?? 0) + 1)
  }
  if (questions.size < 2) return undefined
  const ranked = [...questions.entries()].sort((a, b) => b[1] - a[1])
  if (ranked[0][1] === ranked[1][1]) return undefined
  return ranked[0][0]
}

/**
 * Exchanges without a model: a turn ending in a question mark, answered by
 * whoever speaks next; the answer runs until the asker speaks again. Given
 * the clinician's speaker, only their questions count.
 */
export function heuristicRecallExchanges(
  turns: TranscriptTurn[],
  clinicianSpeaker?: number,
): RecallExchangeRange[] {
  const out: RecallExchangeRange[] = []
  for (let i = 0; i < turns.length - 1; i++) {
    const turn = turns[i]
    if (clinicianSpeaker !== undefined && turn.speaker !== clinicianSpeaker) continue
    if (!/\?\s*$/.test(turn.text)) continue
    if (turns[i + 1].speaker === turn.speaker) continue
    let end = i + 1
    while (end + 1 < turns.length && turns[end + 1].speaker !== turn.speaker) end++
    out.push({ question: i, answer_end: end })
    i = end
  }
  return out
}
