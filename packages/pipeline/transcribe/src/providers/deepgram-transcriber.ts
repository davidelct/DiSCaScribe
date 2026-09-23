import { PipelineStageError, toPipelineStageError } from "../../../shared/src/error"
import type { TranscriptWordSpan } from "../../../shared/src/transcript"

/**
 * Deepgram Transcriber
 *
 * Transcribes audio using Deepgram's pre-recorded ("upload audio") REST endpoint.
 * The full audio buffer is POSTed as the request body and Deepgram returns a JSON
 * transcript. Speaker diarization is supported via `diarize`: when enabled, the
 * request pins a diarizer with `diarize_model` and the transcript is rendered
 * with `Speaker N:` labels, one line per speaker turn.
 *
 * Turns are cut at word-level speaker changes, not at utterance boundaries.
 * Deepgram's utterance `speaker` is a single label for the whole utterance, and
 * on two consultations (v1 and v2 diarizers alike) 6–17% of words sat inside an
 * utterance labelled with the other speaker — almost always a short answer
 * ("Yes." / "Nope.") glued onto the question before it. Re-cutting the same
 * response at word level took speaker accuracy from 92.7% to 97.5% against a
 * hand-labelled reference; see formatDiarizedTranscript.
 *
 * Docs: https://developers.deepgram.com/reference/speech-to-text-api/listen
 *       https://developers.deepgram.com/docs/diarization
 */

const DEFAULT_DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
const DEFAULT_DEEPGRAM_MODEL = "nova-3"
const DEFAULT_DEEPGRAM_LANGUAGE = "en"
/**
 * Pinned rather than "latest": the app backs a reasoning study, and a diarizer
 * that changes under it mid-study would change the transcripts it compares.
 * Bump deliberately, with DEEPGRAM_DIARIZE_MODEL, after re-running the check
 * described above.
 */
const DEFAULT_DEEPGRAM_DIARIZE_MODEL = "v2"
/**
 * A run of at most this many words, with no sentence-ending punctuation, that
 * the diarizer attributes to a different speaker than both its neighbours is
 * treated as jitter and folded into the sentence it sits in. Real one-word
 * answers ("Yeah.", "No.") carry punctuation and are left alone.
 */
const SHORT_RUN_MAX_WORDS = 3
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RETRIES = 2

export interface DeepgramTranscriberOptions {
  /** Render the transcript with `Speaker N:` labels, one line per speaker turn. */
  diarize?: boolean
  /**
   * Deepgram diarizer version, sent as `diarize_model` ("v1", "v2", "latest").
   * Defaults to DEEPGRAM_DIARIZE_MODEL, else v2.
   */
  diarizeModel?: string
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
  /** Speaker label for this word when diarization is on. */
  speaker?: number
  /** Deepgram's confidence in that label, pre-recorded audio only. */
  speaker_confidence?: number
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

/** A word's character range within the text it was located in. */
interface WordPosition {
  start: number
  end: number
}

/**
 * Locate each word within the text Deepgram rendered for it. One entry per
 * word, in order; null where the word could not be found.
 *
 * Deepgram lists words in order, so a monotonic cursor keeps repeated words
 * distinct. smart_format can rewrite a word between the `words` array and the
 * transcript ("eight" → "8"); those come back null rather than mis-located,
 * which costs a mark but never attaches a confidence to the wrong text.
 */
function locateWords(text: string, words: DeepgramWord[]): Array<WordPosition | null> {
  const positions: Array<WordPosition | null> = []
  let cursor = 0

  for (const word of words) {
    const token = (word.punctuated_word || word.word || "").trim()
    if (!token) {
      positions.push(null)
      continue
    }

    const index = findToken(text, token, cursor)
    if (index === -1) {
      positions.push(null)
      continue
    }

    positions.push({ start: index, end: index + token.length })
    cursor = index + token.length
  }

  return positions
}

/** Confidence spans for the located words, as offsets into the full transcript. */
function confidenceSpans(
  words: DeepgramWord[],
  positions: Array<WordPosition | null>,
  baseOffset: number,
): TranscriptWordSpan[] {
  const spans: TranscriptWordSpan[] = []
  words.forEach((word, index) => {
    const position = positions[index]
    if (!position || typeof word.confidence !== "number") return
    spans.push({ start: baseOffset + position.start, end: baseOffset + position.end, confidence: word.confidence })
  })
  return spans
}

/** A rendered transcript plus word confidence spans indexed into it. */
interface TranscriptWithSpans {
  text: string
  spans: TranscriptWordSpan[]
}

/**
 * A stretch of one utterance's text spoken by one speaker, with its located
 * words (offsets relative to `text`).
 */
interface SpeakerPiece {
  speaker: number
  text: string
  words: DeepgramWord[]
  positions: Array<WordPosition | null>
  wordCount: number
}

function endsSentence(text: string): boolean {
  return /[.?!]["')\]]*$/.test(text)
}

/**
 * Cut one utterance into pieces at word-level speaker changes.
 *
 * The utterance text is sliced, not rebuilt from the words, so smart_format's
 * rendering survives untouched. A cut lands at the start of the first located
 * word of the new speaker; the whitespace before it stays with the earlier
 * piece and is trimmed. A word that could not be located cannot host a cut,
 * so a change there takes effect at the next word that can.
 */
function cutUtterance(utterance: DeepgramUtterance): SpeakerPiece[] {
  const text = utterance.transcript?.trim() ?? ""
  if (!text) return []
  const fallbackSpeaker = typeof utterance.speaker === "number" ? utterance.speaker : 0
  const words = utterance.words ?? []
  if (words.length === 0) {
    return [{ speaker: fallbackSpeaker, text, words: [], positions: [], wordCount: text.split(/\s+/).length }]
  }

  const positions = locateWords(text, words)
  const speakerOf = (word: DeepgramWord) => (typeof word.speaker === "number" ? word.speaker : fallbackSpeaker)

  const pieces: SpeakerPiece[] = []
  let pieceStart = 0
  let pieceFirstWord = 0
  let pieceSpeaker = speakerOf(words[0])
  let pendingSpeaker: number | null = null

  const close = (endOffset: number, endWord: number) => {
    const pieceText = text.slice(pieceStart, endOffset).trimEnd()
    const pieceWords = words.slice(pieceFirstWord, endWord)
    const piecePositions = positions
      .slice(pieceFirstWord, endWord)
      .map((position) => (position ? { start: position.start - pieceStart, end: position.end - pieceStart } : null))
    if (pieceText) {
      pieces.push({
        speaker: pieceSpeaker,
        text: pieceText,
        words: pieceWords,
        positions: piecePositions,
        wordCount: pieceWords.length,
      })
    }
  }

  for (let index = 1; index < words.length; index += 1) {
    const speaker = speakerOf(words[index])
    if (speaker !== pieceSpeaker) pendingSpeaker = speaker
    else if (pendingSpeaker !== null && speaker === pieceSpeaker) pendingSpeaker = null
    const position = positions[index]
    if (pendingSpeaker === null || !position) continue

    close(position.start, index)
    pieceStart = position.start
    pieceFirstWord = index
    pieceSpeaker = pendingSpeaker
    pendingSpeaker = null
  }
  close(text.length, words.length)

  return pieces
}

/** Consecutive pieces by one speaker, before rendering as a `Speaker N:` line. */
interface SpeakerRun {
  speaker: number
  pieces: SpeakerPiece[]
  wordCount: number
  endsSentence: boolean
}

function appendToRun(run: SpeakerRun, piece: SpeakerPiece): void {
  run.pieces.push(piece)
  run.wordCount += piece.wordCount
  run.endsSentence = endsSentence(piece.text)
}

/**
 * Group pieces into speaker runs, folding diarizer jitter: a short run with no
 * sentence-ending punctuation, sandwiched between other speakers, belongs to
 * the sentence it interrupts — the one before it, or the one after when the
 * previous run already ended a sentence ("months. | Have you | ever…").
 */
function groupIntoRuns(pieces: SpeakerPiece[]): SpeakerRun[] {
  const runs: SpeakerRun[] = []
  for (const piece of pieces) {
    const last = runs[runs.length - 1]
    if (last && last.speaker === piece.speaker) appendToRun(last, piece)
    else runs.push({ speaker: piece.speaker, pieces: [piece], wordCount: piece.wordCount, endsSentence: endsSentence(piece.text) })
  }

  const smoothed: SpeakerRun[] = []
  runs.forEach((run, index) => {
    const previous = smoothed[smoothed.length - 1]
    if (previous && run.wordCount <= SHORT_RUN_MAX_WORDS && !run.endsSentence) {
      const next = runs[index + 1]
      run.speaker = previous.endsSentence && next ? next.speaker : previous.speaker
    }
    if (previous && previous.speaker === run.speaker) {
      for (const piece of run.pieces) appendToRun(previous, piece)
    } else {
      smoothed.push(run)
    }
  })
  return smoothed
}

/**
 * Build a transcript with `Speaker N:` labels from Deepgram utterances, one
 * line per speaker turn, turns cut at word-level speaker changes.
 *
 * Confidence spans are collected while the string is assembled — pieces and
 * rendered lines aren't 1:1, so offsets can't be reconstructed by re-parsing
 * the result afterwards.
 */
function formatDiarizedTranscript(utterances: DeepgramUtterance[]): TranscriptWithSpans {
  const pieces = utterances.flatMap(cutUtterance)
  const runs = groupIntoRuns(pieces)

  const spans: TranscriptWordSpan[] = []
  let text = ""
  for (const run of runs) {
    if (text) text += "\n"
    text += `Speaker ${run.speaker}: `
    run.pieces.forEach((piece, index) => {
      if (index > 0) text += " "
      const baseOffset = text.length
      text += piece.text
      spans.push(...confidenceSpans(piece.words, piece.positions, baseOffset))
    })
  }

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
  const words = alternative?.words ?? []
  const spans = text && words.length ? confidenceSpans(words, locateWords(text, words), 0) : []
  return { text, spans }
}

/**
 * Rebuild the transcript and its confidence spans from a stored Deepgram
 * response (raw_transcript.json in the archive). Recovery uses this to restore
 * the per-word confidence marks, which only the browser kept.
 */
export function transcriptFromDeepgramResponse(raw: unknown): { text: string; words: TranscriptWordSpan[] } {
  const { text, spans } = extractTranscript((raw ?? {}) as DeepgramResponse, true)
  return { text, words: spans }
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
  const diarizeModel = options?.diarizeModel || process.env.DEEPGRAM_DIARIZE_MODEL || DEFAULT_DEEPGRAM_DIARIZE_MODEL
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
    // `diarize_model` both turns diarization on and pins the diarizer. The
    // older `diarize=true` flag is deprecated and always routes to the v1
    // diarizer, and Deepgram rejects a request that carries both.
    url.searchParams.set("diarize_model", diarizeModel)
    // Utterances carry the per-word speaker labels the turns are cut from.
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
