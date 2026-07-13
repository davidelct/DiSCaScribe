import type { NextRequest } from "next/server"
import { writeAuditEntry } from "@storage/audit-log"
import { archiveRecallArtifacts, getArchivalConfig } from "@/lib/archival"

export const runtime = "nodejs"

// Recall recordings are short interviews, but leave generous headroom.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 // 100 MB

function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

/**
 * Archive a stimulated-recall session to the consultation's container
 * (recall_audio.<ext> + recall_session.json). Multipart form fields:
 * - encounter_id, created_at — locate the same container the consultation's
 *   audio/transcript/note were filed under
 * - file — the recall-interview recording (optional)
 * - session — the recall session JSON (hypotheses + cue ratings; optional)
 * When archiving is not configured the route is a graceful no-op
 * (`{ skipped: true }`) so the recall flow never breaks.
 */
export async function POST(req: NextRequest) {
  let encounterId = ""
  try {
    const formData = await req.formData()
    const encounterField = formData.get("encounter_id")
    const createdAt = typeof formData.get("created_at") === "string" ? String(formData.get("created_at")) : ""
    const file = formData.get("file")
    const sessionField = formData.get("session")

    if (typeof encounterField !== "string" || !encounterField) {
      return jsonError(400, "validation_error", "Missing encounter_id")
    }
    encounterId = encounterField
    if (file !== null && !(file instanceof Blob)) {
      return jsonError(400, "validation_error", "file must be an audio blob")
    }
    if (file instanceof Blob && file.size > MAX_UPLOAD_BYTES) {
      return jsonError(413, "file_too_large", "Recall recording exceeds the 100 MB limit")
    }
    let session: unknown
    if (typeof sessionField === "string" && sessionField.length > 0) {
      try {
        session = JSON.parse(sessionField)
      } catch {
        return jsonError(400, "validation_error", "session must be valid JSON")
      }
    }
    if (!(file instanceof Blob) && session === undefined) {
      return jsonError(400, "validation_error", "Nothing to archive: provide file and/or session")
    }

    const archival = getArchivalConfig()
    if (!archival.enabled) {
      return new Response(JSON.stringify({ skipped: true, reason: archival.reason }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    const result = await archiveRecallArtifacts({
      client: archival.client,
      encounterId,
      createdAt,
      audio:
        file instanceof Blob
          ? {
              buffer: Buffer.from(await file.arrayBuffer()),
              contentType: file.type || "application/octet-stream",
              filename: file instanceof File && file.name ? file.name : "recall_audio.mp3",
            }
          : undefined,
      session,
    })

    await writeAuditEntry({
      event_type: "encounter.archived",
      resource_id: encounterId,
      success: true,
      metadata: {
        storage_backend: archival.backend,
        folder_id: result.folderId,
        files: result.uploaded,
        artifact_kind: "stimulated_recall",
      },
    })

    return new Response(JSON.stringify({ ok: true, folderId: result.folderId, files: result.uploaded }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("Recall archive failed", error)
    await writeAuditEntry({
      event_type: "encounter.archive_failed",
      resource_id: encounterId || undefined,
      success: false,
      error_message: error instanceof Error ? error.message : "Recall archive failed",
      metadata: { artifact_kind: "stimulated_recall" },
    })
    return jsonError(502, "archive_error", error instanceof Error ? error.message : "Recall archive failed")
  }
}
