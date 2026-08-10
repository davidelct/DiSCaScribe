import { PipelineStageError, toPipelineStageError } from "../../../shared/src/error"
import type { TranscriptWordSpan } from "../../../shared/src/transcript"

/**
 * Deepgram Transcriber
 *
 * Transcribes audio using Deepgram's pre-recorded ("upload audio") REST endpoint.
 * The full WAV buffer is POSTed as the request body and Deepgram returns a JSON
 * transcript. Speaker diarization is supported via `diarize`: when enabled, the
 * transcript is rendered with `Speaker N:` labels grouped by speaker.
 *
 * Docs: https://developers.deepgram.com/reference/speech-to-text-api/listen
 */

const DEFAULT_DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
const DEFAULT_DEEPGRAM_MODEL = "nova-3"
const DEFAULT_DEEPGRAM_LANGUAGE = "en"
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RETRIES = 2

export interface DeepgramTranscriberOptions {
  /** Render the transcript with `Speaker N:` labels grouped by speaker. */
  diarize?: boolean
  model?: string
  language?: string
  apiKey?: string
  baseUrl?: string
  /** MIME type of the audio bytes (e.g. "audio/wav", "audio/mpeg"). Deepgram also auto-detects. */
  contentType?: string
  /**
   * Keyterm Prompting vocabulary (Nova-3 only). Sent as one repeated `keyterm`
   * param per term; multi-word terms are URL-encoded by URLSearchParams.
   */
  keyterms?: readonly string[]
  timeoutMs?: number
  maxRetries?: number
  fetchFn?: typeof fetch
  waitFn?: (ms: number) => Promise<void>
}

interface DeepgramWord {
  word?: string
  /** The word as it appears in the transcript once smart_format/punctuate ran. */
  punctuated_word?: string
  confidence?: number
}

interface DeepgramUtterance {
  speaker?: number
  transcript?: string
  confidence?: number
  words?: DeepgramWord[]
}

interface DeepgramAlternative {
  transcript?: string
  confidence?: number
  words?: DeepgramWord[]
}

interface DeepgramResponse {
  results?: {
    channels?: Array<{ alternatives?: DeepgramAlternative[] }>
    utterances?: DeepgramUtterance[]
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * HIPAA Compliance: Validate that the Deepgram endpoint uses HTTPS so PHI is
 * encrypted in transit. Mirrors the guard used by the OpenAI Whisper provider.
 */
function validateHttpsUrl(url: string, serviceName: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") {
      throw new PipelineStageError(
        "configuration_error",
        `SECURITY ERROR: ${serviceName} endpoint must use HTTPS for HIPAA compliance. ` +
          `Received: ${parsed.protocol}//${parsed.host}`,
        false,
      )
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new PipelineStageError("configuration_error", `Invalid ${serviceName} URL: ${url}`, false)
    }
    throw error
  }
}

function resolvePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  timeoutMs: number,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchFn(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Find `token` at or after `from`, preferring a match that starts on a word
 * boundary so a short token ("in") can't land inside a longer word ("inside").
 * Falls back to a plain match when no boundary match exists.
 */
function findToken(text: string, token: string, from: number): number {
  let index = text.indexOf(token, from)
  while (index !== -1) {
    const preceding = index > 0 ? text[index - 1] : " "
    if (!/[A-Za-z0-9]/.test(preceding)) return index
    index = text.indexOf(token, index + 1)
  }
  return text.indexOf(token, from)
}

/**
 * Locate each word within the text Deepgram rendered for it, returning spans
 * offset by `baseOffset` (the text's position in the full transcript).
 *
 * Deepgram lists words in order, so a monotonic cursor keeps repeated words
 * distinct. smart_format can rewrite a word between the `words` array and the
 * transcript ("eight" → "8"); those are skipped rather than mis-marked, which
 * costs a mark but never attaches a confidence to the wrong text.
 */
function locateWords(text: string, words: DeepgramWord[], baseOffset: number): TranscriptWordSpan[] {
  const spans: TranscriptWordSpan[] = []
  let cursor = 0

  for (const word of words) {
    if (typeof word.confidence !== "number") continue
    const token = (word.punctuated_word || word.word || "").trim()
    if (!token) continue

    const index = findToken(text, token, cursor)
    if (index === -1) continue

    spans.push({
      start: baseOffset + index,
      end: baseOffset + index + token.length,
      confidence: word.confidence,
    })
    cursor = index + token.length
  }

  return spans
}

/** A rendered transcript plus word confidence spans indexed into it. */
interface TranscriptWithSpans {
  text: string
  spans: TranscriptWordSpan[]
}

/**
 * Build a transcript with `Speaker N:` labels from Deepgram utterances, merging
 * consecutive utterances spoken by the same speaker into a single line.
 *
 * Confidence spans are collected while the string is assembled — the merge
 * means utterances and rendered lines aren't 1:1, so offsets can't be
 * reconstructed by re-parsing the result afterwards.
 */
function formatDiarizedTranscript(utterances: DeepgramUtterance[]): TranscriptWithSpans {
  const spans: TranscriptWordSpan[] = []
  let text = ""
  let currentSpeaker: number | null = null
  let run: DeepgramUtterance[] = []

  const flush = () => {
    if (run.length === 0) return
    if (text) text += "\n"
    text += `Speaker ${currentSpeaker ?? 0}: `

    run.forEach((utterance, index) => {
      if (index > 0) text += " "
      const utteranceText = utterance.transcript?.trim() ?? ""
      const baseOffset = text.length
      text += utteranceText
      if (utterance.words?.length) {
        spans.push(...locateWords(utteranceText, utterance.words, baseOffset))
      }
    })

    run = []
  }

  for (const utterance of utterances) {
    if (!utterance.transcript?.trim()) continue
    const speaker = typeof utterance.speaker === "number" ? utterance.speaker : 0
    if (speaker !== currentSpeaker) {
      flush()
      currentSpeaker = speaker
    }
    run.push(utterance)
  }
  flush()

  return { text, spans }
}

function extractTranscript(result: DeepgramResponse, diarize: boolean): TranscriptWithSpans {
  const utterances = result.results?.utterances
  if (diarize && utterances && utterances.length > 0) {
    const diarized = formatDiarizedTranscript(utterances)
    if (diarized.text) return diarized
  }

  const alternative = result.results?.channels?.[0]?.alternatives?.[0]
  const text = alternative?.transcript?.trim() ?? ""
  const spans = text && alternative?.words?.length ? locateWords(text, alternative.words, 0) : []
  return { text, spans }
}

/** The raw, parsed Deepgram response plus whether diarization was requested. */
export interface DeepgramDetailedResult {
  /** Transcript text (diarized with `Speaker N:` labels when diarize is on). */
  text: string
  /** Word confidence spans, as character offsets into `text`. */
  words: TranscriptWordSpan[]
  /** The full parsed Deepgram JSON response (utterances, words, confidence, …). */
  raw: DeepgramResponse
}

async function requestDeepgram(
  buffer: Buffer,
  filename: string,
  options?: DeepgramTranscriberOptions,
): Promise<{ result: DeepgramResponse; diarize: boolean }> {
  const baseUrl = options?.baseUrl || process.env.DEEPGRAM_URL || DEFAULT_DEEPGRAM_URL
  const model = options?.model || process.env.DEEPGRAM_MODEL || DEFAULT_DEEPGRAM_MODEL
  const language = options?.language || process.env.DEEPGRAM_LANGUAGE || DEFAULT_DEEPGRAM_LANGUAGE
  const diarize = options?.diarize ?? false
  const contentType = options?.contentType || "audio/wav"
  const timeoutMs = options?.timeoutMs ?? resolvePositiveInteger(process.env.DEEPGRAM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  const maxRetries = options?.maxRetries ?? resolvePositiveInteger(process.env.DEEPGRAM_MAX_RETRIES, DEFAULT_MAX_RETRIES)
  const fetchFn = options?.fetchFn ?? globalThis.fetch.bind(globalThis)
  const waitFn = options?.waitFn ?? wait

  validateHttpsUrl(baseUrl, "Deepgram API")

  const apiKey = options?.apiKey || process.env.DEEPGRAM_API_KEY
  if (!apiKey) {
    throw new PipelineStageError(
      "configuration_error",
      "Missing DEEPGRAM_API_KEY. Please configure your Deepgram API key in Settings.",
      false,
    )
  }

  // Pre-recorded "upload audio": query params configure the request; the audio
  // bytes are the request body. https://developers.deepgram.com/reference
  const url = new URL(baseUrl)
  url.searchParams.set("model", model)
  if (language && language.toLowerCase() !== "auto") {
    url.searchParams.set("language", language)
  }
  url.searchParams.set("smart_format", "true")
  url.searchParams.set("punctuate", "true")
  if (diarize) {
    url.searchParams.set("diarize", "true")
    url.searchParams.set("utterances", "true")
  }
  // Repeated rather than delimited, so each term is processed individually.
  for (const term of options?.keyterms ?? []) {
    const trimmed = term.trim()
    if (trimmed) url.searchParams.append("keyterm", trimmed)
  }

  const totalAttempts = maxRetries + 1
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchFn, timeoutMs, url.toString(), {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": contentType,
        },
        body: new Uint8Array(buffer),
      })

      if (!response.ok) {
        const errorText = await response.text()
        const retryable = shouldRetryStatus(response.status) && attempt < totalAttempts
        if (retryable) {
          await waitFn(250 * attempt)
          continue
        }

        if (response.status === 401 || response.status === 403) {
          throw new PipelineStageError(
            "configuration_error",
            `Deepgram rejected the API key (${response.status}). Check DEEPGRAM_API_KEY.`,
            false,
            { status: response.status, provider: "deepgram" },
          )
        }

        throw new PipelineStageError(
          "api_error",
          `Deepgram transcription failed (${response.status}): ${errorText}`,
          shouldRetryStatus(response.status),
          { status: response.status, provider: "deepgram" },
        )
      }

      const result = (await response.json()) as DeepgramResponse
      return { result, diarize }
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError"
      const isNetworkFetch = error instanceof TypeError && error.message.toLowerCase().includes("fetch")
      const shouldRetry = (isAbort || isNetworkFetch) && attempt < totalAttempts
      if (shouldRetry) {
        await waitFn(250 * attempt)
        continue
      }

      if (isAbort) {
        throw new PipelineStageError(
          "timeout_error",
          `Deepgram transcription timed out after ${timeoutMs}ms (attempt ${attempt}/${totalAttempts}).`,
          true,
          { timeoutMs, attempt, totalAttempts, provider: "deepgram" },
        )
      }

      if (isNetworkFetch) {
        throw new PipelineStageError(
          "network_error",
          `Cannot connect to Deepgram at ${baseUrl}. Check your network connection.`,
          true,
          { provider: "deepgram", url: baseUrl },
        )
      }

      throw toPipelineStageError(error, {
        code: "transcription_error",
        message: "Deepgram transcription failed",
        recoverable: true,
        details: { provider: "deepgram" },
      })
    }
  }

  throw new PipelineStageError("api_error", "Deepgram transcription failed after retries", true, {
    provider: "deepgram",
  })
}

/** Transcribe a WAV buffer with Deepgram, returning the transcript text only. */
export async function transcribeWavBuffer(
  buffer: Buffer,
  filename: string,
  options?: DeepgramTranscriberOptions,
): Promise<string> {
  const { result, diarize } = await requestDeepgram(buffer, filename, options)
  return extractTranscript(result, diarize).text
}

/**
 * Transcribe a WAV buffer with Deepgram, returning the transcript text, word
 * confidence spans indexed into it, and the full raw JSON response. Used when
 * the raw output (word-level timings, confidence, speaker turns) needs to be
 * preserved alongside the rendered text.
 */
export async function transcribeWavBufferDetailed(
  buffer: Buffer,
  filename: string,
  options?: DeepgramTranscriberOptions,
): Promise<DeepgramDetailedResult> {
  const { result, diarize } = await requestDeepgram(buffer, filename, options)
  const { text, spans } = extractTranscript(result, diarize)
  return { text, words: spans, raw: result }
}
