import { parseDiarizedTranscript, type RecallExchangeRange, type TranscriptTurn } from "@pipeline-errors"
import { loadSecureItem, saveSecureItem } from "@storage/secure-storage"
import { getEncounterAudio } from "@storage/audio-store"

/**
 * Stimulated recall (WT3.1) session data.
 *
 * The clinician goes back over the transcript with an interviewer and stops
 * at turns of their choosing. Each stop is an entry holding the template's
 * table: one row per diagnostic hypothesis with the reason the question was
 * asked, the hypothesis's likelihood (0–10) and how much the answer
 * supported it (−10..+10). The table carries forward: a hypothesis reported
 * at one stop is on every later table, and a likelihood not re-rated at a
 * stop is the one from the stop before. Sessions are persisted per encounter
 * in the encrypted store.
 */

export interface RecallHypothesis {
  id: string
  name: string
  /** The entry at which it was first reported; it is on that table and every later one. */
  entryId: string
}

/** One row of the table at one entry. */
export interface RecallRating {
  /** Reason for asking the question, free text: what the clinician was after. */
  reason: string
  /** 0–10 as reported at this entry; null means carried over from the previous table. */
  likelihood: number | null
  /** −10..+10; null when not rated at this entry. */
  support: number | null
}

export const EMPTY_RATING: RecallRating = { reason: "", likelihood: null, support: null }

export interface RecallEntry {
  id: string
  /** Transcript turns the entry is about, ascending. */
  turns: number[]
  notes: string
  /** By hypothesis id. */
  ratings: Record<string, RecallRating>
  createdAt: string
}

export interface FinalDiagnosisRow {
  id: string
  diagnosis: string
  likelihood: number | null
  why: string
  difficulty: string
}

/** One turn click made while the recall interview was being recorded. */
export interface UtteranceClick {
  /** Index into the turn list. */
  utterance: number
  /** Position in the recall recording at click time, seconds (pauses excluded). */
  audioOffsetSeconds: number
  /** Wall-clock time of the click. */
  at: string
}

/**
 * Timing of the recall recording, for segmenting the audio per turn: the
 * stretch between two consecutive clicks is the clinician talking about the
 * first click's turn.
 */
export interface RecallTimeline {
  startedAt: string
  stoppedAt?: string
  /** Recorded length in seconds (pauses excluded). */
  durationSeconds?: number
  utteranceClicks: UtteranceClick[]
}

export interface RecallSession {
  version: 3
  hypotheses: RecallHypothesis[]
  entries: RecallEntry[]
  finalDiagnosis: FinalDiagnosisRow[]
  /** Timing of the recall recording (replaced on re-record). */
  timeline?: RecallTimeline
  /** Set once the recall recording + session data have been archived. */
  recallArchivedAt?: string
}

export const LIKELIHOOD_RANGE = { min: 0, max: 10 } as const
export const SUPPORT_RANGE = { min: -10, max: 10 } as const

export function emptyRecallSession(): RecallSession {
  return { version: 3, hypotheses: [], entries: [], finalDiagnosis: [] }
}

function storageKey(encounterId: string): string {
  return `openscribe_recall_${encounterId}`
}

/** Audio-store key for the recall-interview recording of an encounter. */
export function recallAudioKey(encounterId: string): string {
  return `recall:${encounterId}`
}

/**
 * The saved session, or an empty one. Version 2 sessions are migrated in
 * place (see migrateEntry) and overwritten on first save. Sessions from
 * before the per-stop tables (per-utterance cue ratings on a −3..+3 scale)
 * are not carried over: the measure changed, so they start afresh.
 */
export async function loadRecallSession(encounterId: string): Promise<RecallSession> {
  // The stored version is any past one, so it is read wider than RecallSession's.
  const saved = await loadSecureItem<Omit<Partial<RecallSession>, "version"> & { version?: number }>(
    storageKey(encounterId),
  )
  if (!saved || (saved.version !== 2 && saved.version !== 3)) return emptyRecallSession()
  return {
    version: 3,
    hypotheses: saved.hypotheses ?? [],
    entries: (saved.entries ?? []).map(migrateEntry),
    finalDiagnosis: saved.finalDiagnosis ?? [],
    timeline: saved.timeline,
    recallArchivedAt: saved.recallArchivedAt,
  }
}

/** Non-empty pieces of free text as one block, in the order given. */
function joinText(...parts: (string | undefined)[]): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join("\n")
}

/**
 * Rows from earlier cuts of this view. The first kept a single "why" and
 * "thinking" per stop, before the template put them per row; rows then kept
 * "why did you ask that?" beside "what were you thinking?" until the study
 * settled on one free-text reason for asking. Fold every legacy field into
 * the reason it belongs to — the first row that exists, or the notes when
 * there is none — so nothing typed is lost.
 */
type LegacyRating = RecallRating & { why?: string }

function migrateEntry(raw: RecallEntry & { why?: string; thinking?: string }): RecallEntry {
  const { why, thinking, ...entry } = raw
  const ratings: Record<string, RecallRating> = Object.fromEntries(
    Object.entries((entry.ratings ?? {}) as Record<string, LegacyRating>).map(([id, rating]) => [
      id,
      {
        reason: joinText(rating.why, rating.reason),
        likelihood: rating.likelihood ?? null,
        support: rating.support ?? null,
      },
    ]),
  )
  let notes = entry.notes ?? ""
  if (why?.trim() || thinking?.trim()) {
    const firstRow = Object.keys(ratings)[0]
    if (firstRow) {
      ratings[firstRow] = { ...ratings[firstRow], reason: joinText(ratings[firstRow].reason, why, thinking) }
    } else {
      notes = joinText(notes, why?.trim() && `Why: ${why.trim()}`, thinking?.trim() && `Thinking: ${thinking.trim()}`)
    }
  }
  return { ...entry, notes, ratings }
}

export function saveRecallSession(encounterId: string, session: RecallSession): Promise<void> {
  return saveSecureItem<RecallSession>(storageKey(encounterId), session)
}

/** Entries in transcript order: numbering follows the consultation, not the order the stops were made in. */
export function orderedEntries(session: RecallSession): RecallEntry[] {
  return [...session.entries].sort(
    (a, b) => (a.turns[0] ?? 0) - (b.turns[0] ?? 0) || a.createdAt.localeCompare(b.createdAt),
  )
}

/** The likelihood a hypothesis carries into the entry at `position`: the latest one reported before it. */
export function carriedLikelihood(ordered: RecallEntry[], position: number, hypothesisId: string): number | null {
  for (let i = position - 1; i >= 0; i--) {
    const value = ordered[i].ratings[hypothesisId]?.likelihood
    if (value !== null && value !== undefined) return value
  }
  return null
}

/** Hypotheses on the table at `position`: those first reported there or earlier. */
export function hypothesesAt(session: RecallSession, ordered: RecallEntry[], position: number): RecallHypothesis[] {
  const positionOf = new Map(ordered.map((entry, index) => [entry.id, index] as const))
  return session.hypotheses.filter((hypothesis) => (positionOf.get(hypothesis.entryId) ?? 0) <= position)
}

/**
 * Turns to step through. Diarised transcripts give real speaker turns; plain
 * transcripts fall back to sentence-ish chunks so the flow still works.
 */
export function toUtterances(transcript: string): TranscriptTurn[] {
  const turns = parseDiarizedTranscript(transcript?.trim() ?? "")
  if (turns && turns.length > 0) return turns
  const plain = (transcript ?? "").trim()
  if (!plain) return []
  return plain
    .split(/(?<=[.?!])\s+/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ speaker: 0, text }))
}

export interface RecallSessionSummary {
  hypotheses: number
  /** Stops with a table. */
  entries: number
  /** The recall interview has been recorded (audio on this device, or a finished timeline). */
  recorded: boolean
  archivedAt?: string
}

/**
 * Where a consultation's recall interview stands, for the recall list:
 * whether it has been started, how many stops it has, and whether it has
 * been recorded and archived. Reads the same stores the view persists to.
 */
export async function getRecallSessionSummary(encounterId: string): Promise<RecallSessionSummary> {
  const [session, audio] = await Promise.all([
    loadRecallSession(encounterId),
    getEncounterAudio(recallAudioKey(encounterId)),
  ])
  return {
    hypotheses: session.hypotheses.length,
    entries: session.entries.length,
    recorded: Boolean(audio) || Boolean(session.timeline?.stoppedAt),
    archivedAt: session.recallArchivedAt,
  }
}

export interface RecallPayloadInput {
  encounterId: string
  session: RecallSession
  turns: TranscriptTurn[]
  exchanges: RecallExchangeRange[]
  /** Whether the exchanges came from the model (true) or the question-mark heuristic (false). */
  exchangesDetected: boolean
  clinicianSpeaker?: number
  speakerLabel: (speaker: number) => string
}

/**
 * The session as archived and exported: every entry with the turns it is
 * about and every rating resolved, so a carried-over likelihood is written
 * out with its source rather than left for the reader to trace back.
 */
export function buildRecallPayload(input: RecallPayloadInput) {
  const { encounterId, session, turns, exchanges, exchangesDetected, clinicianSpeaker, speakerLabel } = input
  const ordered = orderedEntries(session)
  const questionTurns = new Set(exchanges.map((exchange) => exchange.question))
  const timeline = session.timeline
  return {
    schema_version: 3,
    encounter_id: encounterId,
    exported_at: new Date().toISOString(),
    clinician_speaker: clinicianSpeaker ?? null,
    exchanges: { source: exchangesDetected ? "model" : "heuristic", ranges: exchanges },
    hypotheses: session.hypotheses.map((hypothesis) => ({
      id: hypothesis.id,
      name: hypothesis.name,
      first_reported_at_entry: ordered.findIndex((entry) => entry.id === hypothesis.entryId) + 1 || null,
    })),
    entries: ordered.map((entry, position) => ({
      number: position + 1,
      id: entry.id,
      turns: entry.turns.map((index) => ({
        index,
        speaker: turns[index]?.speaker ?? null,
        speaker_label: turns[index] ? speakerLabel(turns[index].speaker) : null,
        text: turns[index]?.text ?? "",
      })),
      is_question: questionTurns.has(entry.turns[0]),
      notes: entry.notes,
      // The template's table, one row per diagnostic hypothesis.
      rows: hypothesesAt(session, ordered, position).map((hypothesis) => {
        const rating = entry.ratings[hypothesis.id]
        const reported = rating?.likelihood ?? null
        const carried = reported === null ? carriedLikelihood(ordered, position, hypothesis.id) : null
        return {
          hypothesis_id: hypothesis.id,
          hypothesis: hypothesis.name,
          reason: rating?.reason ?? "",
          likelihood: reported ?? carried,
          likelihood_source: reported !== null ? "reported" : carried !== null ? "carried" : null,
          support: rating?.support ?? null,
        }
      }),
      created_at: entry.createdAt,
    })),
    final_diagnosis: session.finalDiagnosis.map((row) => ({
      diagnosis: row.diagnosis,
      likelihood: row.likelihood,
      why: row.why,
      difficulty: row.difficulty,
    })),
    // Timing of the recall recording: segment the audio per turn by cutting
    // between consecutive clicks (offsets are recorded time, so they map
    // directly onto the audio file even across pauses).
    recording: timeline
      ? {
          started_at: timeline.startedAt,
          stopped_at: timeline.stoppedAt ?? null,
          duration_seconds: timeline.durationSeconds ?? null,
          utterance_clicks: timeline.utteranceClicks.map((click) => ({
            utterance: click.utterance,
            audio_offset_seconds: click.audioOffsetSeconds,
            at: click.at,
          })),
        }
      : null,
  }
}
