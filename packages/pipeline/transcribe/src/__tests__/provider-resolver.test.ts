import assert from "node:assert/strict"
import test from "node:test"
import { resolveTranscriptionProvider } from "../providers/provider-resolver.js"
import { transcribeWavBuffer as transcribeWithDeepgram } from "../providers/deepgram-transcriber.js"
import { transcribeWavBuffer as transcribeWithWhisperLocal } from "../providers/whisper-local-transcriber.js"

test("resolveTranscriptionProvider defaults to whisper_local with tiny.en model", () => {
  const resolved = resolveTranscriptionProvider({})
  assert.equal(resolved.provider, "whisper_local")
  assert.equal(resolved.model, "tiny.en")
})

test("resolveTranscriptionProvider supports explicit provider aliases", () => {
  assert.equal(resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "medasr" }).provider, "medasr")
  assert.equal(resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "openai" }).provider, "whisper_openai")
  assert.equal(resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "whisper_openai" }).provider, "whisper_openai")
  assert.equal(resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "whisper_local" }).provider, "whisper_local")
})

test("resolveTranscriptionProvider resolves deepgram with nova-3 default model", () => {
  assert.deepEqual(resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "deepgram" }), {
    provider: "deepgram",
    model: "nova-3",
    liveSegments: false,
  })
  assert.equal(
    resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "deepgram", DEEPGRAM_MODEL: "nova-2" }).model,
    "nova-2",
  )
})

test("deepgram disables live segments while whisper keeps them enabled", () => {
  assert.equal(resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "deepgram" }).liveSegments, false)
  assert.equal(resolveTranscriptionProvider({}).liveSegments, true)
  assert.equal(resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "whisper_openai" }).liveSegments, true)
})

test("deepgram transcriber formats diarized utterances with speaker labels", async () => {
  const deepgramResponse = {
    results: {
      channels: [{ alternatives: [{ transcript: "hello how are you feeling" }] }],
      utterances: [
        { speaker: 0, transcript: "Hello." },
        { speaker: 0, transcript: "What brings you in today?" },
        { speaker: 1, transcript: "I have a headache." },
        { speaker: 0, transcript: "How long?" },
      ],
    },
  }
  let requestUrl = ""
  const fetchFn: typeof fetch = (async (url: string) => {
    requestUrl = url
    return new Response(JSON.stringify(deepgramResponse), { status: 200 })
  }) as typeof fetch

  const text = await transcribeWithDeepgram(Buffer.from([1, 2, 3]), "final.wav", {
    diarize: true,
    apiKey: "test-key",
    fetchFn,
  })

  assert.equal(
    text,
    "Speaker 0: Hello. What brings you in today?\nSpeaker 1: I have a headache.\nSpeaker 0: How long?",
  )
  assert.match(requestUrl, /diarize=true/)
  assert.match(requestUrl, /utterances=true/)
})

test("deepgram transcriber returns plain transcript when diarize is disabled", async () => {
  let requestUrl = ""
  const fetchFn: typeof fetch = (async (url: string) => {
    requestUrl = url
    return new Response(
      JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: " plain text " }] }] } }),
      { status: 200 },
    )
  }) as typeof fetch

  const text = await transcribeWithDeepgram(Buffer.from([1, 2, 3]), "segment.wav", {
    apiKey: "test-key",
    fetchFn,
  })

  assert.equal(text, "plain text")
  assert.doesNotMatch(requestUrl, /diarize=true/)
})

test("deepgram transcriber fails clearly without an API key", async () => {
  await assert.rejects(
    () => transcribeWithDeepgram(Buffer.from([1, 2, 3]), "final.wav", { apiKey: "", fetchFn: undefined }),
    /Missing DEEPGRAM_API_KEY/,
  )
})

test("whisper local transcriber retries transient failures and returns text", async () => {
  const waitCalls: number[] = []
  let attempts = 0
  const fetchFn: typeof fetch = (async () => {
    attempts += 1
    if (attempts < 3) {
      return new Response("server busy", { status: 503 })
    }
    return new Response(JSON.stringify({ text: " final transcript " }), { status: 200 })
  }) as typeof fetch

  const text = await transcribeWithWhisperLocal(Buffer.from([1, 2, 3]), "segment.wav", {
    fetchFn,
    waitFn: async (ms) => {
      waitCalls.push(ms)
    },
    timeoutMs: 10_000,
    maxRetries: 3,
    baseUrl: "http://127.0.0.1:8002/v1/audio/transcriptions",
  })

  assert.equal(text, "final transcript")
  assert.equal(attempts, 3)
  assert.deepEqual(waitCalls, [250, 500])
})

test("whisper local transcriber surfaces connection guidance when server is unavailable", async () => {
  const fetchFn: typeof fetch = (async () => {
    throw new TypeError("fetch failed")
  }) as typeof fetch

  await assert.rejects(
    () =>
      transcribeWithWhisperLocal(Buffer.from([1, 2, 3]), "segment.wav", {
        fetchFn,
        waitFn: async () => {
          // no-op
        },
        timeoutMs: 10_000,
        maxRetries: 1,
      }),
    /Cannot connect to Whisper local server/,
  )
})
