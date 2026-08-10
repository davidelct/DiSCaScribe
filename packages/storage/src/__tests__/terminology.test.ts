import assert from "node:assert/strict"
import test from "node:test"
import { SNOMED_CT_SYSTEM, coded, isValidSnomedId } from "../terminology.js"
import { PATIENTS, PATIENT_OBSERVATIONS } from "../patients.js"
import type { CodedConcept, CodedEntry } from "../terminology.js"

test("isValidSnomedId accepts well-formed identifiers", () => {
  for (const id of ["239873007", "716186003", "27113001", "1153637007"]) {
    assert.ok(isValidSnomedId(id), `${id} should be valid`)
  }
})

test("isValidSnomedId rejects a transposition and a wrong check digit", () => {
  // The point of the check digit: a mistyped concept id must not silently bind
  // a record to a different clinical concept.
  assert.equal(isValidSnomedId("239873070"), false, "transposition must fail")
  assert.equal(isValidSnomedId("239873008"), false, "wrong check digit must fail")
})

test("isValidSnomedId rejects malformed input", () => {
  for (const bad of ["", "12345", "0239873007", "23987300a", "  239873007  "]) {
    assert.equal(isValidSnomedId(bad), false, `${JSON.stringify(bad)} should be rejected`)
  }
})

test("coded() binds the record's own wording to a SNOMED concept", () => {
  const entry = coded("Early knee osteoarthritis", "239873007", "Osteoarthritis of knee (disorder)")
  assert.equal(entry.text, "Early knee osteoarthritis")
  assert.equal(entry.code?.system, SNOMED_CT_SYSTEM)
  assert.equal(entry.code?.code, "239873007")
})

/** Every code bound anywhere in the seeded record. */
function seededConcepts(): CodedConcept[] {
  const concepts: CodedConcept[] = []
  const fromEntries = (entries: CodedEntry[]) => {
    for (const entry of entries) if (entry.code) concepts.push(entry.code)
  }
  for (const patient of PATIENTS) {
    fromEntries(patient.past_history)
    fromEntries(patient.medications)
    fromEntries(patient.allergies)
  }
  for (const observation of PATIENT_OBSERVATIONS) {
    if (observation.code) concepts.push(observation.code)
    for (const component of observation.components ?? []) concepts.push(component.code)
  }
  return concepts
}

test("every seeded concept id is a valid SNOMED identifier", () => {
  const concepts = seededConcepts()
  assert.ok(concepts.length > 0, "expected the record to carry codes")
  for (const concept of concepts) {
    assert.equal(concept.system, SNOMED_CT_SYSTEM, `${concept.code} should be SNOMED CT`)
    assert.ok(isValidSnomedId(concept.code), `${concept.code} (${concept.display}) fails its check digit`)
    assert.ok(concept.display.trim().length > 0, `${concept.code} needs a display term`)
  }
})

test("every record entry keeps its own wording, coded or not", () => {
  for (const patient of PATIENTS) {
    for (const entry of [...patient.past_history, ...patient.medications, ...patient.allergies]) {
      assert.ok(entry.text.trim().length > 0, `${patient.id} has an entry with no text`)
    }
  }
})

test("blood pressure reads as one row but is coded as two observations", () => {
  const bp = PATIENT_OBSERVATIONS.filter((o) => o.name === "Blood pressure")
  assert.ok(bp.length > 0)
  for (const observation of bp) {
    assert.equal(observation.components?.length, 2, "expected systolic and diastolic")
    const codes = observation.components!.map((c) => c.code.code)
    assert.deepEqual(codes, ["271649006", "271650006"])
    // The displayed value must stay the single string the clinician reads.
    assert.match(observation.value, /^\d+\/\d+$/)
    const [systolic, diastolic] = observation.value.split("/")
    assert.equal(observation.components![0].value, systolic)
    assert.equal(observation.components![1].value, diastolic)
  }
})

test("medication codes stay at the granularity the record's text supports", () => {
  // "Paracetamol as required" states no dose or form, so it binds to a
  // medicinal product rather than a clinical drug — a code must never be more
  // specific than the text the clinician reads.
  const meds = PATIENTS.flatMap((p) => p.medications).filter((m) => m.code)
  assert.ok(meds.length > 0)
  for (const med of meds) {
    assert.match(
      med.code!.display,
      /\(medicinal product\)$/,
      `${med.text} is bound to "${med.code!.display}", which is more specific than the record says`,
    )
  }
})
