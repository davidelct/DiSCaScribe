/**
 * Archive one consultation to Box, in two phases.
 *
 * Lays out a self-contained, analyzable folder per consultation:
 *
 *   <Working folder>/
 *     <YYYY-MM-DD>_<encounterId>/
 *       audio.wav            the consult recording (omitted if unavailable)
 *       transcript.txt       Deepgram transcript, diarized (Speaker N: …)
 *       raw_transcript.json  Deepgram's full response (word timings, confidence)
 *       note.md              Claude-generated SOAP note
 *       metadata.json        structured sidecar tying it all together
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
 * Both phases derive the same folder name from (createdAt, encounterId) and
 * uploads are version-on-conflict idempotent, so they compose regardless of
 * order or which instance each runs on.
 *
 * The folder name deliberately avoids PHI (uses the encounter id, not the
 * patient name); identifying detail lives inside metadata.json within the
 * access-controlled folder.
 */

import type { BoxConfig } from "./config"
import { BoxClient, type BoxFileRef } from "./client"

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

function folderNameFor(createdAt: string, encounterId: string): string {
  return `${datePrefix(createdAt)}_${encounterId}`
}

function audioExtension(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename)
  return match ? `.${match[1].toLowerCase()}` : ".wav"
}

function folderUrlFor(folderId: string): string {
  return `https://app.box.com/folder/${folderId}`
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
  config: BoxConfig
  encounterId: string
  /** Encounter creation timestamp; only the date is used (for the folder name). */
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
 * Box folder. Creates (or reuses) the folder and writes each artifact as a new
 * version if it already exists.
 */
export async function archiveTranscriptionArtifacts(
  input: ArchiveTranscriptionInput,
): Promise<TranscriptionArchiveResult> {
  const client = BoxClient.fromConfig(input.config)
  // ensureSubfolder mints + caches the auth token first, so the parallel
  // uploads below reuse it instead of each minting their own.
  const folderId = await client.ensureSubfolder(
    input.config.folderId,
    folderNameFor(input.createdAt, input.encounterId),
  )
  const existing = await client.listFolderFiles(folderId)

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
      await client.uploadFile(folderId, job.name, job.data, job.contentType, existing.get(job.name)?.id)
      return job.name
    }),
  )

  return { folderId, folderUrl: folderUrlFor(folderId), uploaded }
}

// ---------------------------------------------------------------------------
// Phase 2 — note + metadata manifest, uploaded once the note exists.
// ---------------------------------------------------------------------------

export interface ArchiveNoteInput {
  config: BoxConfig
  encounterId: string
  sessionId: string
  createdAt: string
  archivedAt: string
  patient: { name: string; id: string }
  visitReason: string
  language: string
  recordingDurationSeconds?: number
  transcription: { provider: string; model: string; diarized: boolean }
  note: { text: string; model: string; format: string }
  /** Used only to backfill transcript.txt if phase 1 did not write it. */
  transcriptText: string
}

export interface ArchiveResult {
  folderId: string
  folderUrl: string
  files: Record<string, BoxFileRef>
  /** Every artifact present in the folder after this phase. */
  artifacts: string[]
}

/**
 * Write note.md and the metadata.json manifest to the consult's folder. The
 * manifest reflects which artifacts actually landed (phase 1 may have partially
 * failed or not run), and transcript.txt is backfilled here if it is missing.
 */
export async function archiveNoteAndMetadata(input: ArchiveNoteInput): Promise<ArchiveResult> {
  const client = BoxClient.fromConfig(input.config)
  const folderId = await client.ensureSubfolder(
    input.config.folderId,
    folderNameFor(input.createdAt, input.encounterId),
  )
  const existing = await client.listFolderFiles(folderId)

  const files: Record<string, BoxFileRef> = {}

  files["note.md"] = await client.uploadFile(
    folderId,
    "note.md",
    Buffer.from(input.note.text, "utf8"),
    "text/markdown; charset=utf-8",
    existing.get("note.md")?.id,
  )

  // Backfill the transcript if phase 1 never wrote it (it failed, or this
  // consult came through a path that skipped phase 1).
  if (!existing.has("transcript.txt") && input.transcriptText) {
    files["transcript.txt"] = await client.uploadFile(
      folderId,
      "transcript.txt",
      Buffer.from(input.transcriptText, "utf8"),
      "text/plain; charset=utf-8",
    )
  }

  // Truth comes from the folder, not from what we expected to upload.
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
    note: { model: input.note.model, format: input.note.format },
    files: {
      audio: audioName,
      transcript: present.has("transcript.txt") ? "transcript.txt" : null,
      rawTranscript: present.has("raw_transcript.json") ? "raw_transcript.json" : null,
      note: "note.md",
      metadata: "metadata.json",
    },
  }

  files["metadata.json"] = await client.uploadFile(
    folderId,
    "metadata.json",
    Buffer.from(JSON.stringify(metadata, null, 2), "utf8"),
    "application/json",
    existing.get("metadata.json")?.id,
  )

  present.add("metadata.json")
  return { folderId, folderUrl: folderUrlFor(folderId), files, artifacts: [...present] }
}
