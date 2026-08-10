import assert from "node:assert/strict"
import test from "node:test"
import {
  DEFAULT_KEYTERMS,
  KEYTERM_TOKEN_BUDGET,
  estimateKeytermTokens,
  formatKeyterms,
  parseKeyterms,
  resolveKeyterms,
  validateKeyterms,
} from "../keyterms.js"

test("parseKeyterms takes one term per line and drops blanks", () => {
  assert.deepEqual(parseKeyterms("ramipril\n\n  amoxicillin  \n\nECG\n"), ["ramipril", "amoxicillin", "ECG"])
})

test("parseKeyterms strips legacy keywords intensifiers", () => {
  // Deepgram does not reject `term:2` on Nova-3 — it treats the whole string as
  // a literal keyterm, which silently does nothing useful.
  assert.deepEqual(parseKeyterms("ramipril:2\namoxicillin:0.15\nECG"), ["ramipril", "amoxicillin", "ECG"])
})

test("parseKeyterms keeps a colon that is part of the term itself", () => {
  assert.deepEqual(parseKeyterms("ratio: 2 to 1"), ["ratio: 2 to 1"])
})

test("parseKeyterms collapses duplicates case-insensitively, keeping the first spelling", () => {
  assert.deepEqual(parseKeyterms("ECG\necg\nRamipril\nramipril"), ["ECG", "Ramipril"])
})

test("parseKeyterms preserves multi-word terms", () => {
  assert.deepEqual(parseKeyterms("blood pressure\nchest X-ray"), ["blood pressure", "chest X-ray"])
})

test("parseKeyterms handles CRLF line endings from an uploaded file", () => {
  assert.deepEqual(parseKeyterms("ramipril\r\namoxicillin\r\n"), ["ramipril", "amoxicillin"])
})

test("formatKeyterms round-trips through parseKeyterms", () => {
  const terms = ["blood pressure", "amoxicillin", "chest X-ray"]
  assert.deepEqual(parseKeyterms(formatKeyterms(terms)), terms)
})

test("resolveKeyterms falls back to the default list only when unset", () => {
  assert.deepEqual(resolveKeyterms(undefined), [...DEFAULT_KEYTERMS])
  assert.deepEqual(resolveKeyterms(["ramipril"]), ["ramipril"])
  // An explicit empty override means "send none", not "use the default".
  assert.deepEqual(resolveKeyterms([]), [])
})

test("the default list fits the budget", () => {
  const validation = validateKeyterms([...DEFAULT_KEYTERMS])
  assert.equal(validation.ok, true, `default list is ${validation.tokens} tokens`)
})

test("the default list excludes vocabulary that would seed a study case", () => {
  // Prompting the transcriber with a diagnosis puts it into the pipeline before
  // the clinician reasons to it, which is exactly what the study measures.
  const forbidden = ["aortic stenosis", "echocardiogram", "angina", "GTN", "urinary tract infection", "nitrofurantoin", "trimethoprim"]
  const lowered = DEFAULT_KEYTERMS.map((term) => term.toLowerCase())
  for (const term of forbidden) {
    assert.ok(!lowered.includes(term.toLowerCase()), `default list must not contain "${term}"`)
  }
})

test("validateKeyterms rejects a list over budget", () => {
  const huge = Array.from({ length: 400 }, (_, i) => `verylongclinicalterm${i}`)
  const validation = validateKeyterms(huge)
  assert.equal(validation.ok, false)
  assert.ok(validation.tokens > KEYTERM_TOKEN_BUDGET)
  assert.match(validation.error ?? "", /over the/)
})

test("estimateKeytermTokens counts every word of a multi-word term", () => {
  assert.ok(estimateKeytermTokens(["blood pressure"]) > estimateKeytermTokens(["blood"]))
  assert.equal(estimateKeytermTokens([]), 0)
})
