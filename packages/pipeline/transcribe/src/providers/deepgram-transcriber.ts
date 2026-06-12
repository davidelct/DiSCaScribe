import { PipelineStageError, toPipelineStageError } from "../../../shared/src/error"

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
  timeoutMs?: number
  maxRetries?: number
  fetchFn?: typeof fetch
  waitFn?: (ms: number) => Promise<void>
}

interface DeepgramUtterance {
  speaker?: number
  transcript?: string
}

interface DeepgramResponse {
  results?: {
    channels?: Array<{ alternatives?: Array<{ transcript?: string }> }>
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
 * Build a transcript with `Speaker N:` labels from Deepgram utterances, merging
 * consecutive utterances spoken by the same speaker into a single line.
 */
function formatDiarizedTranscript(utterances: DeepgramUtterance[]): string {
  const lines: string[] = []
  let currentSpeaker: number | null = null
  let currentParts: string[] = []

  const flush = () => {
    if (currentParts.length > 0) {
      lines.push(`Speaker ${currentSpeaker ?? 0}: ${currentParts.join(" ")}`)
    }
  }

  for (const utterance of utterances) {
    const text = utterance.transcript?.trim()
    if (!text) continue
    const speaker = typeof utterance.speaker === "number" ? utterance.speaker : 0
    if (speaker !== currentSpeaker) {
      flush()
      currentSpeaker = speaker
      currentParts = [text]
    } else {
      currentParts.push(text)
    }
  }
  flush()

  return lines.join("\n")
}

function extractTranscript(result: DeepgramResponse, diarize: boolean): string {
  const utterances = result.results?.utterances
  if (diarize && utterances && utterances.length > 0) {
    const diarized = formatDiarizedTranscript(utterances)
    if (diarized) return diarized
  }
  return result.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? ""
}

export async function transcribeWavBuffer(
  buffer: Buffer,
  filename: string,
  options?: DeepgramTranscriberOptions,
): Promise<string> {
  const baseUrl = options?.baseUrl || process.env.DEEPGRAM_URL || DEFAULT_DEEPGRAM_URL
  const model = options?.model || process.env.DEEPGRAM_MODEL || DEFAULT_DEEPGRAM_MODEL
  const language = options?.language || process.env.DEEPGRAM_LANGUAGE || DEFAULT_DEEPGRAM_LANGUAGE
  const diarize = options?.diarize ?? false
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

  const totalAttempts = maxRetries + 1
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchFn, timeoutMs, url.toString(), {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "audio/wav",
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
      return extractTranscript(result, diarize)
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
