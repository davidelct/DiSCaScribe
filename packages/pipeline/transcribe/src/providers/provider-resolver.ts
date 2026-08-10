import {
  transcribeWavBuffer as transcribeWithDeepgram,
  transcribeWavBufferDetailed as transcribeWithDeepgramDetailed,
} from "./deepgram-transcriber"
import type { TranscriptWordSpan } from "../../../shared/src/transcript"

export type TranscriptionProvider = "deepgram"

export interface ResolvedTranscriptionProvider {
  provider: TranscriptionProvider
  model: string
  /**
   * Whether to stream incremental 8-12s segments during recording for a live
   * transcript preview. Deepgram is final-pass only (single upload at the end),
   * so live segments are always disabled.
   */
  liveSegments: boolean
}

/** Per-request transcription options (Deepgram supports diarization). */
export interface TranscriptionRequestOptions {
  diarize?: boolean
  /** MIME type of the audio bytes, used for non-WAV uploads (e.g. mp3/m4a). */
  contentType?: string
  /** Caller-supplied Deepgram key (BYOK sessions); falls back to the env key. */
  apiKey?: string
  /** Keyterm Prompting vocabulary applied to this request. */
  keyterms?: readonly string[]
}

const DEFAULT_DEEPGRAM_MODEL = "nova-3"

export function resolveTranscriptionProvider(env: NodeJS.ProcessEnv = process.env): ResolvedTranscriptionProvider {
  return {
    provider: "deepgram",
    model: env.DEEPGRAM_MODEL?.trim() || DEFAULT_DEEPGRAM_MODEL,
    liveSegments: false,
  }
}

export async function transcribeWithResolvedProvider(
  buffer: Buffer,
  filename: string,
  resolved: ResolvedTranscriptionProvider = resolveTranscriptionProvider(),
  options: TranscriptionRequestOptions = {},
): Promise<string> {
  return transcribeWithDeepgram(buffer, filename, {
    model: resolved.model,
    diarize: options.diarize,
    contentType: options.contentType,
    apiKey: options.apiKey,
    keyterms: options.keyterms,
  })
}

/** Transcript text plus the provider's raw response. */
export interface DetailedTranscription {
  text: string
  /** Word confidence spans, as character offsets into `text`. */
  words: TranscriptWordSpan[]
  /** Full Deepgram response (word timings, confidence, speaker turns). */
  raw: unknown
}

/**
 * Like {@link transcribeWithResolvedProvider}, but also returns the provider's
 * raw response (word timings, confidence, speaker turns).
 */
export async function transcribeWithResolvedProviderDetailed(
  buffer: Buffer,
  filename: string,
  resolved: ResolvedTranscriptionProvider = resolveTranscriptionProvider(),
  options: TranscriptionRequestOptions = {},
): Promise<DetailedTranscription> {
  return transcribeWithDeepgramDetailed(buffer, filename, {
    model: resolved.model,
    diarize: options.diarize,
    contentType: options.contentType,
    apiKey: options.apiKey,
    keyterms: options.keyterms,
  })
}
