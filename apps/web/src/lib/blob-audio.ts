/**
 * Server side of the Blob staging path for recordings.
 *
 * The browser uploads long recordings straight to the private Blob store (see
 * @/lib/transcription-upload) and hands the transcription route the URL. The
 * route pulls the bytes here, sends them to Deepgram and the archive, and
 * discards the staged copy: the store is a transit lane, never a second
 * archive. Private blobs are unreadable without the store token, which only
 * the server holds.
 */

import { del, get } from "@vercel/blob"
import { isVercelBlobUrl } from "@transcription"

/** Audio as the transcription route works with it, whichever way it arrived. */
export interface UploadedAudio {
  buffer: Buffer
  contentType: string
  filename: string
}

/**
 * Read a recording the browser staged. Refuses anything that is not a Blob
 * URL before touching the network, so the route can never be steered to fetch
 * from elsewhere.
 */
export async function readStagedAudio(blobUrl: string): Promise<UploadedAudio> {
  if (!isVercelBlobUrl(blobUrl)) {
    throw new Error("blob_url is not a Vercel Blob URL")
  }
  const result = await get(blobUrl, { access: "private", useCache: false })
  if (!result || result.statusCode !== 200) {
    throw new Error("The staged recording was not found; upload it again.")
  }
  const buffer = Buffer.from(await new Response(result.stream).arrayBuffer())
  const filename = result.blob.pathname.split("/").pop() || "recording"
  return { buffer, contentType: result.blob.contentType || "application/octet-stream", filename }
}

/**
 * Remove a staged recording once the route has answered. Best-effort: a
 * leaked blob costs storage, not correctness, and the route's response must
 * not depend on the store being reachable a second time.
 */
export async function discardStagedAudio(blobUrl: string): Promise<void> {
  try {
    await del(blobUrl)
  } catch (error) {
    console.warn("[blob] could not delete staged recording", error)
  }
}
