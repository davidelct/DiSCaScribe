/**
 * The recall session back from its archived form.
 *
 * Box holds the session as it is exported (recall_session.json, built by
 * buildRecallPayload in the render package): entries in transcript order with
 * every row as entered. The app stores the session it edits (RecallSession).
 * Exports keep every entry id, so they invert exactly; this turns one back.
 * Schema 6 exports (SR_TemplateV6: a hypothesis per row with its two
 * ratings, notes per stop, and the verbal anchor set named) restore to a
 * version 6 session; schema 5 exports (rows answering the earlier template's two
 * questions, rated on the scales the export names: numbers on the numeric
 * ones, anchor labels on the verbal ones) to version 5; schema 4 exports
 * (the same rows, before the scales could be chosen) to version 4; schema
 * 3 exports (named hypotheses rated per stop, with carried-over likelihoods
 * written out with their source) to the version 3 shape. The app migrates
 * the older three on load. The shapes are restated here, not imported, so
 * the pipeline stays free of the render package.
 */

import { CURRENT_ANCHOR_SET, isAnchorSet, type AnchorSet, type Rating } from "./recall-template"

interface RestoredBase {
  finalDiagnosis: Array<{ id: string; diagnosis: string; likelihood: Rating | null; why: string; difficulty: string }>
  timeline?: {
    startedAt: string
    stoppedAt?: string
    durationSeconds?: number
    utteranceClicks: Array<{ utterance: number; audioOffsetSeconds: number; at: string }>
  }
  recallArchivedAt?: string
}

interface RestoredTemplateEntry {
  id: string
  turns: number[]
  rows: Array<{
    id: string
    why: string
    told: string
    likelihood: Rating | null
    support: Rating | null
    notes: string
  }>
  createdAt: string
}

interface RestoredTemplateEntryV6 {
  id: string
  turns: number[]
  rows: Array<{
    id: string
    hypothesis: string
    support: Rating | null
    likelihood: Rating | null
    /** The answers a row carried over from before V6 gave to that template's questions. */
    legacy?: { why: string; told: string }
  }>
  notes: string
  createdAt: string
}

export interface RestoredRecallSessionV6 extends RestoredBase {
  version: 6
  scale: "numeric" | "verbal"
  anchors: AnchorSet
  /** The version the session was begun on, when earlier than 6. */
  migratedFrom?: 2 | 3 | 4 | 5
  entries: RestoredTemplateEntryV6[]
}

export interface RestoredRecallSessionV5 extends RestoredBase {
  version: 5
  scale: "numeric" | "verbal"
  entries: RestoredTemplateEntry[]
}

export interface RestoredRecallSessionV4 extends RestoredBase {
  version: 4
  entries: RestoredTemplateEntry[]
}

export interface RestoredRecallSessionV3 extends RestoredBase {
  version: 3
  hypotheses: Array<{ id: string; name: string; entryId: string }>
  entries: Array<{
    id: string
    turns: number[]
    notes: string
    ratings: Record<string, { reason: string; likelihood: number | null; support: number | null }>
    createdAt: string
  }>
}

export type RestoredRecallSession =
  | RestoredRecallSessionV6
  | RestoredRecallSessionV5
  | RestoredRecallSessionV4
  | RestoredRecallSessionV3

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isObject) : []
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function ratingOrNull(value: unknown): Rating | null {
  if (typeof value === "string") return value.trim() ? value : null
  return numberOrNull(value)
}

/** Whether a stored session is in the archived (exported) form rather than the app's own. */
export function isArchivedRecallPayload(value: unknown): boolean {
  return isObject(value) && typeof value.schema_version === "number" && value.version === undefined
}

function turnIndexes(entry: Json): number[] {
  return list(entry.turns)
    .map((turn) => turn.index)
    .filter((turn): turn is number => Number.isInteger(turn))
}

/** The session as the app stores it, from recall_session.json; null when it is not one. */
export function recallSessionFromArchive(raw: unknown): RestoredRecallSession | null {
  if (!isArchivedRecallPayload(raw)) return null
  const payload = raw as Json
  const shared = restoreShared(payload)

  if (payload.schema_version === 6) {
    const scales = isObject(payload.scales) ? payload.scales : null
    const entries: RestoredTemplateEntryV6[] = list(payload.entries).map((entry, index) => ({
      id: text(entry.id) || `entry-${index + 1}`,
      turns: turnIndexes(entry),
      rows: list(entry.rows).map((row, rowIndex) => ({
        id: text(row.id) || `row-${index + 1}-${rowIndex + 1}`,
        hypothesis: text(row.hypothesis),
        support: ratingOrNull(row.support),
        likelihood: ratingOrNull(row.likelihood),
        ...(isObject(row.legacy) ? { legacy: { why: text(row.legacy.why), told: text(row.legacy.told) } } : {}),
      })),
      notes: text(entry.notes),
      createdAt: text(entry.created_at),
    }))
    const migratedFrom = payload.migrated_from
    return {
      version: 6,
      scale: scales?.kind === "verbal" ? "verbal" : "numeric",
      anchors: isAnchorSet(scales?.anchor_set) ? scales.anchor_set : CURRENT_ANCHOR_SET,
      ...(migratedFrom === 2 || migratedFrom === 3 || migratedFrom === 4 || migratedFrom === 5 ? { migratedFrom } : {}),
      entries,
      ...shared,
    }
  }

  if (payload.schema_version === 4 || payload.schema_version === 5) {
    const entries: RestoredTemplateEntry[] = list(payload.entries).map((entry, index) => ({
      id: text(entry.id) || `entry-${index + 1}`,
      turns: turnIndexes(entry),
      rows: list(entry.rows).map((row, rowIndex) => ({
        id: text(row.id) || `row-${index + 1}-${rowIndex + 1}`,
        why: text(row.why),
        told: text(row.told),
        likelihood: ratingOrNull(row.likelihood),
        support: ratingOrNull(row.support),
        notes: text(row.notes),
      })),
      createdAt: text(entry.created_at),
    }))
    if (payload.schema_version === 4) return { version: 4, entries, ...shared }
    const scales = isObject(payload.scales) ? payload.scales : null
    return { version: 5, scale: scales?.kind === "verbal" ? "verbal" : "numeric", entries, ...shared }
  }

  const archivedEntries = list(payload.entries)
  const entries: RestoredRecallSessionV3["entries"] = archivedEntries.map((entry, index) => {
    const ratings: RestoredRecallSessionV3["entries"][number]["ratings"] = {}
    for (const row of list(entry.rows)) {
      const hypothesisId = text(row.hypothesis_id)
      if (!hypothesisId) continue
      // A carried likelihood belongs to an earlier stop; only a reported one is this stop's.
      // Exports from before the source was recorded count every likelihood as reported.
      const likelihood = row.likelihood_source === "carried" ? null : numberOrNull(row.likelihood)
      const reason = text(row.reason)
      const support = numberOrNull(row.support)
      if (!reason && likelihood === null && support === null) continue
      ratings[hypothesisId] = { reason, likelihood, support }
    }
    return {
      id: text(entry.id) || `entry-${index + 1}`,
      turns: turnIndexes(entry),
      notes: text(entry.notes),
      ratings,
      createdAt: text(entry.created_at),
    }
  })

  const hypotheses = list(payload.hypotheses)
    .filter((hypothesis) => text(hypothesis.id))
    .map((hypothesis) => {
      const position = numberOrNull(hypothesis.first_reported_at_entry)
      return {
        id: text(hypothesis.id),
        name: text(hypothesis.name),
        entryId: position !== null ? (entries[position - 1]?.id ?? "") : "",
      }
    })

  return { version: 3, hypotheses, entries, ...shared }
}

/** The parts every export carries the same way: the final diagnosis, the recording timeline, the archive mark. */
function restoreShared(payload: Json): RestoredBase {
  const finalDiagnosis = list(payload.final_diagnosis).map((row, index) => ({
    id: `final-${index + 1}`,
    diagnosis: text(row.diagnosis),
    likelihood: ratingOrNull(row.likelihood),
    why: text(row.why),
    difficulty: text(row.difficulty),
  }))

  const recording = isObject(payload.recording) ? payload.recording : null
  const timeline: RestoredBase["timeline"] = recording
    ? {
        startedAt: text(recording.started_at),
        ...(text(recording.stopped_at) ? { stoppedAt: text(recording.stopped_at) } : {}),
        ...(numberOrNull(recording.duration_seconds) !== null
          ? { durationSeconds: numberOrNull(recording.duration_seconds)! }
          : {}),
        utteranceClicks: list(recording.utterance_clicks)
          .filter((click) => Number.isInteger(click.utterance))
          .map((click) => ({
            utterance: click.utterance as number,
            audioOffsetSeconds: numberOrNull(click.audio_offset_seconds) ?? 0,
            at: text(click.at),
          })),
      }
    : undefined

  // The session counts as archived once its recording was: the export is
  // also refreshed while the tables are edited, before any recording exists.
  const archivedAt = timeline?.stoppedAt ? text(payload.exported_at) || timeline.stoppedAt : undefined

  return {
    finalDiagnosis,
    ...(timeline ? { timeline } : {}),
    ...(archivedAt ? { recallArchivedAt: archivedAt } : {}),
  }
}
