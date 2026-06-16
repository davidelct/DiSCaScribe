import type { NextRequest } from "next/server"
import { resolveTranscriptionProvider } from "@transcription"
import { transcriptionSessionStore } from "@transcript-assembly"
import { writeAuditEntry } from "@storage/audit-log"
import { archiveConsultation, getBoxConfig } from "@/lib/box"

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
 * Archive a completed consultation to Box: audio + diarized transcript + raw
 * Deepgram JSON + clinical note + a metadata sidecar, in one folder per consult.
 *
 * The audio and raw transcript are read from the in-memory session store (stashed
 * during transcription), so the client only sends the note and lightweight
 * encounter metadata here. When Box archiving is not configured the route is a
 * graceful no-op (`{ skipped: true }`) so the consultation flow never breaks.
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

    const artifacts = transcriptionSessionStore.getArchiveArtifacts(sessionId)
    const transcriptText = typeof transcriptField === "string" ? transcriptField : ""
    const resolvedProvider = resolveTranscriptionProvider()
    const archivedAt = new Date().toISOString()

    const result = await archiveConsultation({
      config: boxConfig.config,
      encounterId: encounter.id,
      sessionId,
      createdAt: encounter.created_at || archivedAt,
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
      rawTranscript: artifacts?.rawTranscript,
      audio: artifacts?.audio,
    })

    // Free the stashed audio buffer now that it's safely in Box.
    transcriptionSessionStore.clearArchiveArtifacts(sessionId)

    await writeAuditEntry({
      event_type: "encounter.archived",
      resource_id: encounter.id,
      success: true,
      metadata: {
        box_folder_id: result.folderId,
        files: Object.keys(result.files),
        audio_archived: Boolean(artifacts?.audio),
        raw_transcript_archived: artifacts?.rawTranscript != null,
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
