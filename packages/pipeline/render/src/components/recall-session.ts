import {
  isArchivedRecallPayload,
  parseDiarizedTranscript,
  recallSessionFromArchive,
  type RecallExchangeRange,
  type TranscriptTurn,
} from "@pipeline-errors"
import { loadSecureItem, saveSecureItem } from "@storage/secure-storage"
import { getEncounterAudio } from "@storage/audio-store"
import {
  fetchSharedRecallSession,
  putSharedRecallSession,
  recallSessionUnsynced,
  RECALL_STORAGE_PREFIX,
} from "@storage/shared-store"

/**
 * Stimulated recall (WT3.1) session data.
 *
 * The clinician goes back over the transcript with an interviewer and stops
 * at turns of their choosing. Each stop is an entry holding the study's
 * template: a table with one row per thought, where a row answers "why did
 * you ask this question / these questions? did you have specific hypotheses
 * in mind?", "what did the answer(s) tell you? did it/they suggest specific
 * hypotheses?", gives a likelihood (0–10) and an information support
 * (−10..+10), and takes notes. A vague takeaway is a row with the text and
 * no numbers; the numbers come once a hypothesis has formed, which may be a
 * later row at a later stop. Sessions are persisted per encounter in the
 * shared store when the server has one (so the recall can be reviewed from
 * any laptop), with the encrypted local store as a mirror.
 */

/** One row of a stop's table. */
export interface RecallRow {
  id: string
  /** "Why did you ask this question / these questions? Did you have specific hypotheses in mind?" */
  why: string
  /** "What did the answer(s) tell you? Did it/they suggest specific hypotheses?" */
  told: string
  /** 0–10; null until a hypothesis has formed enough to rate. */
  likelihood: number | null
  /** −10..+10; null until rated. */
  support: number | null
  notes: string
}

export interface RecallEntry {
  id: string
  /** Transcript turns the entry is about, ascending. */
  turns: number[]
  rows: RecallRow[]
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
  version: 4
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
  return { version: 4, entries: [], finalDiagnosis: [] }
}

function storageKey(encounterId: string): string {
  return `${RECALL_STORAGE_PREFIX}${encounterId}`
}

/** Audio-store key for the recall-interview recording of an encounter. */
export function recallAudioKey(encounterId: string): string {
  return `recall:${encounterId}`
}

/**
 * The saved session, or an empty one. Version 2 and 3 sessions are migrated
 * in place (see migrateEntry) and overwritten on first save. Sessions from
 * before the per-stop tables (per-utterance cue ratings on a −3..+3 scale)
 * are not carried over: the measure changed, so they start afresh.
 */
type StoredRecallSession = Partial<LegacySession> & { version?: number }

/**
 * The session to show: the shared store's copy, unless this browser holds
 * one the store has not taken yet (or has none at all), which is then handed
 * over. Without a reachable store, the local copy.
 */
async function loadStoredSession(encounterId: string): Promise<StoredRecallSession | null> {
  // The stored version is any past one, so it is read wider than RecallSession's.
  const local = readable(await loadSecureItem<unknown>(storageKey(encounterId)))
  const shared = await fetchSharedRecallSession(encounterId)
  if (shared.status !== "ok") return local
  const stored = shared.value.session
  const remote = readable(stored)
  if (local && (!remote || recallSessionUnsynced(encounterId))) {
    void putSharedRecallSession(encounterId, local)
    return local
  }
  if (remote) {
    void saveSecureItem(storageKey(encounterId), remote)
    // A session recovered from the archive in its exported form: store it back as the app's own.
    if (isArchivedRecallPayload(stored)) void putSharedRecallSession(encounterId, remote)
  }
  return remote
}

/** A stored session in the app's form; one restored from the archive in its exported form is converted. */
function readable(stored: unknown): StoredRecallSession | null {
  if (!stored) return null
  return (recallSessionFromArchive(stored) as StoredRecallSession | null) ?? (stored as StoredRecallSession)
}

export async function loadRecallSession(encounterId: string): Promise<RecallSession> {
  const saved = await loadStoredSession(encounterId)
  if (!saved || (saved.version !== 2 && saved.version !== 3 && saved.version !== 4)) return emptyRecallSession()
  const hypotheses = saved.hypotheses ?? []
  return {
    version: 4,
    entries: (saved.entries ?? []).map((entry) => migrateEntry(entry, hypotheses)),
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
 * Sessions from earlier cuts of this view. Versions 2 and 3 kept a list of
 * named hypotheses shared across stops, and each stop rated every hypothesis
 * on its table (with a free-text reason beside it; the first cut had one
 * "why" and "thinking" per stop). The template now asks its questions per
 * row, so every rating becomes a row: its reason becomes the row's "why",
 * prefixed with the hypothesis it was written against, and the numbers
 * carry over as they were reported at that stop. Notes kept per stop go to
 * the stop's first row. Nothing typed is lost.
 */
interface LegacyRating {
  reason?: string
  why?: string
  likelihood?: number | null
  support?: number | null
}
interface LegacyHypothesis {
  id: string
  name: string
}
interface LegacyEntry {
  id: string
  turns: number[]
  notes?: string
  createdAt: string
  rows?: Array<Omit<RecallRow, "notes"> & { notes?: string }>
  ratings?: Record<string, LegacyRating>
  why?: string
  thinking?: string
}
interface LegacySession extends Omit<RecallSession, "version" | "entries"> {
  hypotheses?: LegacyHypothesis[]
  entries?: LegacyEntry[]
}

function migrateEntry(raw: LegacyEntry, hypotheses: LegacyHypothesis[]): RecallEntry {
  const { why, thinking, ratings, rows, notes, ...entry } = raw
  const migrated: RecallRow[] = rows ? rows.map((row) => ({ ...row, notes: row.notes ?? "" })) : []
  if (!rows) {
    const nameOf = (id: string) => hypotheses.find((hypothesis) => hypothesis.id === id)?.name
    for (const [id, rating] of Object.entries(ratings ?? {})) {
      const reason = joinText(rating.why, rating.reason)
      const name = nameOf(id)
      migrated.push({
        id: crypto.randomUUID(),
        why: name ? (reason ? `${name}: ${reason}` : name) : reason,
        told: "",
        likelihood: rating.likelihood ?? null,
        support: rating.support ?? null,
        notes: "",
      })
    }
    const stopLevel = joinText(why, thinking)
    if (stopLevel) {
      if (migrated[0]) migrated[0] = { ...migrated[0], why: joinText(stopLevel, migrated[0].why) }
      else migrated.push({ id: crypto.randomUUID(), why: stopLevel, told: "", likelihood: null, support: null, notes: "" })
    }
  }
  if (notes?.trim()) {
    if (migrated[0]) migrated[0] = { ...migrated[0], notes: joinText(migrated[0].notes, notes) }
    else migrated.push({ id: crypto.randomUUID(), why: "", told: "", likelihood: null, support: null, notes: notes.trim() })
  }
  return { ...entry, rows: migrated }
}

export async function saveRecallSession(encounterId: string, session: RecallSession): Promise<void> {
  await saveSecureItem<RecallSession>(storageKey(encounterId), session)
  await putSharedRecallSession(encounterId, session)
}

/** Entries in transcript order: numbering follows the consultation, not the order the stops were made in. */
export function orderedEntries(session: RecallSession): RecallEntry[] {
  return [...session.entries].sort(
    (a, b) => (a.turns[0] ?? 0) - (b.turns[0] ?? 0) || a.createdAt.localeCompare(b.createdAt),
  )
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
  /** Stops with a table. */
  entries: number
  /** Rows across every stop. */
  rows: number
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
    entries: session.entries.length,
    rows: session.entries.reduce((count, entry) => count + entry.rows.length, 0),
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
 * about and its rows as entered.
 */
export function buildRecallPayload(input: RecallPayloadInput) {
  const { encounterId, session, turns, exchanges, exchangesDetected, clinicianSpeaker, speakerLabel } = input
  const ordered = orderedEntries(session)
  const questionTurns = new Set(exchanges.map((exchange) => exchange.question))
  const timeline = session.timeline
  return {
    schema_version: 4,
    encounter_id: encounterId,
    exported_at: new Date().toISOString(),
    clinician_speaker: clinicianSpeaker ?? null,
    exchanges: { source: exchangesDetected ? "model" : "heuristic", ranges: exchanges },
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
      // The template's table: one row per thought, its fields as entered.
      rows: entry.rows.map((row) => ({
        why: row.why,
        told: row.told,
        likelihood: row.likelihood,
        support: row.support,
        notes: row.notes,
      })),
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
