import assert from "node:assert/strict"
import test from "node:test"
import { parseWavHeader } from "../core/wav.js"
import {
  SegmentUploadController,
  type PendingSegment,
  type UploadError,
} from "../hooks/segment-upload-controller.js"
import { transcribeWavBuffer, transcribeWavBufferDetailed } from "../providers/deepgram-transcriber.js"

function createTestWavBuffer({
  sampleRate,
  numChannels,
  numSamples,
  bitDepth = 16,
}: {
  sampleRate: number
  numChannels: number
  numSamples: number
  bitDepth?: number
}): ArrayBuffer {
  const bytesPerSample = bitDepth / 8
  const dataSize = numSamples * numChannels * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeString(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true)
  view.setUint16(32, numChannels * bytesPerSample, true)
  view.setUint16(34, bitDepth, true)
  writeString(36, "data")
  view.setUint32(40, dataSize, true)

  return buffer
}

function createSegment(seqNo: number): PendingSegment {
  return {
    seqNo,
    startMs: seqNo * 1000,
    endMs: seqNo * 1000 + 1000,
    durationMs: 1000,
    overlapMs: 250,
    blob: new Blob([new Uint8Array([seqNo])], { type: "audio/wav" }),
  }
}

test("parseWavHeader returns accurate metadata", () => {
  const buffer = createTestWavBuffer({ sampleRate: 16000, numChannels: 2, numSamples: 16000 })
  const info = parseWavHeader(buffer)

  assert.equal(info.sampleRate, 16000)
  assert.equal(info.numChannels, 2)
  assert.equal(info.bitDepth, 16)
  assert.equal(info.durationMs, 1000, "32000 samples at 16kHz stereo should equal 1 second")
})

test("parseWavHeader rejects short buffers", () => {
  const tiny = new ArrayBuffer(10)
  try {
    parseWavHeader(tiny)
    assert.fail("Expected parseWavHeader to throw")
  } catch (error) {
    assert.equal(typeof error, "object")
    assert.equal((error as { code?: string }).code, "validation_error")
    assert.equal((error as { message?: string }).message, "WAV buffer too small")
    assert.equal((error as { recoverable?: boolean }).recoverable, true)
  }
})

test("SegmentUploadController enforces concurrency limits", async () => {
  const totalSegments = 5
  let completed = 0
  let maxInFlight = 0
  let currentInFlight = 0
  let completionResolve: (() => void) | null = null
  const completionPromise = new Promise<void>((resolve) => {
    completionResolve = resolve
  })

  const fetchStub: typeof fetch = async () => {
    currentInFlight++
    maxInFlight = Math.max(maxInFlight, currentInFlight)
    await new Promise((resolve) => setImmediate(resolve))
    currentInFlight--
    completed += 1
    if (completed === totalSegments) {
      completionResolve?.()
    }
    return new Response("{}", { status: 200 })
  }

  const controller = new SegmentUploadController("session-1", undefined, { fetchFn: fetchStub })

  for (let i = 0; i < totalSegments; i++) {
    controller.enqueueSegment(createSegment(i))
  }

  await completionPromise
  controller.dispose()

  assert.equal(completed, totalSegments)
  assert.equal(maxInFlight, 2, "No more than two uploads should be in flight simultaneously")
  assert.equal(currentInFlight, 0)
})

test("SegmentUploadController retries transient errors and surfaces final failures", async () => {
  const waitCalls: number[] = []
  const errors: UploadError[] = []
  let attempt = 0
  let completionResolve: (() => void) | null = null
  const completionPromise = new Promise<void>((resolve) => {
    completionResolve = resolve
  })

  const fetchStub: typeof fetch = async () => {
    attempt += 1
    if (attempt < 3) {
      return new Response(JSON.stringify({ error: { code: "api_error", message: "server tired" } }), { status: 500 })
    }
    completionResolve?.()
    return new Response("{}", { status: 200 })
  }

  const controller = new SegmentUploadController(
    "session-1",
    {
      onError: (error) => errors.push(error),
    },
    {
      fetchFn: fetchStub,
      waitFn: async (ms) => {
        waitCalls.push(ms)
      },
    },
  )

  controller.enqueueSegment(createSegment(1))
  await completionPromise
  controller.dispose()

  assert.deepEqual(waitCalls, [250, 500], "Should wait with incremental backoff for retries")
  assert.equal(errors.length, 0, "Successful retry should not surface an error")

  const failingFetch: typeof fetch = async () => {
    return new Response(JSON.stringify({ error: { code: "validation_error", message: "bad segment" } }), { status: 400 })
  }

  const failureController = new SegmentUploadController(
    "session-2",
    {
      onError: (error) => errors.push(error),
    },
    {
      fetchFn: failingFetch,
      waitFn: async () => {
        /* no-op */
      },
    },
  )

  failureController.enqueueSegment(createSegment(2))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(errors.at(-1)?.code, "validation_error")
  assert.match(errors.at(-1)?.message ?? "", /bad segment/)

  failureController.setSessionId(null)
  failureController.enqueueSegment(createSegment(3))
  assert.equal(errors.at(-1)?.code, "capture_error", "Missing session should surface capture_error")

  failureController.dispose()
})

test("transcribeWavBuffer validates API keys and forwards payloads", async () => {
  const originalKey = process.env.DEEPGRAM_API_KEY
  const originalFetch = globalThis.fetch

  process.env.DEEPGRAM_API_KEY = ""
  await assert.rejects(() => transcribeWavBuffer(Buffer.from([0, 1, 2]), "sample.wav"), /DEEPGRAM_API_KEY/)

  const seen: { url?: string; headers?: HeadersInit } = {}
  process.env.DEEPGRAM_API_KEY = "test-key"
  globalThis.fetch = (async (url, init) => {
    seen.url = url as string
    seen.headers = init?.headers
    return new Response(
      JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: " hi " }] }] } }),
      { status: 200 },
    )
  }) as typeof fetch

  try {
    const text = await transcribeWavBuffer(Buffer.from([1, 2, 3]), "clip.wav")
    assert.equal(text, "hi")
    assert(seen.url?.startsWith("https://api.deepgram.com/v1/listen"))
    const authHeader = (seen.headers as Record<string, string>)?.Authorization
    assert.equal(authHeader, "Token test-key")
  } finally {
    process.env.DEEPGRAM_API_KEY = originalKey
    globalThis.fetch = originalFetch
  }
})

test("transcribeWavBufferDetailed returns diarized text and the raw response", async () => {
  const originalKey = process.env.DEEPGRAM_API_KEY
  const originalFetch = globalThis.fetch

  const deepgramResponse = {
    results: {
      channels: [{ alternatives: [{ transcript: "Hello there. Hi doctor." }] }],
      utterances: [
        { speaker: 0, transcript: "Hello there." },
        { speaker: 1, transcript: "Hi doctor." },
      ],
    },
  }

  process.env.DEEPGRAM_API_KEY = "dg-test-key"
  globalThis.fetch = (async () => new Response(JSON.stringify(deepgramResponse), { status: 200 })) as typeof fetch

  try {
    const result = await transcribeWavBufferDetailed(Buffer.from([1, 2, 3]), "clip.wav", { diarize: true })
    // Diarized text groups utterances by speaker.
    assert.equal(result.text, "Speaker 0: Hello there.\nSpeaker 1: Hi doctor.")
    // The full raw JSON is preserved for downstream archival/research.
    assert.deepEqual(result.raw, deepgramResponse)
  } finally {
    process.env.DEEPGRAM_API_KEY = originalKey
    globalThis.fetch = originalFetch
  }
})

test("transcribeWavBuffer enforces HTTPS for HIPAA compliance", async () => {
  const originalKey = process.env.DEEPGRAM_API_KEY
  const originalFetch = globalThis.fetch

  process.env.DEEPGRAM_API_KEY = "test-key"
  let capturedUrl: string | undefined

  globalThis.fetch = (async (url) => {
    capturedUrl = url as string
    return new Response(
      JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "test" }] }] } }),
      { status: 200 },
    )
  }) as typeof fetch

  try {
    await transcribeWavBuffer(Buffer.from([1, 2, 3]), "test.wav")
    assert(capturedUrl?.startsWith("https://"), "Deepgram API URL must use HTTPS")
  } finally {
    process.env.DEEPGRAM_API_KEY = originalKey
    globalThis.fetch = originalFetch
  }
})

test("transcribeWavBufferDetailed returns word spans that index into the transcript", async () => {
  const originalKey = process.env.DEEPGRAM_API_KEY
  const originalFetch = globalThis.fetch

  const deepgramResponse = {
    results: {
      channels: [{ alternatives: [{ transcript: "Take ramipril daily. Understood." }] }],
      utterances: [
        {
          speaker: 0,
          transcript: "Take ramipril daily.",
          words: [
            { word: "take", punctuated_word: "Take", confidence: 0.99 },
            { word: "ramipril", punctuated_word: "ramipril", confidence: 0.42 },
            { word: "daily", punctuated_word: "daily.", confidence: 0.97 },
          ],
        },
        {
          speaker: 1,
          transcript: "Understood.",
          words: [{ word: "understood", punctuated_word: "Understood.", confidence: 0.88 }],
        },
      ],
    },
  }

  process.env.DEEPGRAM_API_KEY = "dg-test-key"
  globalThis.fetch = (async () => new Response(JSON.stringify(deepgramResponse), { status: 200 })) as typeof fetch

  try {
    const result = await transcribeWavBufferDetailed(Buffer.from([1, 2, 3]), "clip.wav", { diarize: true })

    assert.equal(result.text, "Speaker 0: Take ramipril daily.\nSpeaker 1: Understood.")
    assert.equal(result.words.length, 4)

    // Every span must slice its own word back out of the rendered transcript —
    // including across the speaker-label prefix and the newline between turns.
    const sliced = result.words.map((span) => result.text.slice(span.start, span.end))
    assert.deepEqual(sliced, ["Take", "ramipril", "daily.", "Understood."])

    const uncertain = result.words.find((span) => span.confidence < 0.6)
    assert.equal(result.text.slice(uncertain!.start, uncertain!.end), "ramipril")
  } finally {
    process.env.DEEPGRAM_API_KEY = originalKey
    globalThis.fetch = originalFetch
  }
})

test("word spans stay aligned when consecutive utterances are merged into one line", async () => {
  const originalKey = process.env.DEEPGRAM_API_KEY
  const originalFetch = globalThis.fetch

  // Same speaker twice: the transcriber joins these into a single line, so the
  // second utterance's offsets depend on the first — the case that breaks if
  // offsets are reconstructed after the fact rather than during assembly.
  const deepgramResponse = {
    results: {
      channels: [{ alternatives: [{ transcript: "Chest pain. Since Tuesday." }] }],
      utterances: [
        {
          speaker: 0,
          transcript: "Chest pain.",
          words: [
            { punctuated_word: "Chest", confidence: 0.95 },
            { punctuated_word: "pain.", confidence: 0.91 },
          ],
        },
        {
          speaker: 0,
          transcript: "Since Tuesday.",
          words: [
            { punctuated_word: "Since", confidence: 0.93 },
            { punctuated_word: "Tuesday.", confidence: 0.35 },
          ],
        },
      ],
    },
  }

  process.env.DEEPGRAM_API_KEY = "dg-test-key"
  globalThis.fetch = (async () => new Response(JSON.stringify(deepgramResponse), { status: 200 })) as typeof fetch

  try {
    const result = await transcribeWavBufferDetailed(Buffer.from([1, 2, 3]), "clip.wav", { diarize: true })

    assert.equal(result.text, "Speaker 0: Chest pain. Since Tuesday.")
    const sliced = result.words.map((span) => result.text.slice(span.start, span.end))
    assert.deepEqual(sliced, ["Chest", "pain.", "Since", "Tuesday."])
  } finally {
    process.env.DEEPGRAM_API_KEY = originalKey
    globalThis.fetch = originalFetch
  }
})

test("repeated words get distinct spans rather than all matching the first", async () => {
  const originalKey = process.env.DEEPGRAM_API_KEY
  const originalFetch = globalThis.fetch

  const deepgramResponse = {
    results: {
      channels: [{ alternatives: [{ transcript: "No no not really." }] }],
      utterances: [
        {
          speaker: 0,
          transcript: "No no not really.",
          words: [
            { punctuated_word: "No", confidence: 0.9 },
            { punctuated_word: "no", confidence: 0.5 },
            { punctuated_word: "not", confidence: 0.8 },
            { punctuated_word: "really.", confidence: 0.7 },
          ],
        },
      ],
    },
  }

  process.env.DEEPGRAM_API_KEY = "dg-test-key"
  globalThis.fetch = (async () => new Response(JSON.stringify(deepgramResponse), { status: 200 })) as typeof fetch

  try {
    const result = await transcribeWavBufferDetailed(Buffer.from([1, 2, 3]), "clip.wav", { diarize: true })

    const starts = result.words.map((span) => span.start)
    assert.equal(new Set(starts).size, 4, "each word should occupy its own offset")
    // "not" must not be matched inside the preceding "no" — the boundary check.
    assert.deepEqual(
      result.words.map((span) => result.text.slice(span.start, span.end)),
      ["No", "no", "not", "really."],
    )
  } finally {
    process.env.DEEPGRAM_API_KEY = originalKey
    globalThis.fetch = originalFetch
  }
})

test("words rewritten by smart_format are skipped rather than mis-marked", async () => {
  const originalKey = process.env.DEEPGRAM_API_KEY
  const originalFetch = globalThis.fetch

  // smart_format renders "eight" as "8" in the transcript; the raw word never
  // appears, so it must be dropped instead of attaching to unrelated text.
  const deepgramResponse = {
    results: {
      channels: [{ alternatives: [{ transcript: "Take 8 tablets." }] }],
      utterances: [
        {
          speaker: 0,
          transcript: "Take 8 tablets.",
          words: [
            { punctuated_word: "Take", confidence: 0.99 },
            { punctuated_word: "eight", confidence: 0.4 },
            { punctuated_word: "tablets.", confidence: 0.95 },
          ],
        },
      ],
    },
  }

  process.env.DEEPGRAM_API_KEY = "dg-test-key"
  globalThis.fetch = (async () => new Response(JSON.stringify(deepgramResponse), { status: 200 })) as typeof fetch

  try {
    const result = await transcribeWavBufferDetailed(Buffer.from([1, 2, 3]), "clip.wav", { diarize: true })

    assert.deepEqual(
      result.words.map((span) => result.text.slice(span.start, span.end)),
      ["Take", "tablets."],
    )
  } finally {
    process.env.DEEPGRAM_API_KEY = originalKey
    globalThis.fetch = originalFetch
  }
})

test("a non-diarized response still yields word spans", async () => {
  const originalKey = process.env.DEEPGRAM_API_KEY
  const originalFetch = globalThis.fetch

  const deepgramResponse = {
    results: {
      channels: [
        {
          alternatives: [
            {
              transcript: "Blood pressure is fine.",
              words: [
                { punctuated_word: "Blood", confidence: 0.99 },
                { punctuated_word: "pressure", confidence: 0.45 },
                { punctuated_word: "is", confidence: 0.98 },
                { punctuated_word: "fine.", confidence: 0.97 },
              ],
            },
          ],
        },
      ],
    },
  }

  process.env.DEEPGRAM_API_KEY = "dg-test-key"
  globalThis.fetch = (async () => new Response(JSON.stringify(deepgramResponse), { status: 200 })) as typeof fetch

  try {
    const result = await transcribeWavBufferDetailed(Buffer.from([1, 2, 3]), "clip.wav", { diarize: false })

    assert.equal(result.text, "Blood pressure is fine.")
    assert.deepEqual(
      result.words.map((span) => result.text.slice(span.start, span.end)),
      ["Blood", "pressure", "is", "fine."],
    )
  } finally {
    process.env.DEEPGRAM_API_KEY = originalKey
    globalThis.fetch = originalFetch
  }
})
