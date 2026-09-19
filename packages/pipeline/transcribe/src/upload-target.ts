/**
 * Where a recording travels on its way to the transcriber, and how big it may
 * be when it gets there.
 *
 * On Vercel a function's request body is capped at 4.5 MB. Recordings used to
 * be compressed to fit that no matter how long they were, which is how a
 * 25-minute consultation reached Deepgram as a 16 kbps MP3 and lost its
 * speaker attribution, while a 7-minute one from the same room went out at
 * 64 kbps and was fine. With a Blob store attached, the browser uploads the
 * audio straight to it, any size, and the server pulls it from there. The
 * capability the server advertises tells the browser which path to take, so
 * one client works hosted, hosted-without-a-store, and self-hosted.
 */

/** Vercel Functions reject request bodies over this with a 413. */
export const HOSTED_REQUEST_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024
/** What the upload route itself accepts when nothing in front of it is stricter. */
export const DIRECT_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024
/**
 * Share of the direct limit a compressed recording aims for, leaving room for
 * multipart framing and the MP3 estimate being an estimate. 0.85 of 4.5 MB is
 * the 3.8 MB budget the compressor used before it took a target.
 */
export const DIRECT_UPLOAD_HEADROOM = 0.85

export interface UploadCapability {
  /** The browser may stage the audio in the Blob store, at any size. */
  blob: boolean
  /** Largest request body the transcription route will accept directly. */
  directMaxBytes: number
}

/** The capability of the server described by `env`; the browser asks for this before uploading. */
export function resolveUploadCapability(env: Record<string, string | undefined>): UploadCapability {
  const blob = Boolean(env.BLOB_READ_WRITE_TOKEN?.trim())
  // Vercel sets VERCEL=1 in every function; anything else has only our own cap.
  const hosted = env.VERCEL === "1"
  return { blob, directMaxBytes: hosted ? HOSTED_REQUEST_BODY_LIMIT_BYTES : DIRECT_UPLOAD_LIMIT_BYTES }
}

/** Size a compressed recording must fit on its way to a server with `capability`. */
export function compressionTargetBytes(capability: UploadCapability): number {
  if (capability.blob) return Number.POSITIVE_INFINITY
  return Math.floor(capability.directMaxBytes * DIRECT_UPLOAD_HEADROOM)
}

// The SDK builds blob URLs as https://<store>.<access>.blob.vercel-storage.com/<pathname>.
const BLOB_HOST = /^[a-z0-9-]+\.(private|public)\.blob\.vercel-storage\.com$/i

/**
 * True for a URL the Blob SDK could have issued. The upload route fetches the
 * URL the browser hands it, so anything else must be refused before that.
 */
export function isVercelBlobUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && BLOB_HOST.test(url.hostname)
  } catch {
    return false
  }
}
