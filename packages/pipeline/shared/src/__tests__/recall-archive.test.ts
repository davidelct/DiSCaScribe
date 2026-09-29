import assert from "node:assert/strict"
import test from "node:test"
import { isArchivedRecallPayload, recallSessionFromArchive } from "../recall-archive.js"

// recall_session.json as buildRecallPayload writes it: two stops, a
// hypothesis reported at the first and carried into the second.
const payload = {
  schema_version: 3,
  encounter_id: "enc-1",
  exported_at: "2026-09-23T10:40:00.000Z",
  clinician_speaker: 0,
  exchanges: { source: "model", ranges: [{ question: 2, answer_end: 3 }] },
  hypotheses: [
    { id: "h-gerd", name: "Reflux", first_reported_at_entry: 1 },
    { id: "h-ibs", name: "IBS", first_reported_at_entry: 2 },
  ],
  entries: [
    {
      number: 1,
      id: "e-1",
      turns: [{ index: 2, speaker: 0, speaker_label: "GP", text: "Any pain after meals?" }],
      is_question: true,
      notes: "",
      rows: [
        { hypothesis_id: "h-gerd", hypothesis: "Reflux", reason: "Classic trigger", likelihood: 6, likelihood_source: "reported", support: 4 },
      ],
      created_at: "2026-09-23T10:35:00.000Z",
    },
    {
      number: 2,
      id: "e-2",
      turns: [
        { index: 5, speaker: 0, speaker_label: "GP", text: "Any change in bowels?" },
        { index: 6, speaker: 1, speaker_label: "Patient", text: "A bit." },
      ],
      is_question: true,
      notes: "Went wider",
      rows: [
        { hypothesis_id: "h-gerd", hypothesis: "Reflux", reason: "", likelihood: 6, likelihood_source: "carried", support: null },
        { hypothesis_id: "h-ibs", hypothesis: "IBS", reason: "Bloating", likelihood: 3, likelihood_source: "reported", support: 2 },
      ],
      created_at: "2026-09-23T10:37:00.000Z",
    },
  ],
  final_diagnosis: [{ diagnosis: "Reflux", likelihood: 7, why: "Meal-related", difficulty: "Easy" }],
  recording: {
    started_at: "2026-09-23T10:30:00.000Z",
    stopped_at: "2026-09-23T10:39:00.000Z",
    duration_seconds: 540,
    utterance_clicks: [{ utterance: 2, audio_offset_seconds: 12.5, at: "2026-09-23T10:30:12.500Z" }],
  },
}

test("recallSessionFromArchive turns the export back into the app's session", () => {
  const session = recallSessionFromArchive(payload)
  assert.ok(session)
  assert.equal(session.version, 3)
  if (session.version !== 3) throw new Error("unreachable")
  assert.deepEqual(session.hypotheses, [
    { id: "h-gerd", name: "Reflux", entryId: "e-1" },
    { id: "h-ibs", name: "IBS", entryId: "e-2" },
  ])
  assert.deepEqual(session.entries[0], {
    id: "e-1",
    turns: [2],
    notes: "",
    ratings: { "h-gerd": { reason: "Classic trigger", likelihood: 6, support: 4 } },
    createdAt: "2026-09-23T10:35:00.000Z",
  })
  // The carried likelihood is left to be carried again, not stored as reported.
  assert.deepEqual(session.entries[1].turns, [5, 6])
  assert.deepEqual(session.entries[1].ratings, { "h-ibs": { reason: "Bloating", likelihood: 3, support: 2 } })
  assert.deepEqual(session.finalDiagnosis, [
    { id: "final-1", diagnosis: "Reflux", likelihood: 7, why: "Meal-related", difficulty: "Easy" },
  ])
  assert.deepEqual(session.timeline, {
    startedAt: "2026-09-23T10:30:00.000Z",
    stoppedAt: "2026-09-23T10:39:00.000Z",
    durationSeconds: 540,
    utteranceClicks: [{ utterance: 2, audioOffsetSeconds: 12.5, at: "2026-09-23T10:30:12.500Z" }],
  })
  assert.equal(session.recallArchivedAt, "2026-09-23T10:40:00.000Z")
})

test("a session archived before any recording is not marked archived", () => {
  const session = recallSessionFromArchive({ ...payload, recording: null })
  assert.ok(session)
  assert.equal(session.timeline, undefined)
  assert.equal(session.recallArchivedAt, undefined)
})

test("the app's own session is left alone", () => {
  const own = { version: 3, hypotheses: [], entries: [], finalDiagnosis: [] }
  assert.equal(isArchivedRecallPayload(own), false)
  assert.equal(recallSessionFromArchive(own), null)
  assert.equal(recallSessionFromArchive(null), null)
  assert.equal(isArchivedRecallPayload(payload), true)
})

test("a schema 4 export restores rows with the template's fields", () => {
  const session = recallSessionFromArchive({
    schema_version: 4,
    encounter_id: "enc-2",
    exported_at: "2026-09-28T21:00:00.000Z",
    clinician_speaker: 0,
    exchanges: { source: "heuristic", ranges: [] },
    entries: [
      {
        number: 1,
        id: "e-1",
        turns: [
          { index: 2, speaker: 0, speaker_label: "GP", text: "How can I help?" },
          { index: 3, speaker: 1, speaker_label: "Patient", text: "Tired for months." },
        ],
        is_question: true,
        rows: [
          { why: "Open question.", told: "Fatigue; perimenopause came to mind.", likelihood: 6, support: 4, notes: "" },
          { why: "Second thought.", told: "Bowel symptoms don't fit.", likelihood: null, support: null, notes: "Revisit" },
        ],
        created_at: "2026-09-28T20:50:00.000Z",
      },
    ],
    final_diagnosis: [],
    recording: null,
  })
  assert.ok(session)
  assert.equal(session.version, 4)
  if (session.version !== 4) throw new Error("unreachable")
  assert.deepEqual(session.entries[0].turns, [2, 3])
  assert.deepEqual(
    session.entries[0].rows.map(({ id: _id, ...row }) => row),
    [
      { why: "Open question.", told: "Fatigue; perimenopause came to mind.", likelihood: 6, support: 4, notes: "" },
      { why: "Second thought.", told: "Bowel symptoms don't fit.", likelihood: null, support: null, notes: "Revisit" },
    ],
  )
  assert.equal(session.entries[0].rows[0].id, "row-1-1")
  assert.equal(session.recallArchivedAt, undefined)
})
