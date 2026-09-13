import assert from "node:assert/strict"
import test from "node:test"
import { guessClinicianSpeaker, heuristicRecallExchanges, sanitizeRecallExchanges } from "../recall.js"
import type { TranscriptTurn } from "../transcript.js"

const turns: TranscriptTurn[] = [
  { speaker: 0, text: "What can I do for you today?" },
  { speaker: 1, text: "I have had a cough for three weeks." },
  { speaker: 0, text: "Any fevers?" },
  { speaker: 1, text: "No." },
  { speaker: 1, text: "Well, one sweaty night." },
  { speaker: 0, text: "Let me have a listen." },
  { speaker: 1, text: "Sure." },
  { speaker: 1, text: "Is it serious?" },
  { speaker: 0, text: "Probably not." },
]

test("sanitizeRecallExchanges keeps ordered, in-range, non-overlapping pairs", () => {
  const raw = [
    { question: 2, answer_end: 4 },
    { question: 0, answer_end: 1 },
    { question: 3, answer_end: 4 }, // overlaps the first
    { question: 5, answer_end: 5 }, // not after the question
    { question: 7, answer_end: 9 }, // past the end
    { question: "1", answer_end: 2 }, // not an integer
    null,
  ]
  assert.deepEqual(sanitizeRecallExchanges(raw, turns.length), [
    { question: 0, answer_end: 1 },
    { question: 2, answer_end: 4 },
  ])
  assert.deepEqual(sanitizeRecallExchanges("nope", turns.length), [])
})

test("heuristicRecallExchanges pairs a question mark with the reply that follows", () => {
  // Without a clinician, the patient's question counts too.
  assert.deepEqual(heuristicRecallExchanges(turns), [
    { question: 0, answer_end: 1 },
    { question: 2, answer_end: 4 },
    { question: 7, answer_end: 8 },
  ])
  // With one, only the clinician's questions do.
  assert.deepEqual(heuristicRecallExchanges(turns, 0), [
    { question: 0, answer_end: 1 },
    { question: 2, answer_end: 4 },
  ])
})

test("heuristicRecallExchanges ignores a question the same speaker follows up", () => {
  assert.deepEqual(
    heuristicRecallExchanges([
      { speaker: 0, text: "Any pain?" },
      { speaker: 0, text: "Any pain at all when you breathe?" },
      { speaker: 1, text: "A little." },
    ]),
    [{ question: 1, answer_end: 2 }],
  )
})

test("guessClinicianSpeaker picks whoever asks most, and abstains on a tie", () => {
  assert.equal(guessClinicianSpeaker(turns), 0)
  assert.equal(guessClinicianSpeaker([{ speaker: 0, text: "Hi?" }, { speaker: 1, text: "Hi?" }]), undefined)
  assert.equal(guessClinicianSpeaker([{ speaker: 0, text: "Only one speaker?" }]), undefined)
})
