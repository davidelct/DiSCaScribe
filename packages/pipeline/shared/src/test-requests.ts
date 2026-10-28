/**
 * The tests a clinician can request during a consultation, and their record.
 *
 * The catalogue is the study's list of tests commonly requested in primary
 * care (Vickie's list of October 2026), grouped by specialty as a GP system's
 * request screen groups them. The list is what a clinician picks from, not
 * guidance: the email's notes on when a test is appropriate ("limited
 * indications", "via acute pathways") are left off the screen, since the
 * study observes those decisions. Genetic tests are left out too, being a
 * specialist referral rather than a GP request.
 *
 * Requests are kept on the consultation and archived to its container as
 * test_requests.json, which archive recovery reads back.
 */

/** Names the catalogue a request was made from, written into the archive. */
export const TEST_CATALOGUE_VERSION = "2026-10"

export interface CatalogueTest {
  /** Stable id, stored with each request. */
  id: string
  name: string
  /** Other names a clinician might search by. */
  aliases?: string[]
}

export interface CatalogueGroup {
  name: string
  tests: CatalogueTest[]
}

export const TEST_CATALOGUE: CatalogueGroup[] = [
  {
    name: "Core biochemistry",
    tests: [
      { id: "ue-egfr", name: "U&Es / eGFR", aliases: ["renal profile", "urea", "electrolytes", "creatinine", "kidney"] },
      { id: "urine-acr", name: "Urine ACR", aliases: ["albumin creatinine ratio", "microalbumin"] },
      { id: "lft", name: "LFTs", aliases: ["liver function tests"] },
      { id: "bone-profile", name: "Bone profile (calcium, phosphate, ALP)", aliases: ["calcium"] },
      { id: "crp", name: "CRP", aliases: ["c reactive protein"] },
      { id: "magnesium", name: "Magnesium" },
      { id: "urate", name: "Urate", aliases: ["uric acid"] },
    ],
  },
  {
    name: "Haematology",
    tests: [
      { id: "fbc", name: "FBC", aliases: ["full blood count"] },
      { id: "blood-film", name: "Blood film" },
      { id: "esr", name: "ESR" },
      { id: "plasma-viscosity", name: "Plasma viscosity" },
      { id: "ferritin", name: "Ferritin", aliases: ["haematinics", "iron"] },
      { id: "b12", name: "Vitamin B12", aliases: ["haematinics"] },
      { id: "folate", name: "Folate", aliases: ["haematinics"] },
      { id: "coag-screen", name: "Coagulation screen", aliases: ["clotting", "inr"] },
      { id: "hba1c", name: "HbA1c", aliases: ["haemoglobin a1c", "diabetes"] },
    ],
  },
  {
    name: "Endocrine",
    tests: [
      { id: "tsh", name: "TSH", aliases: ["tfts", "thyroid function", "thyroid stimulating hormone"] },
      { id: "ft4", name: "Free T4", aliases: ["tfts", "thyroid function"] },
      { id: "cortisol-9am", name: "Cortisol (9am)" },
      { id: "lh", name: "LH", aliases: ["luteinising hormone"] },
      { id: "fsh", name: "FSH", aliases: ["follicle stimulating hormone"] },
      { id: "oestradiol", name: "Oestradiol" },
      { id: "prolactin", name: "Prolactin" },
      { id: "testosterone", name: "Testosterone" },
      { id: "shbg", name: "SHBG", aliases: ["sex hormone binding globulin"] },
      { id: "pth", name: "PTH", aliases: ["parathyroid hormone"] },
      { id: "vitamin-d", name: "Vitamin D" },
    ],
  },
  {
    name: "Lipids and cardiac",
    tests: [
      { id: "lipid-profile", name: "Lipid profile", aliases: ["cholesterol"] },
      { id: "nt-probnp", name: "NT-proBNP", aliases: ["bnp", "heart failure"] },
      { id: "troponin", name: "Troponin" },
    ],
  },
  {
    name: "Immunology and inflammatory",
    tests: [
      { id: "coeliac", name: "Coeliac serology (tTG-IgA with total IgA)", aliases: ["ttg", "celiac"] },
      { id: "ana", name: "ANA", aliases: ["anti-nuclear antibody", "anf"] },
      { id: "ena", name: "ENA", aliases: ["extractable nuclear antigen"] },
      { id: "rf", name: "Rheumatoid factor", aliases: ["rf"] },
      { id: "anti-ccp", name: "Anti-CCP" },
      { id: "immunoglobulins", name: "Immunoglobulins" },
      { id: "spep", name: "Serum protein electrophoresis", aliases: ["myeloma", "paraprotein"] },
      { id: "complement", name: "Complement (C3, C4)" },
      { id: "anca", name: "ANCA", aliases: ["anti-neutrophil cytoplasmic antibody"] },
    ],
  },
  {
    name: "Infection and serology",
    tests: [
      { id: "hiv", name: "HIV" },
      { id: "hep-b", name: "Hepatitis B", aliases: ["hbsag"] },
      { id: "hep-c", name: "Hepatitis C" },
      { id: "syphilis", name: "Syphilis serology" },
      { id: "cmv", name: "CMV serology", aliases: ["cytomegalovirus"] },
      { id: "ebv", name: "EBV serology", aliases: ["glandular fever", "epstein barr"] },
      { id: "chlamydia-gonorrhoea", name: "Chlamydia / gonorrhoea (swab or urine)", aliases: ["naat", "sti"] },
    ],
  },
  {
    name: "Tumour markers",
    tests: [
      { id: "psa", name: "PSA", aliases: ["prostate specific antigen"] },
      { id: "ca125", name: "CA125" },
      { id: "afp", name: "AFP", aliases: ["alpha fetoprotein"] },
    ],
  },
  {
    name: "Drug monitoring",
    tests: [
      { id: "lithium", name: "Lithium level" },
      { id: "dmard-monitoring", name: "DMARD monitoring (methotrexate, azathioprine)" },
      { id: "digoxin", name: "Digoxin level" },
      { id: "phenytoin", name: "Phenytoin level" },
    ],
  },
  {
    name: "Others",
    tests: [
      { id: "fasting-glucose", name: "Fasting glucose" },
      { id: "ogtt", name: "OGTT", aliases: ["oral glucose tolerance test"] },
      { id: "c-peptide", name: "C-peptide" },
    ],
  },
]

/**
 * One requested test. Name and group are copied from the catalogue at the
 * time of the request, so the record reads the same if the catalogue changes.
 */
export interface TestRequest {
  id: string
  name: string
  group: string
  /** ISO 8601 timestamp of when the test was first ticked and saved. */
  requested_at: string
}

/** Catalogue tests whose name, alias or group matches every word of the query. */
export function searchCatalogue(query: string, catalogue: CatalogueGroup[] = TEST_CATALOGUE): CatalogueGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return catalogue
  return catalogue
    .map((group) => ({
      ...group,
      tests: group.tests.filter((test) => {
        const haystack = [test.name, group.name, ...(test.aliases ?? [])].join(" ").toLowerCase()
        return words.every((word) => haystack.includes(word))
      }),
    }))
    .filter((group) => group.tests.length > 0)
}

/**
 * The requests for the ticked ids, in catalogue order. A test that was
 * already requested keeps its first request time; a newly ticked one is
 * stamped `now`. Ids no longer in the catalogue but already requested are
 * kept as they were, so an old request is never dropped by a catalogue edit.
 */
export function applyTestSelection(
  current: TestRequest[],
  selectedIds: Iterable<string>,
  now: string,
  catalogue: CatalogueGroup[] = TEST_CATALOGUE,
): TestRequest[] {
  const selected = new Set(selectedIds)
  const previous = new Map(current.map((request) => [request.id, request]))
  const known = new Set<string>()
  const next: TestRequest[] = []
  for (const group of catalogue) {
    for (const test of group.tests) {
      known.add(test.id)
      if (!selected.has(test.id)) continue
      next.push(previous.get(test.id) ?? { id: test.id, name: test.name, group: group.name, requested_at: now })
    }
  }
  for (const request of current) {
    if (!known.has(request.id) && selected.has(request.id)) next.push(request)
  }
  return next
}

/** test_requests.json as it lands in the consultation's container. */
export interface ArchivedTestRequests {
  schema_version: 1
  encounter_id: string
  catalogue_version: string
  updated_at: string
  tests: TestRequest[]
}

export function buildTestRequestsArchive(
  encounterId: string,
  tests: TestRequest[],
  updatedAt: string,
): ArchivedTestRequests {
  return {
    schema_version: 1,
    encounter_id: encounterId,
    catalogue_version: TEST_CATALOGUE_VERSION,
    updated_at: updatedAt,
    tests,
  }
}

function isTestRequest(value: unknown): value is TestRequest {
  if (!value || typeof value !== "object") return false
  const request = value as Record<string, unknown>
  return (
    typeof request.id === "string" &&
    typeof request.name === "string" &&
    typeof request.group === "string" &&
    typeof request.requested_at === "string"
  )
}

/** The well-formed requests in a list from outside (a request body, an archive); null when it is not a list. */
export function parseTestRequests(value: unknown): TestRequest[] | null {
  if (!Array.isArray(value)) return null
  return value.filter(isTestRequest).map(({ id, name, group, requested_at }) => ({ id, name, group, requested_at }))
}

/** The requests in an archived test_requests.json; null when it is not one. */
export function testRequestsFromArchive(value: unknown): TestRequest[] | null {
  if (!value || typeof value !== "object") return null
  const archived = value as Record<string, unknown>
  if (archived.schema_version !== 1) return null
  return parseTestRequests(archived.tests)
}
