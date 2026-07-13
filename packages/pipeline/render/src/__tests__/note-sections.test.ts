import assert from "node:assert/strict"
import test from "node:test"
import { parseNoteSections, markdownToPlainText } from "../note-sections.js"

const NOTE = `# SOAP Note

## Subjective

Patient reports **gradual breathlessness** over 6 months.

- Dizziness on exertion, weekly
- No chest pain

## Objective

BP 132/104. Soft systolic murmur radiating to the neck.

## Assessment

1. Suspected aortic valve stenosis
2. Possible COPD

## Plan

- Echocardiogram
- Spirometry
`

test("parseNoteSections splits a SOAP note into titled sections", () => {
  const { preamble, sections } = parseNoteSections(NOTE)
  assert.equal(preamble, "# SOAP Note")
  assert.deepEqual(
    sections.map((s) => s.title),
    ["Subjective", "Objective", "Assessment", "Plan"],
  )
  assert.match(sections[0].body, /gradual breathlessness/)
  assert.match(sections[3].body, /- Echocardiogram/)
})

test("parseNoteSections returns no sections for plain text", () => {
  const { preamble, sections } = parseNoteSections("Just a note without headings.")
  assert.equal(sections.length, 0)
  assert.equal(preamble, "Just a note without headings.")
})

test("parseNoteSections keeps empty sections with empty bodies", () => {
  const { sections } = parseNoteSections("## Subjective\n\n## Objective\n\nFindings here.\n")
  assert.equal(sections.length, 2)
  assert.equal(sections[0].body, "")
  assert.equal(sections[1].body, "Findings here.")
})

test("markdownToPlainText strips markers but keeps list structure", () => {
  const subjective = parseNoteSections(NOTE).sections[0]
  const plain = markdownToPlainText(subjective.body)
  assert.equal(
    plain,
    "Patient reports gradual breathlessness over 6 months.\n\n- Dizziness on exertion, weekly\n- No chest pain",
  )
})

test("markdownToPlainText keeps ordered-list numbering and strips headings/rules", () => {
  const plain = markdownToPlainText("### Title\n\n1. First *item*\n2) Second `item`\n\n---\n")
  assert.equal(plain, "Title\n\n1. First item\n2. Second item")
})
