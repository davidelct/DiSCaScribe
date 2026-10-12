import {
  CURRENT_ANCHOR_SET,
  RECALL_TEMPLATE,
  VERBAL_ANCHOR_SETS,
  isAnchorSet,
  isArchivedRecallPayload,
  isTemplateRowV6,
  joinText,
  parseDiarizedTranscript,
  recallSessionFromArchive,
  templateEntryV6From,
  type AnchorSet,
  type Rating,
  type TemplateRowV5,
  type TemplateRowV6,
  type TranscriptTurn,
} from "@pipeline-errors"
import { loadSecureItem, saveSecureItem } from "@storage/secure-storage"
import { getEncounterAudio } from "@storage/audio-store"
import { getPreferences, setPreferences } from "@storage/preferences"
import {
  fetchSharedRecallSession,
  putSharedRecallSession,
  recallSessionUnsynced,
  RECALL_STORAGE_PREFIX,
} from "@storage/shared-store"

export type { AnchorSet, Rating }

/**
 * Stimulated recall (WT3.1) session data.
 *
 * The clinician goes back over the transcript with an interviewer,
 * highlighting the information (what the patient said, an examination or
 * investigation result) that was important for their thinking at the
 * time. A highlight is any set of turns ticked in the transcript; it is an
 * entry holding the template's three questions: the hypothesis (or
 * hypotheses) the information was important to, one row each, and for
 * every hypothesis how much the information supported it and how likely it
 * became at that stage, plus notes for the stop. The ratings are given on
 * one of two scale sets, chosen per session (see RatingScale). Sessions
 * are persisted per encounter in the shared store when the server has one
 * (so the recall can be reviewed from any laptop), with the encrypted
 * local store as a mirror.
 */

/**
 * The rating scales a session uses, being trialled side by side. Numeric:
 * likelihood 0–10, information support −10..+10, the case's difficulty as
 * free text. Verbal: the anchors of the session's anchor set (see
 * AnchorSet in the shared package; SR_TemplateV6's for new sessions). The
 * choice is made before any rating is given and then fixed for the
 * session, so a session is wholly on one set; the export records which.
 */
export type RatingScale = "numeric" | "verbal"

export const LIKELIHOOD_RANGE = { min: 0, max: 10 } as const
export const SUPPORT_RANGE = { min: -10, max: 10 } as const

/**
 * One row of a stop: a "Hypothesis N" box with its two ratings. A row
 * carried over from a session on the earlier template keeps its answers to
 * that template's two questions under `legacy`.
 */
export type RecallRow = TemplateRowV6

export interface RecallEntry {
  id: string
  /** Transcript turns the entry is about, ascending. */
  turns: number[]
  /** One per hypothesis named at this stop, in the order named. */
  rows: RecallRow[]
  /** Notes for the stop as a whole. */
  notes: string
  createdAt: string
}

export interface FinalDiagnosisRow {
  id: string
  diagnosis: string
  likelihood: Rating | null
  why: string
  /** How difficult the case was: free text on the numeric scales, an anchor on the verbal ones. */
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
  version: 6
  /** The scales every rating in the session is given on. */
  scale: RatingScale
  /**
   * The verbal anchors the session's verbal ratings are on. Fixed with the
   * scale once a rating is given; a session begun on an earlier set stays
   * on it. Unused on the numeric scales.
   */
  anchors: AnchorSet
  /** The version the session was begun on, when earlier than this one. */
  migratedFrom?: 2 | 3 | 4 | 5
  entries: RecallEntry[]
  finalDiagnosis: FinalDiagnosisRow[]
  /** Timing of the recall recording (replaced on re-record). */
  timeline?: RecallTimeline
  /** Set once the recall recording + session data have been archived. */
  recallArchivedAt?: string
}

export function emptyRecallSession(scale: RatingScale = "verbal"): RecallSession {
  return { version: 6, scale, anchors: CURRENT_ANCHOR_SET, entries: [], finalDiagnosis: [] }
}

/** The anchors a session's verbal ratings are given on. */
export function sessionAnchors(session: Pick<RecallSession, "anchors">) {
  return VERBAL_ANCHOR_SETS[session.anchors]
}

/**
 * The session after an edit, its anchor set kept honest: an earlier set is
 * held only while ratings on it remain, so once the last one is removed
 * (which also unlocks the scales) the session moves to the current set.
 */
export function sessionAnchorsAfterEdit(session: RecallSession): RecallSession {
  if (session.anchors === CURRENT_ANCHOR_SET || sessionHasRatings(session)) return session
  return { ...session, anchors: CURRENT_ANCHOR_SET }
}

/**
 * The scales a new session starts on: those last chosen in this browser,
 * verbal until a choice is made (the template in the interviewer's hand
 * draws the verbal scales). A run of interviews on one set then needs the
 * choice once; each session keeps its own afterwards.
 */
export function rememberedRecallScale(): RatingScale {
  return getPreferences().recallScale === "numeric" ? "numeric" : "verbal"
}

export function rememberRecallScale(scale: RatingScale): void {
  void setPreferences({ recallScale: scale }).catch(() => undefined)
}

/** Whether any rating has been given, after which the session's scales are fixed. */
export function sessionHasRatings(session: Pick<RecallSession, "entries" | "finalDiagnosis">): boolean {
  return (
    session.entries.some((entry) => entry.rows.some((row) => row.likelihood !== null || row.support !== null)) ||
    session.finalDiagnosis.some((row) => row.likelihood !== null || row.difficulty.trim() !== "")
  )
}

function storageKey(encounterId: string): string {
  return `${RECALL_STORAGE_PREFIX}${encounterId}`
}

/** Audio-store key for the recall-interview recording of an encounter. */
export function recallAudioKey(encounterId: string): string {
  return `recall:${encounterId}`
}

/**
 * The saved session, or an empty one. Versions 2 to 5 are migrated in place
 * (see migrateEntry and templateRowV6From) and overwritten on first save.
 * Version 4 sessions, from before the scales could be chosen, were on the
 * numeric ones; version 5 verbal sessions were on the September anchors.
 * Sessions from before the per-stop tables (per-utterance cue ratings on a
 * −3..+3 scale) are not carried over: the measure changed, so they start
 * afresh.
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

const KNOWN_VERSIONS = [2, 3, 4, 5, 6] as const

export async function loadRecallSession(encounterId: string): Promise<RecallSession> {
  const saved = await loadStoredSession(encounterId)
  const version = saved?.version ?? 0
  if (!saved || !(KNOWN_VERSIONS as readonly number[]).includes(version)) {
    return emptyRecallSession(rememberedRecallScale())
  }
  const hypotheses = saved.hypotheses ?? []
  const entries = (saved.entries ?? []).map((entry) => migrateEntry(entry, hypotheses))
  const finalDiagnosis = saved.finalDiagnosis ?? []
  const scale: RatingScale = saved.scale === "verbal" ? "verbal" : "numeric"
  // A verbal session rated before the anchors were named was on the
  // September set. An earlier set is kept only while the session holds
  // ratings on it (see sessionAnchorsAfterEdit); otherwise the current.
  const hasRatings = sessionHasRatings({ entries, finalDiagnosis })
  const anchors: AnchorSet =
    isAnchorSet(saved.anchors) && (saved.anchors === CURRENT_ANCHOR_SET || hasRatings)
      ? saved.anchors
      : scale === "verbal" && hasRatings
        ? "2026-09"
        : CURRENT_ANCHOR_SET
  const migratedFrom = version < 6 ? (version as 2 | 3 | 4 | 5) : saved.migratedFrom
  return {
    version: 6,
    scale,
    anchors,
    ...(migratedFrom ? { migratedFrom } : {}),
    entries,
    finalDiagnosis,
    timeline: saved.timeline,
    recallArchivedAt: saved.recallArchivedAt,
  }
}

/**
 * Sessions from earlier cuts of this view. Versions 2 and 3 kept a list of
 * named hypotheses shared across stops, and each stop rated every hypothesis
 * on its table (with a free-text reason beside it; the first cut had one
 * "why" and "thinking" per stop), with notes per stop. Versions 4 and 5
 * asked the template's two questions per row ("why did you ask", "what did
 * the answer tell you"), with notes per row. Every rating from 2 and 3
 * becomes such a row: its reason becomes the row's "why", prefixed with the
 * hypothesis it was written against, and the numbers carry over as they
 * were reported at that stop. Those rows then become V6 rows with the two
 * answers kept under `legacy`, and the notes, per stop or per row, gather
 * into the stop's notes (templateEntryV6From). Nothing typed is lost.
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
  rows?: Array<(Omit<TemplateRowV5, "notes"> & { notes?: string }) | TemplateRowV6>
  ratings?: Record<string, LegacyRating>
  why?: string
  thinking?: string
}
interface LegacySession extends Omit<RecallSession, "version" | "entries" | "anchors"> {
  anchors?: unknown
  hypotheses?: LegacyHypothesis[]
  entries?: LegacyEntry[]
}

function migrateEntry(raw: LegacyEntry, hypotheses: LegacyHypothesis[]): RecallEntry {
  const { why, thinking, ratings, rows, notes, ...entry } = raw
  const migrated: Array<TemplateRowV5 | TemplateRowV6> = rows
    ? rows.map((row) => (isTemplateRowV6(row) ? row : { ...row, notes: row.notes ?? "" }))
    : []
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
      const first = migrated[0]
      if (first && !isTemplateRowV6(first)) migrated[0] = { ...first, why: joinText(stopLevel, first.why) }
      else migrated.push({ id: crypto.randomUUID(), why: stopLevel, told: "", likelihood: null, support: null, notes: "" })
    }
  }
  const converted = templateEntryV6From(migrated, notes)
  return { ...entry, rows: converted.rows, notes: converted.notes }
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
  clinicianSpeaker?: number
  speakerLabel: (speaker: number) => string
}

/**
 * The session as archived and exported: every entry with the turns it is
 * about and its rows as entered; the template's questions and the scales
 * the ratings were given on, so the dataset names what each value answers.
 */
export function buildRecallPayload(input: RecallPayloadInput) {
  const { encounterId, session, turns, clinicianSpeaker, speakerLabel } = input
  const ordered = orderedEntries(session)
  const timeline = session.timeline
  return {
    schema_version: 6,
    encounter_id: encounterId,
    exported_at: new Date().toISOString(),
    template: {
      name: RECALL_TEMPLATE.name,
      questions: {
        hypothesis: RECALL_TEMPLATE.hypothesis,
        support: RECALL_TEMPLATE.support,
        likelihood: RECALL_TEMPLATE.likelihood,
        notes: RECALL_TEMPLATE.notes,
        legacy_v5: RECALL_TEMPLATE.legacyV5,
      },
    },
    migrated_from: session.migratedFrom ?? null,
    clinician_speaker: clinicianSpeaker ?? null,
    // The scales every rating below was given on. A rating is a number on
    // the numeric scales and the anchor's label on the verbal ones.
    scales:
      session.scale === "verbal"
        ? { kind: "verbal", anchor_set: session.anchors, ...sessionAnchors(session) }
        : { kind: "numeric", likelihood: LIKELIHOOD_RANGE, support: SUPPORT_RANGE, difficulty: "free text" },
    entries: ordered.map((entry, position) => ({
      number: position + 1,
      id: entry.id,
      turns: entry.turns.map((index) => ({
        index,
        speaker: turns[index]?.speaker ?? null,
        speaker_label: turns[index] ? speakerLabel(turns[index].speaker) : null,
        text: turns[index]?.text ?? "",
      })),
      // One row per hypothesis, its fields as entered; "Hypothesis N" is the row's position.
      rows: entry.rows.map((row) => ({
        id: row.id,
        hypothesis: row.hypothesis,
        support: row.support,
        likelihood: row.likelihood,
        legacy: row.legacy ?? null,
      })),
      notes: entry.notes,
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
