import assert from "node:assert/strict"
import test from "node:test"
import {
  RECALL_TEMPLATE,
  VERBAL_ANCHOR_SETS,
  hypothesisLetter,
  hypothesisQuestion,
  supportDirection,
  templateEntryV6From,
  templateRowV6From,
  type TemplateRowV5,
  type TemplateRowV6,
} from "../recall-template.js"

test("the current anchors are Olga's October revision, and the September set is kept", () => {
  assert.deepEqual(VERBAL_ANCHOR_SETS["2026-10"].support, ["Did not support", "Somewhat supported", "Strongly supported", "Practically confirmed"])
  assert.deepEqual(VERBAL_ANCHOR_SETS["2026-10"].likelihood, ["Unlikely", "Somewhat likely", "Likely", "Highly likely", "Almost certain"])
  assert.deepEqual(VERBAL_ANCHOR_SETS["2026-09"].support, ["Rejects", "Reduces the chance", "No change", "Increases the chance", "Confirms"])
  assert.deepEqual(VERBAL_ANCHOR_SETS["2026-09"].difficulty, VERBAL_ANCHOR_SETS["2026-10"].difficulty)
})

test("supportDirection reads numbers by sign and labels from either set", () => {
  assert.equal(supportDirection(4), 1)
  assert.equal(supportDirection(-2), -1)
  assert.equal(supportDirection(0), 0)
  // September: against to for.
  assert.equal(supportDirection("Rejects"), -1)
  assert.equal(supportDirection("Reduces the chance"), -1)
  assert.equal(supportDirection("No change"), 0)
  assert.equal(supportDirection("Increases the chance"), 1)
  assert.equal(supportDirection("Confirms"), 1)
  // Current: one-directional, so nothing points against.
  assert.equal(supportDirection("Did not support"), 0)
  assert.equal(supportDirection("Somewhat supported"), 1)
  assert.equal(supportDirection("Strongly supported"), 1)
  assert.equal(supportDirection("Practically confirmed"), 1)
  assert.equal(supportDirection("Something else"), 0)
})

test("the rating questions are asked per hypothesis, lettered a, b, c", () => {
  assert.equal(hypothesisQuestion(RECALL_TEMPLATE.support, 2), "How much did this information support Hypothesis 2?")
  assert.equal(hypothesisQuestion(RECALL_TEMPLATE.likelihood, 1), "How likely did Hypothesis 1 become at that stage?")
  assert.equal(hypothesisLetter(1), "a")
  assert.equal(hypothesisLetter(3), "c")
})

const v5Rows: TemplateRowV5[] = [
  {
    id: "r-1",
    why: "Open question.",
    told: "Fatigue; perimenopause came to mind.",
    likelihood: "Somewhat unlikely",
    support: "Increases the chance",
    notes: "Revisit",
  },
  { id: "r-2", why: "", told: "", likelihood: 3, support: -4, notes: "" },
]

test("templateRowV6From keeps a V5 row's answers whole under legacy and drops its notes", () => {
  assert.deepEqual(templateRowV6From(v5Rows[0]), {
    id: "r-1",
    hypothesis: "",
    support: "Increases the chance",
    likelihood: "Somewhat unlikely",
    legacy: { why: "Open question.", told: "Fatigue; perimenopause came to mind." },
  })
  // Numbers carry over as numbers; empty answers still mark the row as carried over.
  assert.deepEqual(templateRowV6From(v5Rows[1]), {
    id: "r-2",
    hypothesis: "",
    support: -4,
    likelihood: 3,
    legacy: { why: "", told: "" },
  })
})

test("templateRowV6From leaves a V6 row alone", () => {
  const v6: TemplateRowV6 = { id: "r-3", hypothesis: "Reflux", support: "Practically confirmed", likelihood: "Likely" }
  assert.equal(templateRowV6From(v6), v6)
})

test("templateEntryV6From gathers the rows' notes into the stop's", () => {
  // One row's notes alone become the stop's notes as they were.
  assert.deepEqual(templateEntryV6From(v5Rows), {
    rows: v5Rows.map(templateRowV6From),
    notes: "Revisit",
  })
  // More than one piece keeps each one's attribution.
  const two = [v5Rows[0], { ...v5Rows[1], notes: "Check risk factors" }]
  assert.equal(templateEntryV6From(two).notes, "Hypothesis 1: Revisit\nHypothesis 2: Check risk factors")
  // Notes the stop already held come first and the rows' are attributed.
  assert.equal(templateEntryV6From(v5Rows, "Went wider").notes, "Went wider\nHypothesis 1: Revisit")
  // V6 rows pass through, with the stop's notes as given.
  const v6: TemplateRowV6 = { id: "r-3", hypothesis: "Reflux", support: null, likelihood: null }
  assert.deepEqual(templateEntryV6From([v6], " As typed "), { rows: [v6], notes: "As typed" })
  assert.deepEqual(templateEntryV6From([]), { rows: [], notes: "" })
})
