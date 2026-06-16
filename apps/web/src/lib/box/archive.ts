/**
 * Archive one consultation to Box.
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
 * The folder name deliberately avoids PHI (uses the encounter id, not the
 * patient name); identifying detail lives inside metadata.json within the
 * access-controlled folder.
 */

import type { BoxConfig } from "./config"
import { BoxClient, type BoxFileRef } from "./client"

export interface ArchiveConsultationInput {
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
  transcriptText: string
  rawTranscript?: unknown
  audio?: { buffer: Buffer; contentType: string; filename: string }
}

export interface ArchiveResult {
  folderId: string
  folderUrl: string
  files: Record<string, BoxFileRef>
}

const METADATA_SCHEMA_VERSION = 1

function datePrefix(iso: string): string {
  // YYYY-MM-DD from an ISO timestamp, falling back to the raw value.
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso)
  return match ? match[1] : iso.slice(0, 10)
}

function audioExtension(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename)
  return match ? `.${match[1].toLowerCase()}` : ".wav"
}

export async function archiveConsultation(input: ArchiveConsultationInput): Promise<ArchiveResult> {
  const client = BoxClient.fromConfig(input.config)
  const folderName = `${datePrefix(input.createdAt)}_${input.encounterId}`
  const folderId = await client.ensureSubfolder(input.config.folderId, folderName)

  // One listing up front lets every artifact upload as a new version when the
  // consultation is re-archived, keeping the folder idempotent.
  const existing = await client.listFolderFiles(folderId)

  const audioName = input.audio ? `audio${audioExtension(input.audio.filename)}` : null
  const hasRaw = input.rawTranscript !== undefined && input.rawTranscript !== null

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
      transcript: "transcript.txt",
      rawTranscript: hasRaw ? "raw_transcript.json" : null,
      note: "note.md",
      metadata: "metadata.json",
    },
  }

  // Upload order: payload first, manifest last, so metadata.json is only written
  // once its referenced files exist.
  const artifacts: Array<{ name: string; data: Buffer; contentType: string }> = []
  if (input.audio && audioName) {
    artifacts.push({ name: audioName, data: input.audio.buffer, contentType: input.audio.contentType })
  }
  artifacts.push({
    name: "transcript.txt",
    data: Buffer.from(input.transcriptText, "utf8"),
    contentType: "text/plain; charset=utf-8",
  })
  if (hasRaw) {
    artifacts.push({
      name: "raw_transcript.json",
      data: Buffer.from(JSON.stringify(input.rawTranscript, null, 2), "utf8"),
      contentType: "application/json",
    })
  }
  artifacts.push({
    name: "note.md",
    data: Buffer.from(input.note.text, "utf8"),
    contentType: "text/markdown; charset=utf-8",
  })
  artifacts.push({
    name: "metadata.json",
    data: Buffer.from(JSON.stringify(metadata, null, 2), "utf8"),
    contentType: "application/json",
  })

  const files: Record<string, BoxFileRef> = {}
  for (const artifact of artifacts) {
    files[artifact.name] = await client.uploadFile(
      folderId,
      artifact.name,
      artifact.data,
      artifact.contentType,
      existing.get(artifact.name)?.id,
    )
  }

  return {
    folderId,
    folderUrl: `https://app.box.com/folder/${folderId}`,
    files,
  }
}
