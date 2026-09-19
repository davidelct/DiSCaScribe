import { NextResponse } from "next/server"
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { resolveUploadCapability } from "@transcription"
import { requestSessionRole } from "@/lib/request-keys"

export const runtime = "nodejs"

/** What the recorder and the file picker produce. */
const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/flac",
  "application/octet-stream",
]
/** Four hours of raw 16 kHz mono WAV is ~460 MB; nothing legitimate is larger. */
const MAX_STAGED_BYTES = 500 * 1024 * 1024
/** Long enough to upload a long consultation on a slow clinic connection. */
const TOKEN_TTL_MS = 15 * 60 * 1000
/** Every staged recording lives under one prefix, so nothing else in the store can be targeted. */
const STAGING_PREFIX = "recordings/"

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, recoverable: false } }, { status })
}

/**
 * Which upload path the browser should take: straight to the Blob store when
 * one is attached, otherwise in the request body within the advertised limit.
 */
export async function GET() {
  return NextResponse.json(resolveUploadCapability(process.env))
}

/**
 * Token exchange for a browser → Blob upload (the `handleUpload` protocol).
 *
 * There is deliberately no `onUploadCompleted`: the browser hands the blob URL
 * to the transcription route itself, and that route deletes the blob once it
 * has answered. Skipping the callback also means no public callback URL is
 * needed, so the same code runs locally and on Vercel.
 */
export async function POST(req: Request) {
  const role = await requestSessionRole(req)
  if (!role) return jsonError(401, "invalid_session", "Session expired. Log in again.")
  if (!resolveUploadCapability(process.env).blob) {
    return jsonError(503, "blob_not_configured", "Large uploads are not configured on this server.")
  }

  let body: HandleUploadBody
  try {
    body = (await req.json()) as HandleUploadBody
  } catch {
    return jsonError(400, "validation_error", "Malformed upload request")
  }

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(STAGING_PREFIX)) {
          throw new Error(`Recordings must be staged under ${STAGING_PREFIX}`)
        }
        return {
          allowedContentTypes: ALLOWED_AUDIO_TYPES,
          maximumSizeInBytes: MAX_STAGED_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + TOKEN_TTL_MS,
          tokenPayload: JSON.stringify({ role }),
        }
      },
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("[blob] client token request failed", error)
    return jsonError(400, "blob_token_error", error instanceof Error ? error.message : "Could not prepare the upload")
  }
}
