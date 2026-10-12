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

test("a schema 5 export restores the scales its ratings were given on", () => {
  const session = recallSessionFromArchive({
    schema_version: 5,
    encounter_id: "enc-3",
    exported_at: "2026-10-01T09:00:00.000Z",
    clinician_speaker: 0,
    exchanges: { source: "heuristic", ranges: [] },
    scales: {
      kind: "verbal",
      likelihood: ["Unlikely", "Somewhat unlikely", "Somewhat likely", "Very likely"],
      support: ["Rejects", "Reduces the chance", "No change", "Increases the chance", "Confirms"],
      difficulty: ["Very straightforward", "Somewhat straightforward", "Moderately difficult", "Very difficult"],
    },
    entries: [
      {
        number: 1,
        id: "e-1",
        turns: [{ index: 1, speaker: 0, speaker_label: "GP", text: "Any fever?" }],
        is_question: true,
        rows: [
          { why: "Rule out infection.", told: "None.", likelihood: "Somewhat unlikely", support: "Reduces the chance", notes: "" },
          { why: "Still vague.", told: "", likelihood: null, support: null, notes: "" },
        ],
        created_at: "2026-10-01T08:50:00.000Z",
      },
    ],
    final_diagnosis: [{ diagnosis: "Viral", likelihood: "Very likely", why: "Fits", difficulty: "Somewhat straightforward" }],
    recording: null,
  })
  assert.ok(session)
  assert.equal(session.version, 5)
  if (session.version !== 5) throw new Error("unreachable")
  assert.equal(session.scale, "verbal")
  assert.deepEqual(
    session.entries[0].rows.map(({ id: _id, ...row }) => row),
    [
      { why: "Rule out infection.", told: "None.", likelihood: "Somewhat unlikely", support: "Reduces the chance", notes: "" },
      { why: "Still vague.", told: "", likelihood: null, support: null, notes: "" },
    ],
  )
  assert.deepEqual(session.finalDiagnosis, [
    { id: "final-1", diagnosis: "Viral", likelihood: "Very likely", why: "Fits", difficulty: "Somewhat straightforward" },
  ])
})

test("a schema 5 export on the numeric scales keeps its numbers", () => {
  const session = recallSessionFromArchive({
    schema_version: 5,
    encounter_id: "enc-4",
    exported_at: "2026-10-01T09:00:00.000Z",
    clinician_speaker: 0,
    exchanges: { source: "heuristic", ranges: [] },
    scales: { kind: "numeric", likelihood: { min: 0, max: 10 }, support: { min: -10, max: 10 }, difficulty: "free text" },
    entries: [
      {
        number: 1,
        id: "e-1",
        turns: [{ index: 1, speaker: 0, speaker_label: "GP", text: "Any fever?" }],
        is_question: true,
        rows: [{ why: "Infection?", told: "None.", likelihood: 3, support: -4, notes: "" }],
        created_at: "2026-10-01T08:50:00.000Z",
      },
    ],
    final_diagnosis: [],
    recording: null,
  })
  assert.ok(session)
  if (session.version !== 5) throw new Error("unreachable")
  assert.equal(session.scale, "numeric")
  assert.equal(session.entries[0].rows[0].likelihood, 3)
  assert.equal(session.entries[0].rows[0].support, -4)
})

test("a schema 6 export restores hypothesis rows, the stop's notes, the anchor set and the origin version", () => {
  const session = recallSessionFromArchive({
    schema_version: 6,
    encounter_id: "enc-5",
    exported_at: "2026-10-11T09:00:00.000Z",
    template: { name: "SR_TemplateV6 (October 2026 revision)", questions: {} },
    migrated_from: 5,
    clinician_speaker: 0,
    scales: {
      kind: "verbal",
      anchor_set: "2026-09",
      likelihood: ["Unlikely", "Somewhat unlikely", "Somewhat likely", "Very likely"],
      support: ["Rejects", "Reduces the chance", "No change", "Increases the chance", "Confirms"],
      difficulty: ["Very straightforward", "Somewhat straightforward", "Moderately difficult", "Very difficult"],
    },
    entries: [
      {
        number: 1,
        id: "e-1",
        turns: [{ index: 1, speaker: 1, speaker_label: "Patient", text: "It burns after meals." }],
        rows: [
          { id: "r-1", hypothesis: "Reflux", support: "Increases the chance", likelihood: "Somewhat likely", legacy: null },
          {
            id: "r-2",
            hypothesis: "",
            support: "Confirms",
            likelihood: "Very likely",
            legacy: { why: "Open question.", told: "Meal-related burning." },
          },
        ],
        notes: "Revisit",
        created_at: "2026-10-11T08:50:00.000Z",
      },
    ],
    final_diagnosis: [{ diagnosis: "Reflux", likelihood: "Very likely", why: "Fits", difficulty: "Somewhat straightforward" }],
    recording: null,
  })
  assert.ok(session)
  assert.equal(session.version, 6)
  if (session.version !== 6) throw new Error("unreachable")
  assert.equal(session.scale, "verbal")
  assert.equal(session.anchors, "2026-09")
  assert.equal(session.migratedFrom, 5)
  assert.deepEqual(session.entries[0].turns, [1])
  assert.deepEqual(session.entries[0].rows, [
    { id: "r-1", hypothesis: "Reflux", support: "Increases the chance", likelihood: "Somewhat likely" },
    {
      id: "r-2",
      hypothesis: "",
      support: "Confirms",
      likelihood: "Very likely",
      legacy: { why: "Open question.", told: "Meal-related burning." },
    },
  ])
  assert.equal(session.entries[0].notes, "Revisit")
  assert.deepEqual(session.finalDiagnosis, [
    { id: "final-1", diagnosis: "Reflux", likelihood: "Very likely", why: "Fits", difficulty: "Somewhat straightforward" },
  ])
})

test("a schema 6 export on the current anchors, begun on this version, carries no origin", () => {
  const session = recallSessionFromArchive({
    schema_version: 6,
    encounter_id: "enc-6",
    exported_at: "2026-10-11T09:00:00.000Z",
    migrated_from: null,
    clinician_speaker: 0,
    scales: { kind: "verbal", anchor_set: "2026-10", likelihood: [], support: [], difficulty: [] },
    entries: [
      {
        number: 1,
        id: "e-1",
        turns: [{ index: 0, speaker: 0, speaker_label: "GP", text: "Any fever?" }],
        rows: [{ id: "r-1", hypothesis: "Infection", support: "Did not support", likelihood: "Unlikely", legacy: null }],
        created_at: "2026-10-11T08:50:00.000Z",
      },
    ],
    final_diagnosis: [],
    recording: null,
  })
  assert.ok(session)
  if (session.version !== 6) throw new Error("unreachable")
  assert.equal(session.anchors, "2026-10")
  assert.equal(session.migratedFrom, undefined)
  assert.equal("legacy" in session.entries[0].rows[0], false)
  assert.equal(session.entries[0].notes, "")
})

test("a schema 6 export without an anchor set, or on the numeric scales, lands on the current set", () => {
  const base = {
    schema_version: 6,
    encounter_id: "enc-7",
    exported_at: "2026-10-11T09:00:00.000Z",
    clinician_speaker: null,
    entries: [],
    final_diagnosis: [],
    recording: null,
  }
  const verbal = recallSessionFromArchive({ ...base, scales: { kind: "verbal" } })
  const numeric = recallSessionFromArchive({ ...base, scales: { kind: "numeric", likelihood: { min: 0, max: 10 } } })
  const stray = recallSessionFromArchive({ ...base, migrated_from: 6, scales: { kind: "verbal", anchor_set: "2026-10" } })
  assert.ok(verbal && numeric && stray)
  if (verbal.version !== 6 || numeric.version !== 6 || stray.version !== 6) throw new Error("unreachable")
  assert.equal(verbal.anchors, "2026-10")
  assert.equal(numeric.scale, "numeric")
  assert.equal(numeric.anchors, "2026-10")
  assert.equal(stray.migratedFrom, undefined)
})
