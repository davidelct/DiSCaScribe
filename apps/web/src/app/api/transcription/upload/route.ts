import type { NextRequest } from "next/server"
import { createPipelineError, toPipelineError } from "@pipeline-errors"
import { parseKeyterms, resolveTranscriptionProvider, transcribeWithResolvedProviderDetailed } from "@transcription"
import { transcriptionSessionStore } from "@transcript-assembly"
import { writeAuditEntry } from "@storage/audit-log"
import { archiveTranscriptionArtifacts, getArchivalConfig } from "@/lib/archival"
import { discardStagedAudio, readStagedAudio, type UploadedAudio } from "@/lib/blob-audio"
import { DEEPGRAM_KEY_HEADER, resolveRequestKey } from "@/lib/request-keys"

export const runtime = "nodejs"
// A staged recording is pulled from the Blob store and pushed to Deepgram
// within this one request: an hour at 64 kbps is ~29 MB each way. Within the
// limit of every Vercel plan.
export const maxDuration = 60

// Cap upload size to protect the server and surface a clear error. Hosted
// serverless platforms impose their own, smaller request-body limit (Vercel:
// 4.5 MB) before the request reaches this handler; the Blob staging path
// exists to get long recordings around that.
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
 *
 * The audio arrives either in the request (`file`) or staged in the private
 * Blob store by the browser (`blob_url`) — the path long recordings take so
 * the hosted request-body limit stops dictating their bitrate. Either way the
 * bytes go to the provider as-is with their MIME type; Deepgram accepts any
 * common format/sample rate. Diarization is enabled, matching the recording
 * flow. A staged copy is discarded once this request has answered.
 */
export async function POST(req: NextRequest) {
  let stagedUrl = ""
  try {
    // BYOK sessions must supply their own Deepgram key; full sessions may.
    const keys = await resolveRequestKey(req, DEEPGRAM_KEY_HEADER)
    if (!keys.ok) {
      return jsonError(keys.status, keys.code, keys.message, false)
    }

    const formData = await req.formData()
    const sessionId = formData.get("session_id")
    const file = formData.get("file")
    const blobUrl = typeof formData.get("blob_url") === "string" ? String(formData.get("blob_url")).trim() : ""
    // Optional, only sent when archival is on — used to file phase-1
    // artifacts under the same per-consult container as the later note upload.
    const encounterId = typeof formData.get("encounter_id") === "string" ? String(formData.get("encounter_id")) : ""
    const createdAt = typeof formData.get("created_at") === "string" ? String(formData.get("created_at")) : ""
    // Keyterm vocabulary, newline-separated. Client-side setting, so it travels
    // with the request rather than being read from server config.
    const keyterms = parseKeyterms(
      typeof formData.get("keyterms") === "string" ? String(formData.get("keyterms")) : "",
    )

    if (typeof sessionId !== "string" || (!(file instanceof Blob) && !blobUrl)) {
      return jsonError(400, "validation_error", "Missing session_id or audio (file or blob_url)", false)
    }

    let audio: UploadedAudio
    if (blobUrl) {
      stagedUrl = blobUrl
      try {
        audio = await readStagedAudio(blobUrl)
      } catch (error) {
        const message = error instanceof Error ? error.message : "The staged recording could not be read"
        return jsonError(400, "staged_audio_unavailable", message, true)
      }
    } else {
      const upload = file as Blob
      if (upload.size > MAX_UPLOAD_BYTES) {
        return jsonError(413, "file_too_large", "Uploaded audio file exceeds the 100 MB limit", true)
      }
      audio = {
        buffer: Buffer.from(await upload.arrayBuffer()),
        contentType: upload.type || "application/octet-stream",
        filename: upload instanceof File && upload.name ? upload.name : `${sessionId}-upload`,
      }
    }
    if (audio.buffer.byteLength === 0) {
      return jsonError(400, "validation_error", "Uploaded audio file is empty", true)
    }
    const { buffer, contentType, filename } = audio

    transcriptionSessionStore.setStatus(sessionId, "finalizing")

    try {
      const resolvedProvider = resolveTranscriptionProvider()
      const startedAtMs = Date.now()
      const detail = await transcribeWithResolvedProviderDetailed(buffer, filename, resolvedProvider, {
        diarize: true,
        contentType,
        apiKey: keys.apiKey,
        keyterms,
      })
      const transcript = detail.text
      const latencyMs = Date.now() - startedAtMs

      if (isBlankTranscript(transcript)) {
        const message = "No detectable speech in the uploaded file. Check the audio and try again."
        transcriptionSessionStore.emitError(sessionId, createPipelineError("blank_audio", message, true))
        return jsonError(422, "blank_audio", message, true)
      }

      // Phase 1 of archival: upload the audio + raw Deepgram JSON + transcript
      // from this request (which holds the bytes), so archival stays correct on
      // serverless. Best-effort — never fails the transcription.
      // Must complete BEFORE the final transcript is pushed to the client: the
      // client triggers phase 2 (metadata manifest) on that event, and the
      // manifest lists whichever artifacts are already in the container.
      if (encounterId) {
        const archival = getArchivalConfig(keys.role)
        if (archival.enabled) {
          try {
            await archiveTranscriptionArtifacts({
              client: archival.client,
              encounterId,
              createdAt,
              transcriptText: transcript,
              rawTranscript: detail.raw,
              audio: { buffer, contentType, filename },
            })
          } catch (archiveError) {
            console.error("[archival] phase-1 archive failed (upload)", archiveError)
          }
        }
      }

      transcriptionSessionStore.setFinalTranscript(sessionId, transcript, detail.words)

      await writeAuditEntry({
        event_type: "transcription.completed",
        resource_id: sessionId,
        success: true,
        metadata: {
          source: "file_upload",
          audio_source: blobUrl ? "blob" : "request",
          file_size_bytes: buffer.byteLength,
          content_type: contentType,
          transcription_provider: resolvedProvider.provider,
          transcription_model: resolvedProvider.model,
          transcription_latency_ms: latencyMs,
          keyterm_count: keyterms.length,
        },
      })

      // The transcript rides in the response as well as on the event stream.
      // The stream is fed from an in-memory store, and on serverless the
      // instance holding the browser's stream may not be the one that ran
      // this request; the response cannot miss. Same payload shape as the
      // stream's `final` event, so the browser applies whichever arrives first.
      return new Response(
        JSON.stringify({ ok: true, final_transcript: transcript, final_transcript_words: detail.words }),
        { headers: { "Content-Type": "application/json" } },
      )
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
          audio_source: blobUrl ? "blob" : "request",
          transcription_provider: resolvedProvider.provider,
          transcription_model: resolvedProvider.model,
        },
      })

      return jsonError(502, pipelineError.code, pipelineError.message, pipelineError.recoverable)
    }
  } catch (error) {
    console.error("Audio upload ingestion failed", error)
    return jsonError(500, "storage_error", "Failed to process uploaded audio", false)
  } finally {
    // Whatever the answer was, the staged copy has done its job; the browser
    // re-stages on retry and the archive holds the durable copy.
    if (stagedUrl) await discardStagedAudio(stagedUrl)
  }
}
