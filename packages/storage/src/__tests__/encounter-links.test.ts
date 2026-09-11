import assert from "node:assert/strict"
import test from "node:test"
import { createEncounter, isLinkedToPatient } from "../encounters.js"

/**
 * A consultation may be recorded for a patient who is not on the register
 * (the start dialog's "Unregistered patient"). The one representation of
 * that is an empty patient_id; these tests pin that convention down so
 * lists, the workspace's back link and the note header keep agreeing on it.
 */

test("createEncounter without a patient is unlinked", () => {
  const untied = createEncounter({ visit_reason: "Walk-in" })
  assert.equal(untied.patient_id, "", "no patient means an empty patient_id")
  assert.equal(untied.patient_name, "", "no patient means an empty patient_name")
  assert.equal(isLinkedToPatient(untied), false)
})

test("createEncounter with a patient is linked", () => {
  const tied = createEncounter({ patient_id: "p-2c9d41ae", patient_name: "Derek Heath" })
  assert.equal(tied.patient_id, "p-2c9d41ae")
  assert.equal(isLinkedToPatient(tied), true)
})

test("isLinkedToPatient treats whitespace as no patient", () => {
  assert.equal(isLinkedToPatient({ patient_id: "   " }), false)
  assert.equal(isLinkedToPatient({ patient_id: "" }), false)
})
