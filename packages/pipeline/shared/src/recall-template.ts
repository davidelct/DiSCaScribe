/**
 * The stimulated-recall template: its questions, its scales, and the row
 * migration between its versions. Pure, so the render package's session
 * model and the archive restorer share one definition and the rules get
 * node tests.
 */

/** A rating as given: a number on the numeric scales, an anchor's label on the verbal ones. */
export type Rating = number | string

/**
 * The verbal anchor sets a session can be on. The template changes between
 * pilots and a session stays wholly on the set it was rated on, so the set
 * is named, stored with the session and written into the export.
 * - "2026-09": Olga Kostopoulou's anchors (September 2026), the first
 *   verbal set trialled; four for likelihood and difficulty, five for
 *   support, the support scale running from against to for.
 * - "2026-10": SR_TemplateV6 as Olga revised it (October 2026): five for
 *   support, from "practically rejected" (added on 13 October, after the
 *   first cut had no "against" end) to "practically confirmed", five for
 *   likelihood. The template gives no difficulty scale; the September
 *   anchors are kept for it.
 */
export type AnchorSet = "2026-09" | "2026-10"

/** The set a new session starts on: the current template's. */
export const CURRENT_ANCHOR_SET: AnchorSet = "2026-10"

export interface VerbalAnchors {
  likelihood: readonly string[]
  support: readonly string[]
  difficulty: readonly string[]
}

const DIFFICULTY_ANCHORS = ["Very straightforward", "Somewhat straightforward", "Moderately difficult", "Very difficult"] as const

/** Every set's anchors, each scale's in ascending order. Stored and exported as written here. */
export const VERBAL_ANCHOR_SETS: Record<AnchorSet, VerbalAnchors> = {
  "2026-09": {
    likelihood: ["Unlikely", "Somewhat unlikely", "Somewhat likely", "Very likely"],
    support: ["Rejects", "Reduces the chance", "No change", "Increases the chance", "Confirms"],
    difficulty: DIFFICULTY_ANCHORS,
  },
  "2026-10": {
    likelihood: ["Unlikely", "Somewhat likely", "Likely", "Highly likely", "Almost certain"],
    support: ["Practically rejected", "Did not support", "Somewhat supported", "Strongly supported", "Practically confirmed"],
    difficulty: DIFFICULTY_ANCHORS,
  },
}

export function isAnchorSet(value: unknown): value is AnchorSet {
  return value === "2026-09" || value === "2026-10"
}

/**
 * Which way a support rating points: against the hypothesis (−1), neither
 * (0), or for it (1). Numbers by sign; the labels of either set by where
 * they sit. A label from neither set is neutral.
 */
const SUPPORT_DIRECTIONS: Record<string, -1 | 0 | 1> = {
  Rejects: -1,
  "Reduces the chance": -1,
  "No change": 0,
  "Increases the chance": 1,
  Confirms: 1,
  "Practically rejected": -1,
  "Did not support": 0,
  "Somewhat supported": 1,
  "Strongly supported": 1,
  "Practically confirmed": 1,
}

export function supportDirection(value: Rating): -1 | 0 | 1 {
  if (typeof value === "number") return value > 0 ? 1 : value < 0 ? -1 : 0
  return SUPPORT_DIRECTIONS[value] ?? 0
}

/**
 * The template's wording, as shown on screen and written into the export so
 * the dataset names the questions its rows answer. The rating questions
 * are asked once per hypothesis; "Hypothesis N" stands for its number.
 */
export const RECALL_TEMPLATE = {
  name: "SR_TemplateV6 (October 2026 revision)",
  /** What the screen says; the interviewer explains the rest aloud. */
  instruction: "Please highlight important information",
  hypothesis: "In relation to what hypothesis (or hypotheses) was this information important?",
  support: "How much did this information support Hypothesis N?",
  likelihood: "How likely did Hypothesis N become at that stage?",
  notes: "Notes",
  /** The two questions every row answered before V6; kept for rows carried over from those sessions. */
  legacyV5: {
    why: "Why did you ask this question / these questions? Did you have specific hypotheses in mind?",
    told: "What did the answer(s) tell you? Did it/they suggest specific hypotheses?",
  },
} as const

/** A per-hypothesis question with its number filled in: "… support Hypothesis 2?". */
export function hypothesisQuestion(question: string, number: number): string {
  return question.replace("Hypothesis N", `Hypothesis ${number}`)
}

/** The letter the template gives the n-th hypothesis's rating question: 2a, 2b, 2c… */
export function hypothesisLetter(number: number): string {
  return String.fromCharCode(96 + number)
}

/**
 * A row of the template before V6 (session versions 4 and 5): the two
 * questions answered in prose, the two ratings, notes per row.
 */
export interface TemplateRowV5 {
  id: string
  why: string
  told: string
  likelihood: Rating | null
  support: Rating | null
  notes: string
}

/**
 * A row of SR_TemplateV6 (session version 6): a hypothesis and its two
 * ratings; notes are kept once per stop. A row carried over from an
 * earlier session keeps the answers it gave to that template's two
 * questions, as typed, under `legacy`: they answered different questions,
 * so they are not folded into the hypothesis box, and the attribution
 * survives a re-export.
 */
export interface TemplateRowV6 {
  id: string
  hypothesis: string
  support: Rating | null
  likelihood: Rating | null
  legacy?: { why: string; told: string }
}

/** Non-empty pieces of free text as one block, in the order given. */
export function joinText(...parts: (string | undefined)[]): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join("\n")
}

/** Whether a stored row is already in the V6 shape. */
export function isTemplateRowV6(row: unknown): row is TemplateRowV6 {
  return typeof row === "object" && row !== null && "hypothesis" in row
}

/**
 * A V5 row as a V6 row: the ratings and id as they were, the two answers
 * kept whole under `legacy` (always present on a carried-over row, even
 * when empty, so one is recognisable per row), and no hypothesis yet. Its
 * notes move to the stop (see templateEntryV6From). A row already in the
 * V6 shape is returned as is.
 */
export function templateRowV6From(row: TemplateRowV5 | TemplateRowV6): TemplateRowV6 {
  if (isTemplateRowV6(row)) return row
  return {
    id: row.id,
    hypothesis: "",
    support: row.support,
    likelihood: row.likelihood,
    legacy: { why: row.why ?? "", told: row.told ?? "" },
  }
}

/**
 * A stop's rows as V6 rows, with its notes gathered into one block: notes
 * the stop already held first, then each V5 row's notes, prefixed with the
 * row's number when more than one piece has to share the block so nothing
 * loses its attribution.
 */
export function templateEntryV6From(
  rows: Array<TemplateRowV5 | TemplateRowV6>,
  entryNotes?: string,
): { rows: TemplateRowV6[]; notes: string } {
  const rowNotes = rows
    .map((row, index) => ({ number: index + 1, text: isTemplateRowV6(row) ? "" : (row.notes ?? "").trim() }))
    .filter((note) => note.text)
  const own = entryNotes?.trim() ?? ""
  const pieces = rowNotes.length === 1 && !own ? [rowNotes[0].text] : rowNotes.map((note) => `Hypothesis ${note.number}: ${note.text}`)
  return { rows: rows.map(templateRowV6From), notes: joinText(own, ...pieces) }
}
