/**
 * Rebuild consultations from the Box archive.
 *
 * Every archived consultation has a folder `<YYYY-MM-DD>_<encounterId>` holding
 * metadata.json, transcript.txt, raw_transcript.json, note_v<N>.md and, once a
 * stimulated recall was finished, recall_session.json (see archival/archive.ts).
 * That is enough to put the consultation back in the app. What the archive
 * lacks is re-derived or left out:
 * - the recall exchanges are detected again when the recall view opens;
 * - word confidence is rebuilt from raw_transcript.json, and kept only when
 *   the rebuilt text matches transcript.txt (older diarizers laid lines out
 *   differently, and misplaced marks are worse than none);
 * - each note version's exact time is unknown, so versions are dated at the
 *   archive time.
 */

import type { Encounter, EncounterMode, NoteVersion, NoteVersionSource } from "@storage/types"
import { transcriptFromDeepgramResponse } from "@transcription"
import type { StorageClient } from "@/lib/archival"

const CONTAINER_PATTERN = /^(\d{4}-\d{2}-\d{2})_(.+)$/
const NOTE_VERSION_PATTERN = /^note_v(\d+)\.md$/

/** The encounter id a container belongs to, or null for a folder that is not a consultation. */
export function encounterIdOfContainer(name: string): string | null {
  return CONTAINER_PATTERN.exec(name)?.[2] ?? null
}

interface ArchivedMetadata {
  encounterId?: string
  sessionId?: string
  createdAt?: string
  archivedAt?: string
  patient?: { name?: string; id?: string }
  visitReason?: string
  language?: string
  mode?: string
  recordingDurationSeconds?: number | null
  capture?: { microphoneProcessing?: string | null }
  note?: { version?: number; source?: string | null; approved?: boolean } | null
}

export interface ArchivedConsultation {
  folderId: string
  folderName: string
  /** Text of the files the rebuild reads, by filename; absent files are missing. */
  files: Record<string, string>
}

function parseJson<T>(text: string | undefined): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

const NOTE_SOURCES: NoteVersionSource[] = ["generated", "manual", "edited", "approved"]

/** A consultation as the app stores it, rebuilt from its archive folder; null for a non-consultation folder. */
export function encounterFromArchive(archived: ArchivedConsultation): Encounter | null {
  const match = CONTAINER_PATTERN.exec(archived.folderName)
  if (!match) return null
  const [, date, folderEncounterId] = match
  const { files } = archived
  const meta = parseJson<ArchivedMetadata>(files["metadata.json"]) ?? {}

  const createdAt = meta.createdAt || `${date}T00:00:00.000Z`
  const archivedAt = meta.archivedAt || createdAt
  const transcript = files["transcript.txt"] ?? ""

  const noteNames = Object.keys(files)
    .filter((name) => NOTE_VERSION_PATTERN.test(name))
    .sort((a, b) => Number(NOTE_VERSION_PATTERN.exec(a)![1]) - Number(NOTE_VERSION_PATTERN.exec(b)![1]))

  // Recording-only consultations are the ones whose first note the clinician
  // wrote, or that have no note at all; metadata records the mode itself from
  // now on.
  const mode: EncounterMode =
    meta.mode === "scribed" || meta.mode === "recording_only"
      ? meta.mode
      : meta.note?.source === "manual" || noteNames.length === 0
        ? "recording_only"
        : "scribed"

  const noteVersions: NoteVersion[] = noteNames.map((name) => {
    const version = Number(NOTE_VERSION_PATTERN.exec(name)![1])
    const recorded = meta.note?.version === version ? meta.note.source : undefined
    const source: NoteVersionSource = NOTE_SOURCES.includes(recorded as NoteVersionSource)
      ? (recorded as NoteVersionSource)
      : version === 0
        ? mode === "recording_only"
          ? "manual"
          : "generated"
        : "edited"
    return { version, source, note_text: files[name], created_at: archivedAt }
  })
  const latest = noteVersions.at(-1)
  const approved = "note_approved.md" in files || meta.note?.approved === true

  let confidence: Encounter["transcript_confidence"]
  const raw = parseJson<unknown>(files["raw_transcript.json"])
  if (raw && transcript) {
    const rebuilt = transcriptFromDeepgramResponse(raw)
    if (rebuilt.text === transcript) confidence = rebuilt.words
  }

  const microphone = meta.capture?.microphoneProcessing
  return {
    id: meta.encounterId || folderEncounterId,
    patient_name: meta.patient?.name ?? "",
    patient_id: meta.patient?.id ?? "",
    visit_reason: meta.visitReason ?? "",
    session_id: meta.sessionId,
    created_at: createdAt,
    updated_at: archivedAt,
    transcript_text: transcript,
    ...(confidence ? { transcript_confidence: confidence } : {}),
    note_text: latest?.note_text ?? "",
    ...(latest
      ? { note_version: latest.version, note_versions: noteVersions, note_archive_status: "archived" as const }
      : {}),
    ...(approved ? { approval_status: "approved" as const, approved_at: archivedAt } : {}),
    status: transcript ? "completed" : "transcription_failed",
    mode,
    language: meta.language || "en",
    ...(typeof meta.recordingDurationSeconds === "number"
      ? { recording_duration: meta.recordingDurationSeconds }
      : {}),
    ...(microphone === "browser" || microphone === "raw" ? { microphone_processing: microphone } : {}),
    archive_status: "archived",
    archive_location: archived.folderId,
    archived_at: archivedAt,
  }
}

/** The archive files the rebuild reads; audio stays in Box and is streamed on demand. */
function isRecoveredFile(name: string): boolean {
  return (
    name === "metadata.json" ||
    name === "transcript.txt" ||
    name === "raw_transcript.json" ||
    name === "note_approved.md" ||
    name === "recall_session.json" ||
    NOTE_VERSION_PATTERN.test(name)
  )
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

export interface RecoveredConsultation {
  encounter: Encounter
  recallSession?: unknown
}

export interface RecoveryResult {
  recovered: RecoveredConsultation[]
  /** Folders that could not be read, with the reason. */
  failed: Array<{ folder: string; error: string }>
}

/**
 * Read every consultation folder in the archive, skipping the encounter ids
 * in `skip` (already in the store) so a re-run only fetches what is new.
 */
export async function recoverFromArchive(client: StorageClient, skip: Set<string>): Promise<RecoveryResult> {
  const containers = (await client.listContainers()).filter((container) => {
    const id = encounterIdOfContainer(container.name)
    return id !== null && !skip.has(id)
  })
  const failed: RecoveryResult["failed"] = []
  const results = await mapWithConcurrency(containers, 4, async (container): Promise<RecoveredConsultation | null> => {
    try {
      const listing = await client.listFiles(container.id)
      const files: Record<string, string> = {}
      await Promise.all(
        [...listing.values()]
          .filter((file) => isRecoveredFile(file.name))
          .map(async (file) => {
            files[file.name] = await (await client.downloadFile(file.id)).text()
          }),
      )
      const encounter = encounterFromArchive({ folderId: container.id, folderName: container.name, files })
      if (!encounter) return null
      const recallSession = parseJson<unknown>(files["recall_session.json"]) ?? undefined
      return { encounter, recallSession }
    } catch (error) {
      failed.push({ folder: container.name, error: error instanceof Error ? error.message : String(error) })
      return null
    }
  })
  return { recovered: results.filter((result): result is RecoveredConsultation => result !== null), failed }
}
