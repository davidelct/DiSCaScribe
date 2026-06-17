import type { NextRequest } from "next/server"
import { resolveTranscriptionProvider } from "@transcription"
import { writeAuditEntry } from "@storage/audit-log"
import { archiveNoteAndMetadata, getBoxConfig } from "@/lib/box"

export const runtime = "nodejs"

// The note generator's default model. Mirrored here only to record provenance
// in metadata.json; override with ANTHROPIC_MODEL if the note model changes.
const NOTE_MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6"

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
 * metadata.json manifest to the consult's Box folder.
 *
 * The heavy artifacts (audio + raw Deepgram JSON + transcript) are uploaded
 * earlier by the transcription request itself (phase 1), so this route carries
 * only the note and lightweight encounter metadata. It targets the same folder
 * by (created_at, encounter.id), and the manifest reflects whatever artifacts
 * actually landed. When Box archiving is not configured the route is a graceful
 * no-op (`{ skipped: true }`) so the consultation flow never breaks.
 */
export async function POST(req: NextRequest) {
  let encounterId = ""
  try {
    let body: {
      session_id?: unknown
      encounter?: EncounterPayload
      note?: unknown
      transcript?: unknown
    }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return jsonError(400, "validation_error", "Request body must be JSON")
    }

    const sessionId = body.session_id
    const encounter = body.encounter
    const note = body.note
    if (typeof sessionId !== "string" || typeof note !== "string" || !encounter || typeof encounter !== "object") {
      return jsonError(400, "validation_error", "Missing session_id, encounter, or note")
    }
    if (!encounter.id) {
      return jsonError(400, "validation_error", "encounter.id is required")
    }
    encounterId = encounter.id
    const transcriptField = body.transcript

    const boxConfig = getBoxConfig()
    if (!boxConfig.enabled) {
      // Not an error — Box is simply not set up. Tell the client to mark it skipped.
      return new Response(JSON.stringify({ skipped: true, reason: boxConfig.reason }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    const transcriptText = typeof transcriptField === "string" ? transcriptField : ""
    const resolvedProvider = resolveTranscriptionProvider()
    const archivedAt = new Date().toISOString()

    const result = await archiveNoteAndMetadata({
      config: boxConfig.config,
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
      note: { text: note, model: NOTE_MODEL, format: "soap-markdown" },
      transcriptText,
    })

    await writeAuditEntry({
      event_type: "encounter.archived",
      resource_id: encounter.id,
      success: true,
      metadata: {
        box_folder_id: result.folderId,
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
    console.error("Box archive failed", error)
    await writeAuditEntry({
      event_type: "encounter.archive_failed",
      resource_id: encounterId || undefined,
      success: false,
      error_message: error instanceof Error ? error.message : "Box archive failed",
    })
    return jsonError(502, "box_archive_error", error instanceof Error ? error.message : "Box archive failed")
  }
}
