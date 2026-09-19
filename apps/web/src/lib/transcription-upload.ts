/**
 * Getting a recording to the transcription route at full quality.
 *
 * On Vercel a request body is capped at 4.5 MB, which used to dictate the
 * bitrate of every recording (a 25-minute consultation went out at 16 kbps).
 * The server now advertises whether a Blob store is connected; when it is, the
 * browser fetches a presigned URL from our token route and uploads the audio
 * straight to the store, any size, then passes the transcription route a URL
 * instead of the bytes. Without a store the file still rides in the request,
 * compressed to whatever limit the server reports.
 */

import { uploadPresigned } from "@vercel/blob/client"
import { compressAudioFileToMp3 } from "@audio"
import { HOSTED_REQUEST_BODY_LIMIT_BYTES, compressionTargetBytes, type UploadCapability } from "@transcription"
import { debugLog, debugWarn } from "@storage"

const CAPABILITY_PATH = "/api/transcription/blob"
/** Above this the SDK splits the upload into parallel, retried parts. */
const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024

/** When the server cannot be asked, assume the tightest budget rather than fail. */
const FALLBACK_CAPABILITY: UploadCapability = { blob: false, directMaxBytes: HOSTED_REQUEST_BODY_LIMIT_BYTES }

/** Absolute or same-origin URL for a transcription API path. */
export function transcriptionApiUrl(baseUrl: string, path: string): string {
  return baseUrl ? `${baseUrl.replace(/\/+$/, "")}${path}` : path
}

/** Ask the server which upload path to take. */
export async function fetchUploadCapability(baseUrl: string): Promise<UploadCapability> {
  try {
    const response = await fetch(transcriptionApiUrl(baseUrl, CAPABILITY_PATH), { method: "GET" })
    if (!response.ok) return FALLBACK_CAPABILITY
    const body = (await response.json()) as Partial<UploadCapability>
    if (typeof body.blob !== "boolean" || typeof body.directMaxBytes !== "number") return FALLBACK_CAPABILITY
    return { blob: body.blob, directMaxBytes: body.directMaxBytes }
  } catch (error) {
    debugWarn("[upload] could not read the server's upload capability; assuming the hosted limit", error)
    return FALLBACK_CAPABILITY
  }
}

/**
 * Compress a recording to 16 kHz mono MP3 at the best bitrate its upload path
 * allows: 64 kbps whenever the audio can be staged, squeezed to the request
 * limit otherwise. The original is returned if it cannot be decoded.
 */
export async function compressForUpload(file: File, capability: UploadCapability, label: string): Promise<File> {
  try {
    const compressed = await compressAudioFileToMp3(file, { targetBytes: compressionTargetBytes(capability) })
    debugLog(
      `[${label}] compressed recording: ${(file.size / 1e6).toFixed(1)}MB -> ` +
        `${(compressed.blob.size / 1e6).toFixed(2)}MB @ ${compressed.bitrateKbps}kbps` +
        (capability.blob ? " (staged upload)" : ` (request limit ${(capability.directMaxBytes / 1e6).toFixed(1)}MB)`),
    )
    return new File([compressed.blob], compressed.filename, { type: "audio/mpeg" })
  } catch (error) {
    debugWarn(`[${label}] compression failed; uploading the original`, error)
    return file
  }
}

/** The audio as the transcription route will receive it. */
export type AudioSource = { kind: "file"; file: File } | { kind: "blob"; url: string }

/**
 * Put the audio where the route can reach it. With a Blob store the file goes
 * straight there; otherwise it rides in the request. A failed staging falls
 * back to the request when the file would fit, so a store outage never blocks
 * a short consultation.
 */
export async function stageAudio(file: File, capability: UploadCapability, baseUrl: string): Promise<AudioSource> {
  if (!capability.blob) return { kind: "file", file }
  try {
    const staged = await uploadPresigned(`recordings/${file.name || "recording"}`, file, {
      access: "private",
      handleUploadUrl: transcriptionApiUrl(baseUrl, CAPABILITY_PATH),
      contentType: file.type || "application/octet-stream",
      multipart: file.size > MULTIPART_THRESHOLD_BYTES,
    })
    debugLog(`[upload] staged ${(file.size / 1e6).toFixed(2)}MB in the Blob store`)
    return { kind: "blob", url: staged.url }
  } catch (error) {
    if (file.size > capability.directMaxBytes) throw error
    debugWarn("[upload] staging in the Blob store failed; sending the file in the request", error)
    return { kind: "file", file }
  }
}

/** Attach the audio to the transcription request in whichever form it took. */
export function appendAudioSource(form: FormData, source: AudioSource): void {
  if (source.kind === "file") form.append("file", source.file, source.file.name)
  else form.append("blob_url", source.url)
}
