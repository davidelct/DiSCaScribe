/**
 * Keyterm Prompting — the vocabulary handed to Deepgram to improve recognition
 * of clinical terms it would otherwise mishear.
 *
 * Nova-3 takes repeated `keyterm` query params. It is NOT the older `keywords`
 * feature: weights/intensifiers are unsupported, and Deepgram does not reject
 * `term:2` — it silently treats the whole string, colon included, as a literal
 * keyterm. parseKeyterms strips them for that reason.
 *
 * Docs: https://developers.deepgram.com/docs/keyterm
 */

/** Hard limit. Deepgram errors the whole request above this — it does not truncate. */
export const KEYTERM_TOKEN_LIMIT = 500

/**
 * Deepgram's own guidance is to stay "well under" the limit and focus on the
 * most important 20–50 terms, so we budget against a fraction of it. A list
 * that large stops being a prompt and starts being a dictionary.
 */
export const KEYTERM_TOKEN_BUDGET = 350

/**
 * Case-neutral clinical vocabulary applied to every consultation.
 *
 * The rule for this list, which matters because the app backs a reasoning
 * study: a term earns its place only if it is common across primary care
 * generally. Nothing diagnostic of a study case goes in, because prompting the
 * transcriber with the answer puts it into the pipeline before the clinician
 * has reasoned to it. Deliberately excluded for that reason: aortic stenosis,
 * echocardiogram, angina, GTN, urinary tract infection, and the antibiotics
 * specific to it.
 *
 * Generic investigations (ECG, chest X-ray) and generic examination vocabulary
 * stay in — they are ordered in most consultations and point at no diagnosis.
 */
export const DEFAULT_KEYTERMS: readonly string[] = [
  // Common primary-care medicines, where a mis-transcription changes meaning.
  "paracetamol",
  "ibuprofen",
  "amoxicillin",
  "clarithromycin",
  "amlodipine",
  "ramipril",
  "atorvastatin",
  "simvastatin",
  "bisoprolol",
  "omeprazole",
  "lansoprazole",
  "salbutamol",
  "beclometasone",
  "levothyroxine",
  "metformin",
  "gliclazide",
  "sertraline",
  "citalopram",
  "amitriptyline",
  "furosemide",
  "prednisolone",
  "clopidogrel",
  "apixaban",
  "warfarin",
  // Dose and measurement vocabulary.
  "milligrams",
  "micrograms",
  "millilitres",
  "mmHg",
  "twice daily",
  "once daily",
  // Observations and examination.
  "blood pressure",
  "respiratory rate",
  "oxygen saturation",
  "peak flow",
  "auscultation",
  "palpation",
  // Investigations and process, none of them diagnosis-specific.
  "ECG",
  "chest X-ray",
  "full blood count",
  "urea and electrolytes",
  "spirometry",
  "referral",
]

/**
 * The vocabulary actually sent for a consultation: the user's override when
 * they have set one, otherwise the committed default. An explicit empty
 * override is honoured — it means "send no keyterms" — which is why this takes
 * `undefined` rather than falling back on emptiness.
 */
export function resolveKeyterms(override?: readonly string[]): string[] {
  return override ? [...override] : [...DEFAULT_KEYTERMS]
}

/**
 * Split editor or file text into terms: one per line, blanks dropped, legacy
 * `term:weight` suffixes removed, duplicates collapsed case-insensitively
 * while keeping the first spelling and the author's ordering.
 */
export function parseKeyterms(input: string): string[] {
  const seen = new Set<string>()
  const terms: string[] = []

  for (const line of (input ?? "").split(/\r?\n/)) {
    // Drop a trailing :0.15 / :2 left over from the old keywords syntax, which
    // Deepgram would otherwise swallow into the term itself.
    const term = line.trim().replace(/:\s*\d+(?:\.\d+)?$/, "").trim()
    if (!term) continue

    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    terms.push(term)
  }

  return terms
}

/** Terms as editor text: one per line. */
export function formatKeyterms(terms: readonly string[]): string {
  return terms.join("\n")
}

/**
 * Rough token count for the budget meter. Deepgram does not expose its
 * tokenizer, so this uses the usual ~4-characters-per-token approximation and
 * rounds up per word — which over-counts long drug names slightly. Erring high
 * is the right direction: the failure mode is a rejected request mid-consult.
 */
export function estimateKeytermTokens(terms: readonly string[]): number {
  let tokens = 0
  for (const term of terms) {
    for (const word of term.split(/\s+/).filter(Boolean)) {
      tokens += Math.max(1, Math.ceil(word.length / 4))
    }
  }
  return tokens
}

export interface KeytermValidation {
  ok: boolean
  terms: string[]
  tokens: number
  budget: number
  /** Set when the list cannot be saved; written for the person editing it. */
  error?: string
}

/** Check a list against the budget so it can be rejected at edit time, not capture time. */
export function validateKeyterms(terms: readonly string[]): KeytermValidation {
  const tokens = estimateKeytermTokens(terms)
  const base = { terms: [...terms], tokens, budget: KEYTERM_TOKEN_BUDGET }

  if (tokens > KEYTERM_TOKEN_BUDGET) {
    return {
      ...base,
      ok: false,
      error:
        `This list is about ${tokens} tokens, over the ${KEYTERM_TOKEN_BUDGET} allowed. ` +
        `Remove some terms — a shorter list of the words most often misheard works better than a long one.`,
    }
  }

  return { ...base, ok: true }
}
