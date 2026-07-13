/**
 * Archive one consultation to the configured storage backend, in two phases.
 *
 * Lays out a self-contained, analyzable container per consultation (a Box
 * folder, or an R2 key prefix):
 *
 *   <container>/
 *     audio.wav            the consult recording (omitted if unavailable)
 *     transcript.txt       Deepgram transcript, diarized (Speaker N: …)
 *     raw_transcript.json  Deepgram's full response (word timings, confidence)
 *     note.md              Claude-generated SOAP note
 *     metadata.json        structured sidecar tying it all together
 *
 * The two phases exist because the artifacts become available in different
 * requests, and on serverless the safe rule is "upload from the request that
 * holds the bytes" (in-memory state is not shared across function instances):
 *
 *   - Phase 1 (archiveTranscriptionArtifacts) runs inside the transcription
 *     request, which physically holds the audio and the raw Deepgram JSON.
 *   - Phase 2 (archiveNoteAndMetadata) runs once the clinical note exists, and
 *     writes note.md plus the metadata.json manifest.
 *
 * Both phases derive the same container name from (createdAt, encounterId) and
 * uploads are idempotent (Box writes a new version; R2 overwrites the key), so
 * they compose regardless of order or which instance each runs on.
 *
 * The container name deliberately avoids PHI (uses the encounter id, not the
 * patient name); identifying detail lives inside metadata.json within the
 * access-controlled container.
 */

import type { StorageClient, StorageFileRef } from "./types"

const METADATA_SCHEMA_VERSION = 1

function datePrefix(iso: string): string {
  // YYYY-MM-DD from an ISO timestamp. Both phases must agree on this, so an
  // empty/invalid value resolves to a fixed sentinel rather than anything
  // request-specific (e.g. the archival time), which would diverge per phase.
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso)
  if (match) return match[1]
  const trimmed = iso.trim()
  return trimmed ? trimmed.slice(0, 10) : "undated"
}

function containerNameFor(createdAt: string, encounterId: string): string {
  return `${datePrefix(createdAt)}_${encounterId}`
}

function audioExtension(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename)
  return match ? `.${match[1].toLowerCase()}` : ".wav"
}

export interface ArchiveAudioInput {
  buffer: Buffer
  contentType: string
  filename: string
}

// ---------------------------------------------------------------------------
// Phase 1 — heavy artifacts, uploaded from the transcription request.
// ---------------------------------------------------------------------------

export interface ArchiveTranscriptionInput {
  client: StorageClient
  encounterId: string
  /** Encounter creation timestamp; only the date is used (for the container name). */
  createdAt: string
  transcriptText: string
  rawTranscript?: unknown
  audio?: ArchiveAudioInput
}

export interface TranscriptionArchiveResult {
  folderId: string
  folderUrl: string
  /** Names of the files written in this phase. */
  uploaded: string[]
}

/**
 * Upload the audio, raw Deepgram JSON, and diarized transcript to the consult's
 * container. Creates (or reuses) the container and writes each artifact,
 * overwriting any prior copy.
 */
export async function archiveTranscriptionArtifacts(
  input: ArchiveTranscriptionInput,
): Promise<TranscriptionArchiveResult> {
  const { client } = input
  const containerId = await client.ensureContainer(
    containerNameFor(input.createdAt, input.encounterId),
  )
  const existing = await client.listFiles(containerId)

  const jobs: Array<{ name: string; data: Buffer; contentType: string }> = []
  if (input.audio) {
    jobs.push({
      name: `audio${audioExtension(input.audio.filename)}`,
      data: input.audio.buffer,
      contentType: input.audio.contentType,
    })
  }
  if (input.transcriptText) {
    jobs.push({
      name: "transcript.txt",
      data: Buffer.from(input.transcriptText, "utf8"),
      contentType: "text/plain; charset=utf-8",
    })
  }
  if (input.rawTranscript !== undefined && input.rawTranscript !== null) {
    jobs.push({
      name: "raw_transcript.json",
      data: Buffer.from(JSON.stringify(input.rawTranscript, null, 2), "utf8"),
      contentType: "application/json",
    })
  }

  const uploaded = await Promise.all(
    jobs.map(async (job) => {
      await client.uploadFile(containerId, job.name, job.data, job.contentType, existing.get(job.name)?.id)
      return job.name
    }),
  )

  return { folderId: containerId, folderUrl: client.containerUrl(containerId), uploaded }
}

// ---------------------------------------------------------------------------
// Stimulated recall — recall-interview audio + session data, uploaded when the
// clinician finishes a recall session (any time after the consultation).
// ---------------------------------------------------------------------------

export interface ArchiveRecallInput {
  client: StorageClient
  encounterId: string
  /** Encounter creation timestamp; only the date is used (for the container name). */
  createdAt: string
  /** The recall-interview recording. */
  audio?: ArchiveAudioInput
  /** Recall session data (hypotheses + cue ratings), stored as JSON. */
  session?: unknown
}

/**
 * Upload the stimulated-recall artifacts to the consultation's container:
 * recall_audio.<ext> (the recorded recall interview) and recall_session.json
 * (hypotheses + cue ratings). Overwrites prior copies, so a re-run recall
 * session replaces the previous one.
 */
export async function archiveRecallArtifacts(input: ArchiveRecallInput): Promise<TranscriptionArchiveResult> {
  const { client } = input
  const containerId = await client.ensureContainer(
    containerNameFor(input.createdAt, input.encounterId),
  )
  const existing = await client.listFiles(containerId)

  const jobs: Array<{ name: string; data: Buffer; contentType: string }> = []
  if (input.audio) {
    jobs.push({
      name: `recall_audio${audioExtension(input.audio.filename)}`,
      data: input.audio.buffer,
      contentType: input.audio.contentType,
    })
  }
  if (input.session !== undefined && input.session !== null) {
    jobs.push({
      name: "recall_session.json",
      data: Buffer.from(JSON.stringify(input.session, null, 2), "utf8"),
      contentType: "application/json",
    })
  }

  const uploaded = await Promise.all(
    jobs.map(async (job) => {
      await client.uploadFile(containerId, job.name, job.data, job.contentType, existing.get(job.name)?.id)
      return job.name
    }),
  )

  return { folderId: containerId, folderUrl: client.containerUrl(containerId), uploaded }
}

// ---------------------------------------------------------------------------
// Phase 2 — note + metadata manifest, uploaded once the note exists.
// ---------------------------------------------------------------------------

export interface ArchiveNoteInput {
  client: StorageClient
  encounterId: string
  sessionId: string
  createdAt: string
  archivedAt: string
  patient: { name: string; id: string }
  visitReason: string
  language: string
  recordingDurationSeconds?: number
  transcription: { provider: string; model: string; diarized: boolean }
  /** Absent for recording-only consultations, which generate no note. */
  note?: { text: string; model: string; format: string }
  /** Used only to backfill transcript.txt if phase 1 did not write it. */
  transcriptText: string
}

export interface ArchiveResult {
  folderId: string
  folderUrl: string
  files: Record<string, StorageFileRef>
  /** Every artifact present in the container after this phase. */
  artifacts: string[]
}

/**
 * Write note.md (when a note exists — recording-only consultations have none)
 * and the metadata.json manifest to the consult's container. The manifest
 * reflects which artifacts actually landed (phase 1 may have partially failed
 * or not run), and transcript.txt is backfilled here if it is missing.
 */
export async function archiveNoteAndMetadata(input: ArchiveNoteInput): Promise<ArchiveResult> {
  const { client } = input
  const containerId = await client.ensureContainer(
    containerNameFor(input.createdAt, input.encounterId),
  )
  const existing = await client.listFiles(containerId)

  const files: Record<string, StorageFileRef> = {}

  if (input.note) {
    files["note.md"] = await client.uploadFile(
      containerId,
      "note.md",
      Buffer.from(input.note.text, "utf8"),
      "text/markdown; charset=utf-8",
      existing.get("note.md")?.id,
    )
  }

  // Backfill the transcript if phase 1 never wrote it (it failed, or this
  // consult came through a path that skipped phase 1).
  if (!existing.has("transcript.txt") && input.transcriptText) {
    files["transcript.txt"] = await client.uploadFile(
      containerId,
      "transcript.txt",
      Buffer.from(input.transcriptText, "utf8"),
      "text/plain; charset=utf-8",
    )
  }

  // Truth comes from the container, not from what we expected to upload.
  const present = new Set<string>([...existing.keys(), ...Object.keys(files)])
  const audioName = [...present].find((name) => /^audio\./.test(name)) ?? null

  const metadata = {
    schemaVersion: METADATA_SCHEMA_VERSION,
    encounterId: input.encounterId,
    sessionId: input.sessionId,
    createdAt: input.createdAt,
    archivedAt: input.archivedAt,
    patient: { name: input.patient.name, id: input.patient.id },
    visitReason: input.visitReason,
    language: input.language,
    recordingDurationSeconds: input.recordingDurationSeconds ?? null,
    transcription: input.transcription,
    note: input.note ? { model: input.note.model, format: input.note.format } : null,
    files: {
      audio: audioName,
      transcript: present.has("transcript.txt") ? "transcript.txt" : null,
      rawTranscript: present.has("raw_transcript.json") ? "raw_transcript.json" : null,
      note: present.has("note.md") ? "note.md" : null,
      metadata: "metadata.json",
    },
  }

  files["metadata.json"] = await client.uploadFile(
    containerId,
    "metadata.json",
    Buffer.from(JSON.stringify(metadata, null, 2), "utf8"),
    "application/json",
    existing.get("metadata.json")?.id,
  )

  present.add("metadata.json")
  return { folderId: containerId, folderUrl: client.containerUrl(containerId), files, artifacts: [...present] }
}
