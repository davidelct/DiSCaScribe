/**
 * The practice's patient register: the three virtual patients of the DiSCa
 * study, migrated from the retired DummyEPR's data/patients.json. These are
 * simulated patients played by actors (999-prefixed test-range NHS numbers) —
 * no real PHI.
 *
 * The register is deliberately static and baseline-only: demographics, social
 * history and historical observations. Presenting complaints, exam findings
 * and investigation results are what the clinician uncovers live during the
 * consultation — pre-seeding them would give away the reasoning the study
 * measures. Consultations filed through the app accumulate separately in
 * encounter storage (encounters.ts) keyed by patient_id.
 */

import type { Patient, PatientObservation } from "./types"

export const PATIENTS: Patient[] = [
  {
    id: "pat-derek-heath",
    nhs_number: "9990001014",
    given_name: "Derek",
    family_name: "Heath",
    date_of_birth: "1957-09-15",
    sex: "male",
    address: "14 Chapel Lane, Cardiff",
    phone: "07123 100068",
    past_history: [],
    medications: [],
    allergies: ["None known"],
    social_history:
      "Retired postman. Lives with his wife Beryl. Smokes ~20 cigarettes/day, down from 60/day (>50-year history). One can of lager most evenings; does not go to the pub. Used to play golf regularly.",
    summary:
      "68-year-old man, Caucasian. Infrequent attender — last seen in 2022 for an infected finger laceration. Long-standing heavy smoker. No chronic conditions or regular medications on record.",
  },
  {
    id: "pat-andrew-marchant",
    nhs_number: "9990002010",
    given_name: "Andrew",
    family_name: "Marchant",
    date_of_birth: "1965-11-20",
    sex: "male",
    address: "27 Foundry Road, Cardiff",
    phone: "07123 100060",
    past_history: ["Early knee osteoarthritis"],
    medications: ["Paracetamol as required", "Topical ibuprofen as required"],
    allergies: ["None known"],
    social_history:
      "Self-employed removals man (owns his own lorry). Married with two children. Drinks a couple of beers or some whisky most evenings. Non-smoker. Reports current financial and work-related stress.",
    summary:
      "60-year-old man, Caucasian. Infrequent attender — last seen a year ago with low back pain. Background of early knee osteoarthritis. Non-smoker.",
  },
  {
    id: "pat-kelly-latimer",
    nhs_number: "9990003017",
    given_name: "Kelly",
    family_name: "Latimer",
    date_of_birth: "1966-10-10",
    sex: "female",
    address: "3 Kingsway Court, Cardiff",
    phone: "07123 100059",
    past_history: [],
    medications: [],
    allergies: ["None known"],
    social_history:
      "Runs her own office-furniture company. Lives with her husband (married ~40 years). Around 10 units of alcohol per week. Post-menopausal (periods stopped age 48). Up to date with cervical screening.",
    summary:
      "59-year-old woman, Caucasian. New patient — this is her first consultation at the practice. No past medical history recorded; up to date with cervical screening.",
  },
]

export const PATIENT_OBSERVATIONS: PatientObservation[] = [
  {
    id: "obs-derek-bp-2022",
    patient_id: "pat-derek-heath",
    date: "2022-06-15",
    name: "Blood pressure",
    value: "140/78",
    unit: "mmHg",
    notes: "On record (2022)",
  },
  {
    id: "obs-derek-weight-2022",
    patient_id: "pat-derek-heath",
    date: "2022-06-15",
    name: "Weight",
    value: "93",
    unit: "kg",
    notes: "BMI 31.1 (2022)",
  },
  { id: "obs-derek-height", patient_id: "pat-derek-heath", date: "2022-06-15", name: "Height", value: "1.73", unit: "m" },
  {
    id: "obs-andrew-bp-2025",
    patient_id: "pat-andrew-marchant",
    date: "2025-07-01",
    name: "Blood pressure",
    value: "140/95",
    unit: "mmHg",
    notes: "On record (last year)",
  },
  {
    id: "obs-andrew-weight",
    patient_id: "pat-andrew-marchant",
    date: "2025-07-01",
    name: "Weight",
    value: "88",
    unit: "kg",
    notes: "BMI 30.4",
  },
  {
    id: "obs-andrew-height",
    patient_id: "pat-andrew-marchant",
    date: "2025-07-01",
    name: "Height",
    value: "1.70",
    unit: "m",
  },
  {
    id: "obs-kelly-weight",
    patient_id: "pat-kelly-latimer",
    date: "2026-07-08",
    name: "Weight",
    value: "66",
    unit: "kg",
    notes: "BMI 25.1 (registration)",
  },
  {
    id: "obs-kelly-height",
    patient_id: "pat-kelly-latimer",
    date: "2026-07-08",
    name: "Height",
    value: "1.62",
    unit: "m",
    notes: "Registration",
  },
]

export function listPatients(): Patient[] {
  return PATIENTS
}

export function getPatient(id: string): Patient | undefined {
  return PATIENTS.find((p) => p.id === id)
}

export function getPatientObservations(patientId: string): PatientObservation[] {
  return PATIENT_OBSERVATIONS.filter((o) => o.patient_id === patientId).sort((a, b) =>
    b.date.localeCompare(a.date),
  )
}

export function patientFullName(patient: Patient): string {
  return `${patient.given_name} ${patient.family_name}`
}

/** NHS number in the conventional 3-3-4 display grouping. */
export function formatNhsNumber(nhsNumber: string): string {
  const digits = nhsNumber.replace(/\D/g, "")
  if (digits.length !== 10) return nhsNumber
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
}

/** Whole years old at `at` (defaults to now). */
export function patientAge(patient: Patient, at: Date = new Date()): number {
  const dob = new Date(`${patient.date_of_birth}T00:00:00`)
  let age = at.getFullYear() - dob.getFullYear()
  const beforeBirthday =
    at.getMonth() < dob.getMonth() || (at.getMonth() === dob.getMonth() && at.getDate() < dob.getDate())
  if (beforeBirthday) age -= 1
  return age
}
