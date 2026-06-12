import { Mp3Encoder } from "@breezystack/lamejs"
import { TARGET_SAMPLE_RATE } from "./audio-processing"

/**
 * Browser-side audio compression for file uploads.
 *
 * Decodes an arbitrary audio file, resamples to 16 kHz mono (plenty for speech
 * transcription), and encodes a low-bitrate MP3. This keeps the uploaded body
 * small enough for hosted serverless request-size limits (e.g. Vercel's ~4.5 MB)
 * while staying lossless enough for ASR. MP3 needs no container/muxing and is
 * accepted directly by Deepgram.
 */

// Stay safely under the 4.5 MB hosted limit, leaving headroom for MP3 framing.
const TARGET_SIZE_BYTES = 3.8 * 1024 * 1024
const STANDARD_BITRATES_KBPS = [16, 24, 32, 40, 48, 56, 64]
const MIN_KBPS = 16
const MAX_KBPS = 64
const MP3_FRAME_SAMPLES = 1152

export interface CompressedAudio {
  blob: Blob
  filename: string
  originalBytes: number
  compressedBytes: number
  bitrateKbps: number
  durationSeconds: number
}

/** Largest standard MP3 bitrate whose estimated size fits the target, given duration. */
function chooseBitrateKbps(durationSeconds: number): number {
  if (durationSeconds <= 0) return 32
  // size_bytes ≈ kbps * 1000 / 8 * duration  →  kbps ≈ target * 8 / 1000 / duration
  const maxKbps = (TARGET_SIZE_BYTES * 8) / 1000 / durationSeconds
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
 * Compress an audio file to a low-bitrate 16 kHz mono MP3 suitable for upload.
 * Throws if the file cannot be decoded (caller should fall back to the original).
 */
export async function compressAudioFileToMp3(file: File): Promise<CompressedAudio> {
  const { samples, durationSeconds } = await decodeToMono16k(file)
  const pcm = floatToInt16(samples)

  const bitrateKbps = chooseBitrateKbps(durationSeconds)
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
