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

test("keyterms are sent as repeated keyterm params, URL-encoded", async () => {
  const originalKey = process.env.DEEPGRAM_API_KEY
  const originalFetch = globalThis.fetch

  process.env.DEEPGRAM_API_KEY = "dg-test-key"
  let capturedUrl = ""
  globalThis.fetch = (async (url) => {
    capturedUrl = String(url)
    return new Response(
      JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "ok" }] }] } }),
      { status: 200 },
    )
  }) as typeof fetch

  try {
    await transcribeWavBuffer(Buffer.from([1, 2, 3]), "clip.wav", {
      keyterms: ["amoxicillin", "blood pressure", "  ", "chest X-ray"],
    })

    const params = new URL(capturedUrl).searchParams
    // Repeated rather than delimited, so each term is processed individually,
    // and the blank entry is dropped rather than sent as an empty keyterm.
    assert.deepEqual(params.getAll("keyterm"), ["amoxicillin", "blood pressure", "chest X-ray"])
    // Multi-word terms must survive encoding intact.
    assert.match(capturedUrl, /keyterm=blood\+pressure|keyterm=blood%20pressure/)
  } finally {
    process.env.DEEPGRAM_API_KEY = originalKey
    globalThis.fetch = originalFetch
  }
})

test("no keyterm param is sent when the vocabulary is empty", async () => {
  const originalKey = process.env.DEEPGRAM_API_KEY
  const originalFetch = globalThis.fetch

  process.env.DEEPGRAM_API_KEY = "dg-test-key"
  let capturedUrl = ""
  globalThis.fetch = (async (url) => {
    capturedUrl = String(url)
    return new Response(
      JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "ok" }] }] } }),
      { status: 200 },
    )
  }) as typeof fetch

  try {
    await transcribeWavBuffer(Buffer.from([1, 2, 3]), "clip.wav", { keyterms: [] })
    assert.equal(new URL(capturedUrl).searchParams.has("keyterm"), false)
  } finally {
    process.env.DEEPGRAM_API_KEY = originalKey
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// Speaker turns cut at word-level speaker changes.
// ---------------------------------------------------------------------------

/** A Deepgram word with the fields the turn cutter reads. */
function spokenWord(punctuated: string, speaker: number, confidence = 0.99) {
  return { word: punctuated.replace(/[^A-Za-z0-9']/g, "").toLowerCase(), punctuated_word: punctuated, confidence, speaker }
}

function stubDeepgram(response: unknown): () => void {
  const originalKey = process.env.DEEPGRAM_API_KEY
  const originalFetch = globalThis.fetch
  process.env.DEEPGRAM_API_KEY = "dg-test-key"
  globalThis.fetch = (async () => new Response(JSON.stringify(response), { status: 200 })) as typeof fetch
  return () => {
    process.env.DEEPGRAM_API_KEY = originalKey
    globalThis.fetch = originalFetch
  }
}

test("diarization pins a diarizer with diarize_model, not the deprecated diarize flag", async () => {
  const originalKey = process.env.DEEPGRAM_API_KEY
  const originalDiarizeModel = process.env.DEEPGRAM_DIARIZE_MODEL
  const originalFetch = globalThis.fetch

  process.env.DEEPGRAM_API_KEY = "dg-test-key"
  delete process.env.DEEPGRAM_DIARIZE_MODEL
  let capturedUrl = ""
  globalThis.fetch = (async (url) => {
    capturedUrl = String(url)
    return new Response(
      JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "ok" }] }] } }),
      { status: 200 },
    )
  }) as typeof fetch

  try {
    await transcribeWavBuffer(Buffer.from([1, 2, 3]), "clip.wav", { diarize: true })
    let params = new URL(capturedUrl).searchParams
    assert.equal(params.get("diarize_model"), "v2")
    // `diarize=true` always routes to the v1 diarizer, and Deepgram rejects a
    // request carrying both parameters.
    assert.equal(params.has("diarize"), false)
    assert.equal(params.get("utterances"), "true")

    process.env.DEEPGRAM_DIARIZE_MODEL = "latest"
    await transcribeWavBuffer(Buffer.from([1, 2, 3]), "clip.wav", { diarize: true })
    assert.equal(new URL(capturedUrl).searchParams.get("diarize_model"), "latest")

    await transcribeWavBuffer(Buffer.from([1, 2, 3]), "clip.wav", { diarize: false })
    params = new URL(capturedUrl).searchParams
    assert.equal(params.has("diarize_model"), false)
    assert.equal(params.has("utterances"), false)
  } finally {
    process.env.DEEPGRAM_API_KEY = originalKey
    if (originalDiarizeModel === undefined) delete process.env.DEEPGRAM_DIARIZE_MODEL
    else process.env.DEEPGRAM_DIARIZE_MODEL = originalDiarizeModel
    globalThis.fetch = originalFetch
  }
})

test("a speaker change inside an utterance starts a new turn at that word", async () => {
  // Deepgram labelled both utterances speaker 0, but the words say the patient
  // answered inside the first and opened the second — the "Yes." glued onto the
  // question that the utterance label hides.
  const restore = stubDeepgram({
    results: {
      channels: [{ alternatives: [{ transcript: "Is it miss Claire Morgan? That's right. Yeah. How can I help?" }] }],
      utterances: [
        {
          speaker: 0,
          transcript: "Is it miss Claire Morgan? That's right.",
          words: [
            spokenWord("Is", 0),
            spokenWord("it", 0),
            spokenWord("miss", 0),
            spokenWord("Claire", 0, 0.9),
            spokenWord("Morgan?", 0, 0.95),
            spokenWord("That's", 1, 0.97),
            spokenWord("right.", 1, 0.5),
          ],
        },
        {
          speaker: 0,
          transcript: "Yeah. How can I help?",
          words: [spokenWord("Yeah.", 1, 0.9), spokenWord("How", 0), spokenWord("can", 0), spokenWord("I", 0), spokenWord("help?", 0)],
        },
      ],
    },
  })

  try {
    const result = await transcribeWavBufferDetailed(Buffer.from([1, 2, 3]), "clip.wav", { diarize: true })

    // "Yeah." is a one-word turn with its own punctuation: a real answer, kept,
    // and joined to the patient's previous words across the utterance boundary.
    assert.equal(result.text, "Speaker 0: Is it miss Claire Morgan?\nSpeaker 1: That's right. Yeah.\nSpeaker 0: How can I help?")

    // Spans follow the words to their new lines.
    assert.deepEqual(
      result.words.map((span) => result.text.slice(span.start, span.end)),
      ["Is", "it", "miss", "Claire", "Morgan?", "That's", "right.", "Yeah.", "How", "can", "I", "help?"],
    )
    const uncertain = result.words.filter((span) => span.confidence < 0.6)
    assert.deepEqual(
      uncertain.map((span) => result.text.slice(span.start, span.end)),
      ["right."],
    )
  } finally {
    restore()
  }
})

test("a short unpunctuated run between two speakers is folded into the sentence it opens", async () => {
  // The diarizer gave "Have you" to a third speaker label at speaker_confidence
  // 0.00 before handing the rest of the question to the clinician. The turn
  // before it ended a sentence, so the fragment belongs to what follows.
  const restore = stubDeepgram({
    results: {
      channels: [{ alternatives: [{ transcript: "It's built up over five months. Have you ever seen this before?" }] }],
      utterances: [
        {
          speaker: 1,
          transcript: "It's built up over five months.",
          words: ["It's", "built", "up", "over", "five", "months."].map((word) => spokenWord(word, 1)),
        },
        {
          speaker: 0,
          transcript: "Have you ever seen this before?",
          words: [
            spokenWord("Have", 2),
            spokenWord("you", 2),
            spokenWord("ever", 0),
            spokenWord("seen", 0),
            spokenWord("this", 0),
            spokenWord("before?", 0),
          ],
        },
      ],
    },
  })

  try {
    const result = await transcribeWavBufferDetailed(Buffer.from([1, 2, 3]), "clip.wav", { diarize: true })
    assert.equal(result.text, "Speaker 1: It's built up over five months.\nSpeaker 0: Have you ever seen this before?")
    assert.deepEqual(
      result.words.map((span) => result.text.slice(span.start, span.end)),
      ["It's", "built", "up", "over", "five", "months.", "Have", "you", "ever", "seen", "this", "before?"],
    )
  } finally {
    restore()
  }
})

test("a short unpunctuated run inside a sentence is folded back into it", async () => {
  const restore = stubDeepgram({
    results: {
      channels: [{ alternatives: [{ transcript: "I was thinking about it later." }] }],
      utterances: [
        {
          speaker: 0,
          transcript: "I was thinking about it later.",
          words: [
            spokenWord("I", 0),
            spokenWord("was", 0),
            spokenWord("thinking", 0),
            spokenWord("about", 1),
            spokenWord("it", 0),
            spokenWord("later.", 0),
          ],
        },
      ],
    },
  })

  try {
    const result = await transcribeWavBufferDetailed(Buffer.from([1, 2, 3]), "clip.wav", { diarize: true })
    assert.equal(result.text, "Speaker 0: I was thinking about it later.")
    assert.equal(result.words.length, 6)
  } finally {
    restore()
  }
})

test("a longer interjection keeps its speaker even without punctuation", async () => {
  // Four unpunctuated words is past the jitter threshold: an interruption the
  // transcript should show, not smooth away.
  const restore = stubDeepgram({
    results: {
      channels: [{ alternatives: [{ transcript: "So the tablets sorry can I just say are working." }] }],
      utterances: [
        {
          speaker: 0,
          transcript: "So the tablets sorry can I just say are working.",
          words: [
            spokenWord("So", 0),
            spokenWord("the", 0),
            spokenWord("tablets", 0),
            spokenWord("sorry", 1),
            spokenWord("can", 1),
            spokenWord("I", 1),
            spokenWord("just", 1),
            spokenWord("say", 1),
            spokenWord("are", 0),
            spokenWord("working.", 0),
          ],
        },
      ],
    },
  })

  try {
    const result = await transcribeWavBufferDetailed(Buffer.from([1, 2, 3]), "clip.wav", { diarize: true })
    assert.equal(result.text, "Speaker 0: So the tablets\nSpeaker 1: sorry can I just say\nSpeaker 0: are working.")
  } finally {
    restore()
  }
})
