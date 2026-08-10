/**
 * Clinical terminology bindings for the record.
 *
 * Codes sit *alongside* the record's own words, never instead of them. Two
 * reasons: real records are full of uncoded entries, so the uncoded path has to
 * work regardless; and this app backs a reasoning study, where a code that is
 * more specific than the text the clinician reads would quietly sharpen the
 * stimulus. "Paracetamol as required" is a medicinal product, not a 1 gram
 * tablet — coding it as the latter invents detail the record never held.
 */

/** SNOMED CT — problems, allergies, observables, and (via the UK drug extension) medicines. */
export const SNOMED_CT_SYSTEM = "http://snomed.info/sct"

/** A single terminology binding. */
export interface CodedConcept {
  /** Code system URI, e.g. SNOMED_CT_SYSTEM. */
  system: string
  /** The concept identifier. */
  code: string
  /**
   * The concept's term, for display and for auditing what was bound. Kept
   * separate from the record's own text, which may differ and stays authoritative.
   */
  display: string
}

/** A record entry: what the chart says, plus an optional code behind it. */
export interface CodedEntry {
  /** What the clinician reads. The record's own words. */
  text: string
  /** Absent is normal and must render cleanly. */
  code?: CodedConcept
}

/** Convenience for seed data and tests. */
export function coded(text: string, code: string, display: string): CodedEntry {
  return { text, code: { system: SNOMED_CT_SYSTEM, code, display } }
}

// Verhoeff dihedral-group tables. SNOMED CT identifiers carry a Verhoeff check
// digit, so a transposed or mistyped concept id fails arithmetic rather than
// silently binding a record to the wrong clinical concept.
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]

const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

/**
 * Whether a string is a well-formed SNOMED CT identifier: 6–18 digits, no
 * leading zero, and a valid Verhoeff check digit.
 *
 * This checks the identifier's arithmetic, not that the concept exists or means
 * what the display text claims — only the terminology server can answer that.
 */
export function isValidSnomedId(value: string): boolean {
  if (!/^[1-9]\d{5,17}$/.test(value)) return false

  let checksum = 0
  const digits = value.split("").reverse()
  for (let i = 0; i < digits.length; i += 1) {
    checksum = D[checksum][P[i % 8][Number(digits[i])]]
  }
  return checksum === 0
}
