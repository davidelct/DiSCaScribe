/**
 * The recall session back from its archived form.
 *
 * Box holds the session as it is exported (recall_session.json, built by
 * buildRecallPayload in the render package): entries in transcript order with
 * every row resolved, carried-over likelihoods written out with their source.
 * The app stores the session it edits (RecallSession, version 3). That export
 * keeps every id and marks which likelihoods were reported, so it inverts
 * exactly; this turns it back. The shape is restated here, not imported, so
 * the pipeline stays free of the render package.
 */

export interface RestoredRecallSession {
  version: 3
  hypotheses: Array<{ id: string; name: string; entryId: string }>
  entries: Array<{
    id: string
    turns: number[]
    notes: string
    ratings: Record<string, { reason: string; likelihood: number | null; support: number | null }>
    createdAt: string
  }>
  finalDiagnosis: Array<{ id: string; diagnosis: string; likelihood: number | null; why: string; difficulty: string }>
  timeline?: {
    startedAt: string
    stoppedAt?: string
    durationSeconds?: number
    utteranceClicks: Array<{ utterance: number; audioOffsetSeconds: number; at: string }>
  }
  recallArchivedAt?: string
}

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

/** Whether a stored session is in the archived (exported) form rather than the app's own. */
export function isArchivedRecallPayload(value: unknown): boolean {
  return isObject(value) && typeof value.schema_version === "number" && value.version === undefined
}

/** The session as the app stores it, from recall_session.json; null when it is not one. */
export function recallSessionFromArchive(raw: unknown): RestoredRecallSession | null {
  if (!isArchivedRecallPayload(raw)) return null
  const payload = raw as Json

  const archivedEntries = list(payload.entries)
  const entries: RestoredRecallSession["entries"] = archivedEntries.map((entry, index) => {
    const ratings: RestoredRecallSession["entries"][number]["ratings"] = {}
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
      turns: list(entry.turns)
        .map((turn) => turn.index)
        .filter((turn): turn is number => Number.isInteger(turn)),
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

  const finalDiagnosis = list(payload.final_diagnosis).map((row, index) => ({
    id: `final-${index + 1}`,
    diagnosis: text(row.diagnosis),
    likelihood: numberOrNull(row.likelihood),
    why: text(row.why),
    difficulty: text(row.difficulty),
  }))

  const recording = isObject(payload.recording) ? payload.recording : null
  const timeline: RestoredRecallSession["timeline"] = recording
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
    version: 3,
    hypotheses,
    entries,
    finalDiagnosis,
    ...(timeline ? { timeline } : {}),
    ...(archivedAt ? { recallArchivedAt: archivedAt } : {}),
  }
}
