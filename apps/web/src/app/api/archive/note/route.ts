import type { NextRequest } from "next/server"
import { resolveTranscriptionProvider } from "@transcription"
import { writeAuditEntry } from "@storage/audit-log"
import { archiveNoteAndMetadata, getArchivalConfig } from "@/lib/archival"

export const runtime = "nodejs"

// The note generator's default model. Mirrored here only to record provenance
// in metadata.json; override with ANTHROPIC_MODEL if the note model changes.
const NOTE_MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5"

interface EncounterPayload {
  id: string
  patient_name?: string
  patient_id?: string
  visit_reason?: string
  language?: string
  created_at?: string
  recording_duration?: number
}

function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

/**
 * Phase 2 of consultation archival: write the clinical note and the
 * metadata.json manifest to the consult's container (a Box folder).
 *
 * The heavy artifacts (audio + raw Deepgram JSON + transcript) are uploaded
 * earlier by the transcription request itself (phase 1), so this route carries
 * only the note and lightweight encounter metadata. It targets the same
 * container by (created_at, encounter.id), and the manifest reflects whatever
 * artifacts actually landed. When archiving is not configured the route is a
 * graceful no-op (`{ skipped: true }`) so the consultation flow never breaks.
 */
export async function POST(req: NextRequest) {
  let encounterId = ""
  try {
    let body: {
      session_id?: unknown
      encounter?: EncounterPayload
      note?: unknown
      note_version?: unknown
      transcript?: unknown
    }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return jsonError(400, "validation_error", "Request body must be JSON")
    }

    const sessionId = body.session_id
    const encounter = body.encounter
    // `note` is optional: recording-only consultations archive without one.
    const note = body.note
    if (typeof sessionId !== "string" || !encounter || typeof encounter !== "object") {
      return jsonError(400, "validation_error", "Missing session_id or encounter")
    }
    if (note !== undefined && typeof note !== "string") {
      return jsonError(400, "validation_error", "note must be a string when provided")
    }
    const noteVersion =
      typeof body.note_version === "number" && Number.isInteger(body.note_version) && body.note_version >= 0
        ? body.note_version
        : 0
    if (!encounter.id) {
      return jsonError(400, "validation_error", "encounter.id is required")
    }
    encounterId = encounter.id
    const transcriptField = body.transcript

    const archival = getArchivalConfig()
    if (!archival.enabled) {
      // Not an error — archival is simply not set up. Tell the client to mark it skipped.
      return new Response(JSON.stringify({ skipped: true, reason: archival.reason }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    const transcriptText = typeof transcriptField === "string" ? transcriptField : ""
    const resolvedProvider = resolveTranscriptionProvider()
    const archivedAt = new Date().toISOString()

    const result = await archiveNoteAndMetadata({
      client: archival.client,
      encounterId: encounter.id,
      sessionId,
      // Folder name must match the transcription request's phase-1 upload, which
      // keyed off the same encounter.created_at — never the per-request time.
      createdAt: encounter.created_at || "",
      archivedAt,
      patient: { name: encounter.patient_name || "", id: encounter.patient_id || "" },
      visitReason: encounter.visit_reason || "",
      language: encounter.language || "en",
      recordingDurationSeconds: encounter.recording_duration,
      transcription: {
        provider: resolvedProvider.provider,
        model: resolvedProvider.model,
        diarized: true,
      },
      note:
        typeof note === "string"
          ? { text: note, model: NOTE_MODEL, format: "soap-markdown", version: noteVersion }
          : undefined,
      transcriptText,
    })

    await writeAuditEntry({
      event_type: "encounter.archived",
      resource_id: encounter.id,
      success: true,
      metadata: {
        storage_backend: archival.backend,
        folder_id: result.folderId,
        files: result.artifacts,
        audio_archived: result.artifacts.some((name) => /^audio\./.test(name)),
        raw_transcript_archived: result.artifacts.includes("raw_transcript.json"),
      },
    })

    return new Response(
      JSON.stringify({
        ok: true,
        folderId: result.folderId,
        folderUrl: result.folderUrl,
        files: result.files,
      }),
      { headers: { "Content-Type": "application/json" } },
    )
  } catch (error) {
    console.error("Archive failed", error)
    await writeAuditEntry({
      event_type: "encounter.archive_failed",
      resource_id: encounterId || undefined,
      success: false,
      error_message: error instanceof Error ? error.message : "Archive failed",
    })
    return jsonError(502, "archive_error", error instanceof Error ? error.message : "Archive failed")
  }
}
