import assert from "node:assert/strict"
import test from "node:test"
import {
  TEST_CATALOGUE,
  applyTestSelection,
  buildTestRequestsArchive,
  parseTestRequests,
  searchCatalogue,
  testRequestsFromArchive,
  type TestRequest,
} from "../test-requests.js"

test("catalogue ids are unique", () => {
  const ids = TEST_CATALOGUE.flatMap((group) => group.tests.map((t) => t.id))
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
  assert.equal(archived.catalogue_version, "2026-10")
  assert.deepEqual(testRequestsFromArchive(archived), requests)
  assert.deepEqual(parseTestRequests([requests[0], { id: "x" }, null]), [requests[0]])
  assert.equal(testRequestsFromArchive({ schema_version: 2, tests: [] }), null)
  assert.equal(parseTestRequests("nope"), null)
})
