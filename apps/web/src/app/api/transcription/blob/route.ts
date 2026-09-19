import { NextResponse } from "next/server"
import { issueSignedToken } from "@vercel/blob"
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client"
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
 * one is connected, otherwise in the request body within the advertised limit.
 */
export async function GET() {
  return NextResponse.json(resolveUploadCapability(process.env))
}

/**
 * Presigned-URL issuance for a browser → Blob upload (the SDK's
 * `handleUploadPresigned` protocol). The short-lived token is minted with
 * `issueSignedToken`, which authenticates the way the rest of the SDK does:
 * OIDC on Vercel (BLOB_STORE_ID plus the token Vercel attaches to each
 * function request), or a static BLOB_READ_WRITE_TOKEN on a server elsewhere.
 * No long-lived secret reaches the browser; the presigned URL carries the
 * content-type, size and pathname constraints and the CDN enforces them.
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

  let body: HandleUploadPresignedBody
  try {
    body = (await req.json()) as HandleUploadPresignedBody
  } catch {
    return jsonError(400, "validation_error", "Malformed upload request")
  }

  try {
    const result = await handleUploadPresigned({
      body,
      request: req,
      getSignedToken: async (pathname) => {
        if (!pathname.startsWith(STAGING_PREFIX)) {
          throw new Error(`Recordings must be staged under ${STAGING_PREFIX}`)
        }
        const validUntil = Date.now() + TOKEN_TTL_MS
        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          allowedContentTypes: ALLOWED_AUDIO_TYPES,
          maximumSizeInBytes: MAX_STAGED_BYTES,
          validUntil,
        })
        return {
          token,
          urlOptions: {
            allowedContentTypes: ALLOWED_AUDIO_TYPES,
            maximumSizeInBytes: MAX_STAGED_BYTES,
            validUntil,
            addRandomSuffix: true,
            allowOverwrite: false,
          },
        }
      },
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("[blob] presigned upload request failed", error)
    return jsonError(400, "blob_token_error", error instanceof Error ? error.message : "Could not prepare the upload")
  }
}
