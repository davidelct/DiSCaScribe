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
 * Beside the blood tests sits the imaging catalogue (the study's list of
 * November 2026): radiology by modality, then the cardiology, respiratory
 * and neurophysiology investigations requested the same way. Its notes
 * ("mostly restricted", "often a referral") stay off the screen likewise.
 * A request records which of the two it came from as its kind.
 *
 * Blood tests are kept on the consultation with their clinical indication,
 * the brief free-text justification a GP system asks for with a batch of
 * requests; imaging with its request form (clinical details, question,
 * urgency and the safety questions a radiology request asks), one form for
 * the imaging requested. Both are archived to its container as test_requests.json, which
 * archive recovery reads back.
 */

/** Names the catalogue a request was made from, written into the archive. */
export const TEST_CATALOGUE_VERSION = "2026-11"

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

/** Which catalogue a request came from. */
export type RequestKind = "blood" | "imaging"

/** The blood tests. */
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
 * Imaging and the other investigations requested like it. Within a group a
 * test is named by what is examined ("Chest" under "Plain X-ray"), so a
 * request reads with its group.
 */
export const IMAGING_CATALOGUE: CatalogueGroup[] = [
  {
    name: "Plain X-ray",
    tests: [
      { id: "xr-chest", name: "Chest", aliases: ["cxr", "xr", "xray"] },
      { id: "xr-abdomen", name: "Abdomen", aliases: ["axr", "xr", "xray"] },
      { id: "xr-cervical-spine", name: "Cervical spine", aliases: ["c-spine", "neck", "xr", "xray"] },
      { id: "xr-thoracic-spine", name: "Thoracic spine", aliases: ["t-spine", "xr", "xray"] },
      { id: "xr-lumbar-spine", name: "Lumbar spine", aliases: ["l-spine", "back", "xr", "xray"] },
      { id: "xr-pelvis-hips", name: "Pelvis / hips", aliases: ["hip", "xr", "xray"] },
      { id: "xr-shoulder", name: "Shoulder", aliases: ["upper limb", "xr", "xray"] },
      { id: "xr-elbow", name: "Elbow", aliases: ["upper limb", "xr", "xray"] },
      { id: "xr-wrist", name: "Wrist", aliases: ["upper limb", "xr", "xray"] },
      { id: "xr-hand", name: "Hand", aliases: ["upper limb", "xr", "xray"] },
      { id: "xr-knee", name: "Knee", aliases: ["lower limb", "xr", "xray"] },
      { id: "xr-ankle", name: "Ankle", aliases: ["lower limb", "xr", "xray"] },
      { id: "xr-foot", name: "Foot", aliases: ["lower limb", "xr", "xray"] },
      { id: "xr-skull-sinuses", name: "Skull / sinuses", aliases: ["xr", "xray"] },
    ],
  },
  {
    name: "Ultrasound",
    tests: [
      { id: "us-abdomen", name: "Abdomen", aliases: ["uss", "liver", "gallbladder"] },
      { id: "us-pelvis", name: "Pelvis", aliases: ["uss"] },
      { id: "us-kub", name: "Kidneys, ureters and bladder (KUB)", aliases: ["uss", "renal", "urinary tract"] },
      { id: "us-thyroid-neck", name: "Thyroid / neck", aliases: ["uss"] },
      { id: "us-scrotum", name: "Scrotum", aliases: ["uss", "testicular", "testes"] },
      { id: "us-soft-tissue-lump", name: "Soft tissue lump", aliases: ["uss"] },
      { id: "us-doppler-upper-limb", name: "Doppler upper limb", aliases: ["uss", "dvt", "arm"] },
      { id: "us-doppler-lower-limb", name: "Doppler lower limb", aliases: ["uss", "dvt", "leg"] },
      { id: "us-msk", name: "MSK (shoulder / joints)", aliases: ["uss", "musculoskeletal"] },
      { id: "us-transvaginal", name: "Transvaginal", aliases: ["uss", "tvus", "tvs"] },
    ],
  },
  {
    name: "CT",
    tests: [
      { id: "ct-head", name: "Head", aliases: ["brain"] },
      { id: "ct-chest", name: "Chest", aliases: ["thorax"] },
      { id: "ct-abdomen-pelvis", name: "Abdomen / pelvis", aliases: ["ctap"] },
    ],
  },
  {
    name: "MRI",
    tests: [
      { id: "mri-knee", name: "Knee" },
      { id: "mri-shoulder", name: "Shoulder" },
      { id: "mri-lumbar-spine", name: "Lumbar spine", aliases: ["l-spine", "back"] },
      { id: "mri-brain", name: "Brain", aliases: ["head"] },
    ],
  },
  {
    name: "DEXA and fluoroscopy",
    tests: [
      { id: "dexa", name: "DEXA", aliases: ["dxa", "bone density", "osteoporosis"] },
      { id: "barium-swallow", name: "Barium swallow" },
    ],
  },
  {
    name: "Cardiology",
    tests: [
      { id: "ecg", name: "ECG", aliases: ["electrocardiogram"] },
      { id: "tape-24h", name: "24-hour tape", aliases: ["holter", "ambulatory ecg", "24h"] },
      { id: "tape-48h", name: "48-hour tape", aliases: ["holter", "ambulatory ecg", "48h"] },
      { id: "tape-7d", name: "7-day tape", aliases: ["holter", "ambulatory ecg"] },
      { id: "event-recorder", name: "Event recorder" },
      { id: "echo", name: "Echocardiogram", aliases: ["echo"] },
      { id: "abpm", name: "ABPM", aliases: ["ambulatory blood pressure monitoring", "24h bp"] },
    ],
  },
  {
    name: "Respiratory",
    tests: [
      { id: "spirometry", name: "Spirometry", aliases: ["lung function", "pft"] },
      { id: "feno", name: "FeNO", aliases: ["exhaled nitric oxide"] },
      { id: "sleep-study", name: "Sleep study", aliases: ["osa", "apnoea"] },
    ],
  },
  {
    name: "Neurophysiology and other",
    tests: [
      { id: "emg", name: "EMG", aliases: ["electromyography", "nerve conduction"] },
      { id: "eeg", name: "EEG", aliases: ["electroencephalogram"] },
      { id: "urodynamics", name: "Urodynamics" },
    ],
  },
]

/** One side of the request screen: a catalogue and the kind its requests carry. */
export interface CatalogueSection {
  kind: RequestKind
  label: string
  groups: CatalogueGroup[]
}

/** Everything that can be requested, in the order it is laid out and recorded. */
export const REQUEST_CATALOGUE: CatalogueSection[] = [
  { kind: "blood", label: "Blood tests", groups: TEST_CATALOGUE },
  { kind: "imaging", label: "Imaging", groups: IMAGING_CATALOGUE },
]

/**
 * One requested test. Name and group are copied from the catalogue at the
 * time of the request, so the record reads the same if the catalogue changes.
 */
export interface TestRequest {
  id: string
  name: string
  group: string
  /** Absent on requests made before imaging could be requested, which are blood tests. */
  kind?: RequestKind
  /** ISO 8601 timestamp of when the test was first ticked and saved. */
  requested_at: string
}

/** Which catalogue a request came from; one without a kind is a blood test. */
export function requestKind(request: TestRequest): RequestKind {
  return request.kind ?? "blood"
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
 * The requests for the ticked ids, in catalogue order, blood tests first. A test that was
 * already requested keeps its first request time; a newly ticked one is
 * stamped `now`. Ids no longer in the catalogue but already requested are
 * kept as they were, so an old request is never dropped by a catalogue edit.
 */
export function applyTestSelection(
  current: TestRequest[],
  selectedIds: Iterable<string>,
  now: string,
  sections: CatalogueSection[] = REQUEST_CATALOGUE,
): TestRequest[] {
  const selected = new Set(selectedIds)
  const previous = new Map(current.map((request) => [request.id, request]))
  const known = new Set<string>()
  const next: TestRequest[] = []
  for (const section of sections) {
    for (const group of section.groups) {
      for (const test of group.tests) {
        known.add(test.id)
        if (!selected.has(test.id)) continue
        next.push(
          previous.get(test.id) ?? {
            id: test.id,
            name: test.name,
            group: group.name,
            kind: section.kind,
            requested_at: now,
          },
        )
      }
    }
  }
  for (const request of current) {
    if (!known.has(request.id) && selected.has(request.id)) next.push(request)
  }
  return next
}

export type ImagingUrgency = "routine" | "urgent" | "2ww"

export const IMAGING_URGENCIES: Array<{ value: ImagingUrgency; label: string }> = [
  { value: "routine", label: "Routine" },
  { value: "urgent", label: "Urgent" },
  { value: "2ww", label: "2WW / suspected cancer" },
]

/** "" until the clinician answers. */
export type PregnancyStatus = "" | "not_applicable" | "not_pregnant" | "pregnant" | "possibly_pregnant"

export const PREGNANCY_STATUSES: Array<{ value: Exclude<PregnancyStatus, "">; label: string }> = [
  { value: "not_applicable", label: "Not applicable" },
  { value: "not_pregnant", label: "Not pregnant" },
  { value: "pregnant", label: "Pregnant" },
  { value: "possibly_pregnant", label: "Possibly pregnant" },
]

/**
 * The request form that goes with the imaging requested: what a radiology
 * request asks the clinician. Demographics and the requesting clinician are
 * left out, being filled in by the system rather than typed. Only the
 * clinical details are mandatory; free text is kept as typed, trimmed.
 */
export interface ImagingRequestForm {
  clinical_details: string
  clinical_question: string
  urgency: ImagingUrgency
  /** Relevant bloods, such as eGFR before contrast. */
  relevant_bloods: string
  pregnancy_status: PregnancyStatus
  mobility: string
  allergies: string
  /** Implants or a pacemaker (MRI safety). */
  implants: string
}

export function emptyImagingForm(): ImagingRequestForm {
  return {
    clinical_details: "",
    clinical_question: "",
    urgency: "routine",
    relevant_bloods: "",
    pregnancy_status: "",
    mobility: "",
    allergies: "",
    implants: "",
  }
}

/** An imaging request form from outside (a request body, an archive), tidied; null when it is not one. */
export function parseImagingForm(value: unknown): ImagingRequestForm | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const form = value as Record<string, unknown>
  const text = (field: unknown) => (typeof field === "string" ? field.trim() : "")
  return {
    clinical_details: text(form.clinical_details),
    clinical_question: text(form.clinical_question),
    urgency: IMAGING_URGENCIES.find((urgency) => urgency.value === form.urgency)?.value ?? "routine",
    relevant_bloods: text(form.relevant_bloods),
    pregnancy_status: PREGNANCY_STATUSES.find((status) => status.value === form.pregnancy_status)?.value ?? "",
    mobility: text(form.mobility),
    allergies: text(form.allergies),
    implants: text(form.implants),
  }
}

/** test_requests.json as it lands in the consultation's container. */
export interface ArchivedTestRequests {
  schema_version: 1
  encounter_id: string
  catalogue_version: string
  updated_at: string
  /** The clinician's justification for the requests, as typed; "" when none was given. */
  clinical_indication: string
  /** The request form for the imaging among the tests; null when no imaging is requested. */
  imaging_request: ImagingRequestForm | null
  tests: TestRequest[]
}

export function buildTestRequestsArchive(
  encounterId: string,
  tests: TestRequest[],
  updatedAt: string,
  clinicalIndication = "",
  imagingForm: ImagingRequestForm | null = null,
): ArchivedTestRequests {
  return {
    schema_version: 1,
    encounter_id: encounterId,
    catalogue_version: TEST_CATALOGUE_VERSION,
    updated_at: updatedAt,
    clinical_indication: clinicalIndication,
    imaging_request: imagingForm,
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
    (request.kind === undefined || request.kind === "blood" || request.kind === "imaging") &&
    typeof request.requested_at === "string"
  )
}

/** The well-formed requests in a list from outside (a request body, an archive); null when it is not a list. */
export function parseTestRequests(value: unknown): TestRequest[] | null {
  if (!Array.isArray(value)) return null
  return value
    .filter(isTestRequest)
    .map(({ id, name, group, kind, requested_at }) => ({ id, name, group, ...(kind ? { kind } : {}), requested_at }))
}

/** A clinical indication from outside (a request body, an archive), trimmed; "" when it is not text. */
export function parseClinicalIndication(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/** The clinical indication in an archived test_requests.json; "" when there is none (as in archives written before it was asked for). */
export function clinicalIndicationFromArchive(value: unknown): string {
  if (!value || typeof value !== "object") return ""
  const archived = value as Record<string, unknown>
  return archived.schema_version === 1 ? parseClinicalIndication(archived.clinical_indication) : ""
}

/** The imaging request form in an archived test_requests.json; null when there is none. */
export function imagingFormFromArchive(value: unknown): ImagingRequestForm | null {
  if (!value || typeof value !== "object") return null
  const archived = value as Record<string, unknown>
  return archived.schema_version === 1 ? parseImagingForm(archived.imaging_request) : null
}

/** The requests in an archived test_requests.json; null when it is not one. */
export function testRequestsFromArchive(value: unknown): TestRequest[] | null {
  if (!value || typeof value !== "object") return null
  const archived = value as Record<string, unknown>
  if (archived.schema_version !== 1) return null
  return parseTestRequests(archived.tests)
}
