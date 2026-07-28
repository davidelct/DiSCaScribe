import assert from "node:assert/strict"
import test from "node:test"
import { PATIENTS, searchPatients, getPatient, formatNhsNumber } from "../patients.js"

/**
 * Patient register search tests: a text query against one chosen field
 * (name / NHS number / date of birth) plus an optional sex filter.
 */

const names = (criteria: Parameters<typeof searchPatients>[0]) =>
  searchPatients(criteria).map((p) => p.family_name)

test("empty criteria return the whole register", () => {
  assert.deepEqual(searchPatients({}), PATIENTS)
  assert.deepEqual(searchPatients({ query: "   " }), PATIENTS)
})

test("name search is case-insensitive and spans the full name", () => {
  assert.deepEqual(names({ query: "derek" }), ["Heath"])
  assert.deepEqual(names({ query: "HEATH", field: "name" }), ["Heath"])
  assert.deepEqual(names({ query: "derek heath", field: "name" }), ["Heath"])
  assert.deepEqual(names({ query: "march", field: "name" }), ["Marchant"])
})

test("NHS number search tolerates the 3-3-4 display grouping", () => {
  assert.deepEqual(names({ query: "9990001014", field: "nhs_number" }), ["Heath"])
  assert.deepEqual(names({ query: "999 000 2010", field: "nhs_number" }), ["Marchant"])
  assert.deepEqual(names({ query: "1014", field: "nhs_number" }), ["Heath"])
  assert.deepEqual(names({ query: "999", field: "nhs_number" }), ["Heath", "Marchant", "Latimer"])
  assert.deepEqual(names({ query: "abc", field: "nhs_number" }), [])
})

test("date of birth matches common formats and prefixes", () => {
  assert.deepEqual(names({ query: "1957-09-15", field: "date_of_birth" }), ["Heath"])
  assert.deepEqual(names({ query: "15/09/1957", field: "date_of_birth" }), ["Heath"])
  assert.deepEqual(names({ query: "15/09", field: "date_of_birth" }), ["Heath"])
  assert.deepEqual(names({ query: "1966", field: "date_of_birth" }), ["Latimer"])
  assert.deepEqual(names({ query: "sep 1957", field: "date_of_birth" }), ["Heath"])
})

test("sex filter restricts results and composes with the query", () => {
  assert.deepEqual(names({ sex: "male" }), ["Heath", "Marchant"])
  assert.deepEqual(names({ sex: "female" }), ["Latimer"])
  assert.deepEqual(names({ query: "19", field: "date_of_birth", sex: "male" }), ["Heath", "Marchant"])
  assert.deepEqual(names({ query: "kelly", sex: "male" }), [])
})

test("register ids are opaque and resolvable", () => {
  for (const patient of PATIENTS) {
    // Opaque: the id must not leak name fragments.
    const id = patient.id.toLowerCase()
    assert.ok(!id.includes(patient.given_name.toLowerCase()), `id leaks given name: ${patient.id}`)
    assert.ok(!id.includes(patient.family_name.toLowerCase()), `id leaks family name: ${patient.id}`)
    assert.equal(getPatient(patient.id), patient)
  }
})

test("formatNhsNumber renders the 3-3-4 grouping", () => {
  assert.equal(formatNhsNumber("9990001014"), "999 000 1014")
  assert.equal(formatNhsNumber("not-a-number"), "not-a-number")
})
