import type { NextRequest } from "next/server"
import { toPipelineError } from "@pipeline-errors"
import { resolveTranscriptionProvider, transcribeWithResolvedProviderDetailed } from "@transcription"
import { transcriptionSessionStore } from "@transcript-assembly"
import { writeAuditEntry } from "@storage/audit-log"
import { archiveTranscriptionArtifacts, getBoxConfig } from "@/lib/box"

export const runtime = "nodejs"

// Cap upload size to protect the server and surface a clear error. Note: hosted
// serverless platforms (e.g. Vercel) impose their own, smaller request-body
// limits, so very large files may be rejected before reaching this handler.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 // 100 MB

function jsonError(status: number, code: string, message: string, recoverable: boolean) {
  return new Response(JSON.stringify({ error: { code, message, recoverable } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function isBlankTranscript(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  return (
    normalized.length === 0 ||
    normalized === "[blank_audio]" ||
    normalized === "no speech detected in audio" ||
    normalized === "audio file too small or empty" ||
    normalized === "none"
  )
}

/**
 * Transcribe an uploaded audio file in a single pass (no live segments).
 * Unlike the recording final route, the bytes are sent to the provider as-is —
 * Deepgram accepts any common format/sample rate (wav/mp3/m4a/…) and we forward
 * the file's MIME type. Diarization is enabled, matching the recording flow.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const sessionId = formData.get("session_id")
    const file = formData.get("file")
    // Optional, only sent when Box archival is on — used to file phase-1
    // artifacts under the same per-consult folder as the later note upload.
    const encounterId = typeof formData.get("encounter_id") === "string" ? String(formData.get("encounter_id")) : ""
    const createdAt = typeof formData.get("created_at") === "string" ? String(formData.get("created_at")) : ""

    if (typeof sessionId !== "string" || !(file instanceof Blob)) {
      return jsonError(400, "validation_error", "Missing session_id or file", false)
    }
    if (file.size === 0) {
      return jsonError(400, "validation_error", "Uploaded audio file is empty", true)
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return jsonError(413, "file_too_large", "Uploaded audio file exceeds the 100 MB limit", true)
    }

    transcriptionSessionStore.setStatus(sessionId, "finalizing")

    const arrayBuffer = await file.arrayBuffer()
    const contentType = file.type || "application/octet-stream"
    const filename = file instanceof File && file.name ? file.name : `${sessionId}-upload`

    try {
      const resolvedProvider = resolveTranscriptionProvider()
      const startedAtMs = Date.now()
      const detail = await transcribeWithResolvedProviderDetailed(Buffer.from(arrayBuffer), filename, resolvedProvider, {
        diarize: true,
        contentType,
      })
      const transcript = detail.text
      const latencyMs = Date.now() - startedAtMs

      if (isBlankTranscript(transcript)) {
        transcriptionSessionStore.emitError(
          sessionId,
          "blank_audio",
          "No detectable speech in the uploaded file. Check the audio and try again.",
        )
        return jsonError(422, "blank_audio", "No detectable speech in the uploaded file. Check the audio and try again.")
      }

      transcriptionSessionStore.setFinalTranscript(sessionId, transcript)

      // Phase 1 of Box archival: upload the uploaded audio + raw Deepgram JSON +
      // transcript from this request (which holds the bytes), so archival stays
      // correct on serverless. Best-effort — never fails the transcription.
      if (encounterId) {
        const boxConfig = getBoxConfig()
        if (boxConfig.enabled) {
          try {
            await archiveTranscriptionArtifacts({
              config: boxConfig.config,
              encounterId,
              createdAt,
              transcriptText: transcript,
              rawTranscript: detail.raw,
              audio: {
                buffer: Buffer.from(arrayBuffer),
                contentType: contentType || "application/octet-stream",
                filename,
              },
            })
          } catch (boxError) {
            console.error("[box] phase-1 archive failed (upload)", boxError)
          }
        }
      }

      await writeAuditEntry({
        event_type: "transcription.completed",
        resource_id: sessionId,
        success: true,
        metadata: {
          source: "file_upload",
          file_size_bytes: arrayBuffer.byteLength,
          content_type: contentType,
          transcription_provider: resolvedProvider.provider,
          transcription_model: resolvedProvider.model,
          transcription_latency_ms: latencyMs,
        },
      })

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      })
    } catch (error) {
      console.error("Uploaded audio processing failed", error)
      const resolvedProvider = resolveTranscriptionProvider()
      const pipelineError = toPipelineError(error, {
        code: "api_error",
        message: "Transcription API failure",
        recoverable: true,
      })
      transcriptionSessionStore.emitError(sessionId, pipelineError)

      await writeAuditEntry({
        event_type: "transcription.failed",
        resource_id: sessionId,
        success: false,
        error_message: error instanceof Error ? error.message : "Transcription API failed",
        metadata: {
          source: "file_upload",
          transcription_provider: resolvedProvider.provider,
          transcription_model: resolvedProvider.model,
        },
      })

      return jsonError(502, pipelineError.code, pipelineError.message, pipelineError.recoverable)
    }
  } catch (error) {
    console.error("Audio upload ingestion failed", error)
    return jsonError(500, "storage_error", "Failed to process uploaded audio", false)
  }
}
