import {
  transcribeWavBuffer as transcribeWithDeepgram,
  transcribeWavBufferDetailed as transcribeWithDeepgramDetailed,
} from "./deepgram-transcriber"
import { transcribeWavBuffer as transcribeWithMedASR } from "./medasr-transcriber"
import { transcribeWavBuffer as transcribeWithWhisperLocal } from "./whisper-local-transcriber"
import { transcribeWavBuffer as transcribeWithWhisperOpenAI } from "./whisper-transcriber"

export type TranscriptionProvider = "whisper_local" | "whisper_openai" | "medasr" | "deepgram"

export interface ResolvedTranscriptionProvider {
  provider: TranscriptionProvider
  model: string
  /**
   * Whether to stream incremental 8-12s segments during recording for a live
   * transcript preview. Deepgram is final-pass only (single upload at the end),
   * so live segments are disabled to avoid redundant per-segment API calls.
   */
  liveSegments: boolean
}

/** Per-request transcription options that providers may honor (Deepgram supports diarization). */
export interface TranscriptionRequestOptions {
  diarize?: boolean
  /** MIME type of the audio bytes, used for non-WAV uploads (e.g. mp3/m4a). */
  contentType?: string
}

const DEFAULT_WHISPER_LOCAL_MODEL = "tiny.en"
const DEFAULT_WHISPER_OPENAI_MODEL = "whisper-1"
const DEFAULT_MEDASR_MODEL = "medasr"
const DEFAULT_DEEPGRAM_MODEL = "nova-3"

function normalizeProvider(rawProvider: string | undefined): string {
  return rawProvider?.trim().toLowerCase() || ""
}

export function resolveTranscriptionProvider(env: NodeJS.ProcessEnv = process.env): ResolvedTranscriptionProvider {
  const provider = normalizeProvider(env.TRANSCRIPTION_PROVIDER)

  if (provider === "deepgram") {
    return {
      provider: "deepgram",
      model: env.DEEPGRAM_MODEL?.trim() || DEFAULT_DEEPGRAM_MODEL,
      liveSegments: false,
    }
  }

  if (provider === "medasr" || provider === "med_asr") {
    return {
      provider: "medasr",
      model: env.MEDASR_MODEL?.trim() || DEFAULT_MEDASR_MODEL,
      liveSegments: true,
    }
  }

  if (provider === "whisper_openai" || provider === "whisper-openai" || provider === "openai" || provider === "whisper") {
    return {
      provider: "whisper_openai",
      model: env.WHISPER_OPENAI_MODEL?.trim() || DEFAULT_WHISPER_OPENAI_MODEL,
      liveSegments: true,
    }
  }

  return {
    provider: "whisper_local",
    model: env.WHISPER_LOCAL_MODEL?.trim() || DEFAULT_WHISPER_LOCAL_MODEL,
    liveSegments: true,
  }
}

export async function transcribeWithResolvedProvider(
  buffer: Buffer,
  filename: string,
  resolved: ResolvedTranscriptionProvider = resolveTranscriptionProvider(),
  options: TranscriptionRequestOptions = {},
): Promise<string> {
  switch (resolved.provider) {
    case "deepgram":
      return transcribeWithDeepgram(buffer, filename, {
        model: resolved.model,
        diarize: options.diarize,
        contentType: options.contentType,
      })
    case "medasr":
      return transcribeWithMedASR(buffer, filename)
    case "whisper_openai":
      return transcribeWithWhisperOpenAI(buffer, filename)
    case "whisper_local":
    default:
      return transcribeWithWhisperLocal(buffer, filename)
  }
}

/** Transcript text plus the provider's raw response (null for providers that don't expose one). */
export interface DetailedTranscription {
  text: string
  /** Full provider response when available (Deepgram); null otherwise. */
  raw: unknown
}

/**
 * Like {@link transcribeWithResolvedProvider}, but also returns the provider's
 * raw response when it has one. Only Deepgram currently surfaces structured raw
 * output (word timings, confidence, speaker turns); other providers return
 * `raw: null` and the same text the string API would produce.
 */
export async function transcribeWithResolvedProviderDetailed(
  buffer: Buffer,
  filename: string,
  resolved: ResolvedTranscriptionProvider = resolveTranscriptionProvider(),
  options: TranscriptionRequestOptions = {},
): Promise<DetailedTranscription> {
  if (resolved.provider === "deepgram") {
    return transcribeWithDeepgramDetailed(buffer, filename, {
      model: resolved.model,
      diarize: options.diarize,
      contentType: options.contentType,
    })
  }
  const text = await transcribeWithResolvedProvider(buffer, filename, resolved, options)
  return { text, raw: null }
}
