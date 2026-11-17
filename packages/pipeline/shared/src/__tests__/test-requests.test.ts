import assert from "node:assert/strict"
import test from "node:test"
import {
  IMAGING_CATALOGUE,
  REQUEST_CATALOGUE,
  TEST_CATALOGUE,
  applyTestSelection,
  buildTestRequestsArchive,
  clinicalIndicationFromArchive,
  emptyImagingForm,
  imagingFormFromArchive,
  parseImagingForm,
  parseClinicalIndication,
  parseTestRequests,
  requestKind,
  searchCatalogue,
  testRequestsFromArchive,
  type TestRequest,
} from "../test-requests.js"

test("catalogue ids are unique", () => {
  const ids = REQUEST_CATALOGUE.flatMap((section) => section.groups.flatMap((group) => group.tests.map((t) => t.id)))
  assert.equal(new Set(ids).size, ids.length)
})

test("a new selection is stamped now and laid out in catalogue order", () => {
  const next = applyTestSelection([], ["fbc", "ue-egfr"], "2026-10-27T10:00:00.000Z")
  assert.deepEqual(
    next.map((request) => [request.id, request.group, request.requested_at]),
    [
      ["ue-egfr", "Core biochemistry", "2026-10-27T10:00:00.000Z"],
      ["fbc", "Haematology", "2026-10-27T10:00:00.000Z"],
    ],
  )
})

test("a test already requested keeps its first request time; an unticked one goes", () => {
  const first = applyTestSelection([], ["fbc", "crp"], "2026-10-27T10:00:00.000Z")
  const next = applyTestSelection(first, ["fbc", "tsh"], "2026-10-27T10:05:00.000Z")
  assert.deepEqual(
    next.map((request) => [request.id, request.requested_at]),
    [
      ["fbc", "2026-10-27T10:00:00.000Z"],
      ["tsh", "2026-10-27T10:05:00.000Z"],
    ],
  )
})

test("a request whose test left the catalogue survives while it stays selected", () => {
  const retired: TestRequest = { id: "retired", name: "Old test", group: "Others", requested_at: "2026-10-01T09:00:00.000Z" }
  assert.deepEqual(applyTestSelection([retired], ["retired"], "2026-10-27T10:00:00.000Z"), [retired])
  assert.deepEqual(applyTestSelection([retired], [], "2026-10-27T10:00:00.000Z"), [])
})

test("search matches names, aliases and groups, every word", () => {
  const names = (query: string) => searchCatalogue(query).flatMap((group) => group.tests.map((t) => t.name))
  assert.deepEqual(names("tfts"), ["TSH", "Free T4"])
  assert.deepEqual(names("haematinics"), ["Ferritin", "Vitamin B12", "Folate"])
  assert.ok(names("drug level").includes("Lithium level"))
  assert.equal(searchCatalogue("").length, TEST_CATALOGUE.length)
  assert.deepEqual(names("zzz"), [])
})

test("the archive document round-trips; malformed entries are dropped", () => {
  const requests = applyTestSelection([], ["psa", "hba1c"], "2026-10-27T10:00:00.000Z")
  const archived = JSON.parse(JSON.stringify(buildTestRequestsArchive("enc-1", requests, "2026-10-27T10:01:00.000Z")))
  assert.equal(archived.catalogue_version, "2026-11")
  assert.deepEqual(testRequestsFromArchive(archived), requests)
  assert.deepEqual(parseTestRequests([requests[0], { id: "x" }, null]), [requests[0]])
  assert.equal(testRequestsFromArchive({ schema_version: 2, tests: [] }), null)
  assert.equal(parseTestRequests("nope"), null)
})

test("imaging is requested beside blood tests, laid out after them, and keeps its kind", () => {
  const next = applyTestSelection([], ["mri-knee", "xr-chest", "fbc"], "2026-11-17T10:00:00.000Z")
  assert.deepEqual(
    next.map((request) => [request.id, request.name, request.group, request.kind]),
    [
      ["fbc", "FBC", "Haematology", "blood"],
      ["xr-chest", "Chest", "Plain X-ray", "imaging"],
      ["mri-knee", "Knee", "MRI", "imaging"],
    ],
  )
  const archived = JSON.parse(JSON.stringify(buildTestRequestsArchive("enc-1", next, "2026-11-17T10:01:00.000Z")))
  assert.deepEqual(testRequestsFromArchive(archived), next)
  // A request from before imaging has no kind and is a blood test.
  const older: TestRequest = { id: "crp", name: "CRP", group: "Core biochemistry", requested_at: "2026-10-27T10:00:00.000Z" }
  assert.equal(requestKind(older), "blood")
  assert.deepEqual(parseTestRequests([older, { ...older, kind: "other" }]), [older])
  assert.deepEqual(applyTestSelection([older], ["crp", "ecg"], "2026-11-17T10:00:00.000Z").map(requestKind), ["blood", "imaging"])
})

test("imaging search knows the modality and common abbreviations", () => {
  const found = (query: string) =>
    searchCatalogue(query, IMAGING_CATALOGUE).flatMap((group) => group.tests.map((t) => `${group.name}: ${t.name}`))
  assert.deepEqual(found("cxr"), ["Plain X-ray: Chest"])
  assert.deepEqual(found("mri knee"), ["MRI: Knee"])
  assert.deepEqual(found("holter"), ["Cardiology: 24-hour tape", "Cardiology: 48-hour tape", "Cardiology: 7-day tape"])
  assert.deepEqual(found("fbc"), [])
})

test("the imaging request form is archived with the requests and read back tidied", () => {
  const requests = applyTestSelection([], ["mri-brain"], "2026-11-17T10:00:00.000Z")
  const form = {
    ...emptyImagingForm(),
    clinical_details: "New daily headache for 3 weeks, worse on waking",
    clinical_question: "?space-occupying lesion",
    urgency: "2ww" as const,
    relevant_bloods: "eGFR 82",
    pregnancy_status: "not_pregnant" as const,
    implants: "None",
  }
  const archived = JSON.parse(
    JSON.stringify(buildTestRequestsArchive("enc-1", requests, "2026-11-17T10:01:00.000Z", "", form)),
  )
  assert.deepEqual(archived.imaging_request, form)
  assert.deepEqual(imagingFormFromArchive(archived), form)
  // No imaging, no form; nor in an archive written before the form existed.
  assert.equal(buildTestRequestsArchive("enc-1", [], "2026-11-17T10:01:00.000Z").imaging_request, null)
  assert.equal(imagingFormFromArchive({ schema_version: 1, tests: [] }), null)
  // Free text is trimmed; anything unrecognised falls back to the unanswered form.
  assert.deepEqual(parseImagingForm({ clinical_details: "  knee pain ", urgency: "asap", pregnancy_status: 3 }), {
    ...emptyImagingForm(),
    clinical_details: "knee pain",
  })
  assert.equal(parseImagingForm("nope"), null)
})

test("the clinical indication is archived with the requests and read back", () => {
  const requests = applyTestSelection([], ["fbc"], "2026-11-17T10:00:00.000Z")
  const archived = JSON.parse(
    JSON.stringify(buildTestRequestsArchive("enc-1", requests, "2026-11-17T10:01:00.000Z", "Tired all the time, ?anaemia")),
  )
  assert.equal(archived.clinical_indication, "Tired all the time, ?anaemia")
  assert.equal(clinicalIndicationFromArchive(archived), "Tired all the time, ?anaemia")
  assert.deepEqual(testRequestsFromArchive(archived), requests)
  // An archive written before the indication was asked for has none.
  const { clinical_indication: _dropped, ...older } = archived
  assert.equal(clinicalIndicationFromArchive(older), "")
  assert.equal(buildTestRequestsArchive("enc-1", requests, "2026-11-17T10:01:00.000Z").clinical_indication, "")
  assert.equal(parseClinicalIndication("  chest pain \n"), "chest pain")
  assert.equal(parseClinicalIndication(42), "")
})
