import type { NextRequest } from "next/server"
import { toPipelineError } from "@pipeline-errors"
import { parseWavHeader, resolveTranscriptionProvider, transcribeWithResolvedProviderDetailed } from "@transcription"
import { transcriptionSessionStore } from "@transcript-assembly"
import { writeAuditEntry } from "@storage/audit-log"
import { archiveTranscriptionArtifacts, getBoxConfig } from "@/lib/box"

export const runtime = "nodejs"

function jsonError(status: number, code: string, message: string, recoverable: boolean) {
  return new Response(JSON.stringify({ error: { code, message, recoverable } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function getWavDataChunk(buffer: ArrayBuffer): { offset: number; size: number } | null {
  if (buffer.byteLength < 44) return null
  const view = new DataView(buffer)
  let offset = 12
  while (offset + 8 <= buffer.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    )
    const chunkSize = view.getUint32(offset + 4, true)
    const chunkStart = offset + 8
    if (chunkId === "data") {
      return { offset: chunkStart, size: Math.min(chunkSize, buffer.byteLength - chunkStart) }
    }
    offset = chunkStart + chunkSize + (chunkSize % 2)
  }
  return null
}

function isLikelySilentPcm16(buffer: ArrayBuffer): boolean {
  const data = getWavDataChunk(buffer)
  if (!data || data.size < 2) return true
  const view = new DataView(buffer, data.offset, data.size)
  const sampleCount = Math.floor(data.size / 2)
  if (sampleCount === 0) return true

  let sumSquares = 0
  let peak = 0
  let nonTrivial = 0
  for (let i = 0; i < sampleCount; i += 1) {
    const raw = view.getInt16(i * 2, true)
    const normalized = raw / 32768
    const abs = Math.abs(normalized)
    if (abs > peak) peak = abs
    if (abs > 0.001) nonTrivial += 1
    sumSquares += normalized * normalized
  }
  const rms = Math.sqrt(sumSquares / sampleCount)
  const nonTrivialRatio = nonTrivial / sampleCount
  return rms < 0.001 && peak < 0.005 && nonTrivialRatio < 0.02
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

    transcriptionSessionStore.setStatus(sessionId, "finalizing")

    const arrayBuffer = await file.arrayBuffer()
    let wavInfo
    try {
      wavInfo = parseWavHeader(arrayBuffer)
    } catch (error) {
      return jsonError(400, "validation_error", error instanceof Error ? error.message : "Invalid WAV file", true)
    }

    if (wavInfo.sampleRate !== 16000 || wavInfo.numChannels !== 1 || wavInfo.bitDepth !== 16) {
      return jsonError(400, "validation_error", "Final recording must be 16kHz mono 16-bit PCM WAV", true)
    }
    // Do not fail final transcription based on amplitude alone.
    // Quiet speech can still produce a valid transcript.
    const likelySilentAudio = isLikelySilentPcm16(arrayBuffer)

    try {
      const resolvedProvider = resolveTranscriptionProvider()
      const startedAtMs = Date.now()
      const detail = await transcribeWithResolvedProviderDetailed(
        Buffer.from(arrayBuffer),
        `${sessionId}-final.wav`,
        resolvedProvider,
        { diarize: true },
      )
      const transcript = detail.text
      const latencyMs = Date.now() - startedAtMs
      if (isBlankTranscript(transcript)) {
        transcriptionSessionStore.emitError(
          sessionId,
          "blank_audio",
          "No detectable speech signal in the recording. Check microphone input/device and retry.",
        )
        return jsonError(
          422,
          "blank_audio",
          "No detectable speech signal in the recording. Check microphone input/device and retry.",
        )
      }
      if (likelySilentAudio) {
        console.warn("[transcription.final] low-energy capture produced transcript", {
          sessionId,
          durationMs: wavInfo.durationMs,
        })
      }
      transcriptionSessionStore.setFinalTranscript(sessionId, transcript)

      // Phase 1 of Box archival: upload the audio + raw Deepgram JSON +
      // transcript from *this* request, which holds the bytes. Doing it here
      // (rather than stashing in memory for a later request) keeps archival
      // correct on serverless, where the later request may hit a different
      // instance. Best-effort: the transcript was already delivered via the SSE
      // `final` event above, so a Box failure never affects transcription.
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
              audio: { buffer: Buffer.from(arrayBuffer), contentType: "audio/wav", filename: "audio.wav" },
            })
          } catch (boxError) {
            console.error("[box] phase-1 archive failed (recording)", boxError)
          }
        }
      }

      // Audit log: final transcription completed
      await writeAuditEntry({
        event_type: "transcription.completed",
        resource_id: sessionId,
        success: true,
        metadata: {
          duration_ms: wavInfo.durationMs,
          file_size_bytes: arrayBuffer.byteLength,
          transcription_provider: resolvedProvider.provider,
          transcription_model: resolvedProvider.model,
          transcription_latency_ms: latencyMs,
        },
      })

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      })
    } catch (error) {
      console.error("Final audio processing failed", error)
      const resolvedProvider = resolveTranscriptionProvider()
      const pipelineError = toPipelineError(error, {
        code: "api_error",
        message: "Transcription API failure",
        recoverable: true,
      })
      transcriptionSessionStore.emitError(sessionId, pipelineError)

      // Audit log: final transcription failed
      await writeAuditEntry({
        event_type: "transcription.failed",
        resource_id: sessionId,
        success: false,
        error_message: error instanceof Error ? error.message : "Transcription API failed",
        metadata: {
          transcription_provider: resolvedProvider.provider,
          transcription_model: resolvedProvider.model,
        },
      })

      return jsonError(502, pipelineError.code, pipelineError.message, pipelineError.recoverable)
    }
  } catch (error) {
    console.error("Final recording ingestion failed", error)
    return jsonError(500, "storage_error", "Failed to process final recording", false)
  }
}
