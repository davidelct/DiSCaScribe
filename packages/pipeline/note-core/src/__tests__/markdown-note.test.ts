import assert from "node:assert/strict"
import test from "node:test"
import {
  parseMarkdownNote,
  formatMarkdownNote,
  validateMarkdownNote,
  createEmptyMarkdownNote,
  extractMarkdownFromResponse,
  normalizeMarkdownSections,
} from "../clinical-models/markdown-note.js"

/**
 * Markdown Clinical Note Tests
 * 
 * These tests verify the markdown parsing and formatting utilities
 */

test("parseMarkdownNote extracts sections from markdown", () => {
  const markdown = `# Clinical Note

## Chief Complaint
Patient reports foot pain.

## History of Present Illness
Pain started one week ago.

## Assessment
Possible plantar fasciitis.

## Plan
Rest and ice.`

  const sections = parseMarkdownNote(markdown)

  assert.equal(sections["Chief Complaint"], "Patient reports foot pain.")
  assert.equal(sections["History of Present Illness"], "Pain started one week ago.")
  assert.equal(sections["Assessment"], "Possible plantar fasciitis.")
  assert.equal(sections["Plan"], "Rest and ice.")
})

test("parseMarkdownNote handles empty sections", () => {
  const markdown = `# Clinical Note

## Chief Complaint
Patient reports foot pain.

## History of Present Illness

## Assessment
Possible plantar fasciitis.`

  const sections = parseMarkdownNote(markdown)

  assert.equal(sections["Chief Complaint"], "Patient reports foot pain.")
  assert.equal(sections["History of Present Illness"], "")
  assert.equal(sections["Assessment"], "Possible plantar fasciitis.")
})

test("parseMarkdownNote handles multi-line content", () => {
  const markdown = `## Chief Complaint
Foot pain and swelling.
Pain is worse when walking.
Patient rates pain 7/10.`

  const sections = parseMarkdownNote(markdown)

  assert.ok(sections["Chief Complaint"].includes("Foot pain and swelling"))
  assert.ok(sections["Chief Complaint"].includes("Pain is worse when walking"))
  assert.ok(sections["Chief Complaint"].includes("Patient rates pain 7/10"))
})

test("formatMarkdownNote returns trimmed markdown", () => {
  const markdown = `  

# Clinical Note

## Chief Complaint
Test

  `

  const formatted = formatMarkdownNote(markdown)

  assert.equal(formatted, markdown.trim())
})

test("validateMarkdownNote checks for required sections", () => {
  const completeNote = `# SOAP Note

## Subjective
Test

## Objective
Test

## Assessment
Test

## Plan
Test`

  const validation = validateMarkdownNote(completeNote)

  assert.equal(validation.valid, true)
  assert.equal(validation.missingSections.length, 0)
})

test("validateMarkdownNote detects missing sections", () => {
  const incompleteNote = `# SOAP Note

## Subjective
Test

## Plan
Test`

  const validation = validateMarkdownNote(incompleteNote)

  assert.equal(validation.valid, false)
  assert.ok(validation.missingSections.includes("Objective"))
  assert.ok(validation.missingSections.includes("Assessment"))
})

test("createEmptyMarkdownNote returns template with all sections", () => {
  const emptyNote = createEmptyMarkdownNote()
  const sections = parseMarkdownNote(emptyNote)

  assert.ok("Subjective" in sections)
  assert.ok("Objective" in sections)
  assert.ok("Assessment" in sections)
  assert.ok("Plan" in sections)
})

test("extractMarkdownFromResponse removes code fences", () => {
  const withFences = "```markdown\n# Clinical Note\n\n## Chief Complaint\nTest\n```"
  const extracted = extractMarkdownFromResponse(withFences)

  assert.equal(extracted, "# Clinical Note\n\n## Chief Complaint\nTest")
})

test("extractMarkdownFromResponse handles markdown without fences", () => {
  const withoutFences = "# Clinical Note\n\n## Chief Complaint\nTest"
  const extracted = extractMarkdownFromResponse(withoutFences)

  assert.equal(extracted, withoutFences)
})

test("extractMarkdownFromResponse handles md code fence type", () => {
  const withMdFence = "```md\n# Clinical Note\n```"
  const extracted = extractMarkdownFromResponse(withMdFence)

  assert.equal(extracted, "# Clinical Note")
})

test("normalizeMarkdownSections converts abbreviations", () => {
  const markdown = `## S
Test

## O
Test

## A
Test

## P
Test`

  const normalized = normalizeMarkdownSections(markdown)

  assert.ok(normalized.includes("## Subjective"))
  assert.ok(normalized.includes("## Objective"))
  assert.ok(normalized.includes("## Assessment"))
  assert.ok(normalized.includes("## Plan"))
})

test("normalizeMarkdownSections handles various capitalizations", () => {
  const markdown = `## SUBJECTIVE
Test

## objective
Test

## PLAN
Test`

  const normalized = normalizeMarkdownSections(markdown)

  assert.ok(normalized.includes("## Subjective"))
  assert.ok(normalized.includes("## Objective"))
  assert.ok(normalized.includes("## Plan"))
})

test("parseMarkdownNote handles subsections", () => {
  const markdown = `## Subjective
### Chief Complaint
Test CC

### HPI
Test HPI`

  const sections = parseMarkdownNote(markdown)

  assert.ok(sections["Subjective"].includes("### Chief Complaint"))
  assert.ok(sections["Subjective"].includes("Test CC"))
  assert.ok(sections["Subjective"].includes("### HPI"))
  assert.ok(sections["Subjective"].includes("Test HPI"))
})
