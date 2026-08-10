import assert from "node:assert/strict"
import test from "node:test"
import {
  isLowConfidence,
  lowConfidenceRangesFor,
  parseDiarizedTranscript,
  type TranscriptWordSpan,
} from "../transcript.js"

test("parseDiarizedTranscript records the source offset of each turn's text", () => {
  const raw = "Speaker 0: Hello there.\nSpeaker 1: Hi doctor."
  const turns = parseDiarizedTranscript(raw)

  assert.ok(turns)
  assert.equal(turns.length, 2)

  // Each segment's offset must slice the exact text back out of the source.
  for (const turn of turns) {
    for (const segment of turn.segments ?? []) {
      assert.equal(raw.slice(segment.sourceStart, segment.sourceStart + segment.text.length), segment.text)
    }
  }

  assert.equal(turns[0].text, "Hello there.")
  assert.equal(turns[1].text, "Hi doctor.")
  assert.equal(turns[1].segments?.[0].sourceStart, raw.indexOf("Hi doctor."))
})

test("parseDiarizedTranscript returns null for a transcript with no speaker labels", () => {
  assert.equal(parseDiarizedTranscript("Just some prose with no labels."), null)
})

test("parseDiarizedTranscript folds unlabelled lines into the previous turn, keeping offsets", () => {
  const raw = "Speaker 0: First part\ncontinued here\nSpeaker 1: Second"
  const turns = parseDiarizedTranscript(raw)

  assert.ok(turns)
  assert.equal(turns.length, 2)
  assert.equal(turns[0].text, "First part continued here")
  assert.equal(turns[0].segments?.length, 2)
  assert.equal(turns[0].segments?.[1].sourceStart, raw.indexOf("continued here"))
})

test("lowConfidenceRangesFor maps source spans onto the turn's own text", () => {
  const raw = "Speaker 0: Take ramipril daily.\nSpeaker 1: Understood."
  const turns = parseDiarizedTranscript(raw)
  assert.ok(turns)

  const drugStart = raw.indexOf("ramipril")
  const spans: TranscriptWordSpan[] = [
    { start: raw.indexOf("Take"), end: raw.indexOf("Take") + 4, confidence: 0.99 },
    { start: drugStart, end: drugStart + "ramipril".length, confidence: 0.31 },
  ]

  const ranges = lowConfidenceRangesFor(turns[0], spans, 0.6)

  // Only the low-confidence word is returned, and it slices correctly out of
  // the turn text — not the source string it came from.
  assert.equal(ranges.length, 1)
  assert.equal(turns[0].text.slice(ranges[0].start, ranges[0].end), "ramipril")
  assert.equal(ranges[0].confidence, 0.31)
})

test("lowConfidenceRangesFor maps spans across a folded continuation line", () => {
  const raw = "Speaker 0: First part\ncontinued amoxicillin here"
  const turns = parseDiarizedTranscript(raw)
  assert.ok(turns)

  const drugStart = raw.indexOf("amoxicillin")
  const ranges = lowConfidenceRangesFor(
    turns[0],
    [{ start: drugStart, end: drugStart + "amoxicillin".length, confidence: 0.4 }],
    0.6,
  )

  assert.equal(ranges.length, 1)
  assert.equal(turns[0].text.slice(ranges[0].start, ranges[0].end), "amoxicillin")
})

test("lowConfidenceRangesFor ignores spans belonging to other turns", () => {
  const raw = "Speaker 0: Hello there.\nSpeaker 1: Hi doctor."
  const turns = parseDiarizedTranscript(raw)
  assert.ok(turns)

  const otherTurnWord = raw.indexOf("doctor")
  const spans: TranscriptWordSpan[] = [
    { start: otherTurnWord, end: otherTurnWord + "doctor".length, confidence: 0.2 },
  ]

  assert.deepEqual(lowConfidenceRangesFor(turns[0], spans, 0.6), [])
  assert.equal(lowConfidenceRangesFor(turns[1], spans, 0.6).length, 1)
})

test("lowConfidenceRangesFor returns nothing for turns built without segments", () => {
  const spans: TranscriptWordSpan[] = [{ start: 0, end: 4, confidence: 0.1 }]
  assert.deepEqual(lowConfidenceRangesFor({ speaker: 0, text: "Some text" }, spans, 0.6), [])
})

test("isLowConfidence honours the threshold boundary", () => {
  assert.equal(isLowConfidence({ start: 0, end: 1, confidence: 0.59 }, 0.6), true)
  assert.equal(isLowConfidence({ start: 0, end: 1, confidence: 0.6 }, 0.6), false)
})
