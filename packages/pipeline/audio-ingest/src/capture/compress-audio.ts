import { Mp3Encoder } from "@breezystack/lamejs"
import { TARGET_SAMPLE_RATE } from "./audio-processing"

/**
 * Browser-side audio compression for uploads.
 *
 * Decodes an arbitrary audio file, resamples to 16 kHz mono (plenty for speech
 * transcription), and encodes an MP3. MP3 needs no container/muxing and is
 * accepted directly by Deepgram.
 *
 * The bitrate is the highest standard one whose output fits `targetBytes`,
 * capped at 64 kbps, which for 16 kHz mono speech is as good as the source.
 * The cap matters more than it looks: with the old fixed 3.8 MB budget a
 * 25-minute consultation went out at 16 kbps and its diarization fell apart,
 * while a 7-minute one from the same room went out at 64 kbps and was fine.
 * Callers that can bypass the request-size limit (see the Blob upload path in
 * the web app) pass an effectively unlimited target and always get 64 kbps.
 */

/** Default target: safely under Vercel's 4.5 MB request-body limit, with headroom for MP3 framing. */
export const DEFAULT_COMPRESSION_TARGET_BYTES = 3.8 * 1024 * 1024
const STANDARD_BITRATES_KBPS = [16, 24, 32, 40, 48, 56, 64]
const MIN_KBPS = 16
const MAX_KBPS = 64
const MP3_FRAME_SAMPLES = 1152

export interface CompressAudioOptions {
  /** Size the encoded file must fit in; defaults to the hosted request-body budget. */
  targetBytes?: number
}

export interface CompressedAudio {
  blob: Blob
  filename: string
  originalBytes: number
  compressedBytes: number
  bitrateKbps: number
  durationSeconds: number
}

/** Largest standard MP3 bitrate whose estimated size fits the target, given duration. */
export function chooseBitrateKbps(durationSeconds: number, targetBytes: number = DEFAULT_COMPRESSION_TARGET_BYTES): number {
  if (durationSeconds <= 0) return 32
  // size_bytes ≈ kbps * 1000 / 8 * duration  →  kbps ≈ target * 8 / 1000 / duration
  const maxKbps = (targetBytes * 8) / 1000 / durationSeconds
  let chosen = MIN_KBPS
  for (const bitrate of STANDARD_BITRATES_KBPS) {
    if (bitrate <= maxKbps) chosen = bitrate
  }
  return Math.min(MAX_KBPS, Math.max(MIN_KBPS, chosen))
}

function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }
  return out
}

/** Decode + downmix to 16 kHz mono using the Web Audio API. */
async function decodeToMono16k(file: File): Promise<{ samples: Float32Array; durationSeconds: number }> {
  const arrayBuffer = await file.arrayBuffer()
  const decodeContext = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await decodeContext.decodeAudioData(arrayBuffer)
  } finally {
    await decodeContext.close().catch(() => undefined)
  }

  const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE))
  const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  return { samples: rendered.getChannelData(0), durationSeconds: decoded.duration }
}

/**
 * Compress an audio file to a 16 kHz mono MP3 that fits the target size.
 * Throws if the file cannot be decoded (caller should fall back to the original).
 */
export async function compressAudioFileToMp3(file: File, options: CompressAudioOptions = {}): Promise<CompressedAudio> {
  const { samples, durationSeconds } = await decodeToMono16k(file)
  const pcm = floatToInt16(samples)

  const bitrateKbps = chooseBitrateKbps(durationSeconds, options.targetBytes ?? DEFAULT_COMPRESSION_TARGET_BYTES)
  const encoder = new Mp3Encoder(1, TARGET_SAMPLE_RATE, bitrateKbps)
  const chunks: Uint8Array[] = []

  for (let offset = 0; offset < pcm.length; offset += MP3_FRAME_SAMPLES) {
    const block = pcm.subarray(offset, offset + MP3_FRAME_SAMPLES)
    const encoded = encoder.encodeBuffer(block)
    if (encoded.length > 0) chunks.push(encoded)
    // Yield periodically so encoding a long file doesn't freeze the UI thread.
    if (offset % (MP3_FRAME_SAMPLES * 256) === 0) {
      await new Promise((resolve) => setTimeout(resolve))
    }
  }
  const tail = encoder.flush()
  if (tail.length > 0) chunks.push(tail)

  const blob = new Blob(chunks as BlobPart[], { type: "audio/mpeg" })
  const baseName = file.name.replace(/\.[^./\\]+$/, "") || "recording"
  return {
    blob,
    filename: `${baseName}.mp3`,
    originalBytes: file.size,
    compressedBytes: blob.size,
    bitrateKbps,
    durationSeconds,
  }
}
