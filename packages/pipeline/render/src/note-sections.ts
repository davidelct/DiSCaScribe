/**
 * Split a SOAP note (markdown) into its level-2 sections so the UI can offer
 * per-section actions (the demo EPR has one plain-text box per SOAP section),
 * and convert section markdown to clipboard-friendly plain text.
 */

export interface NoteSection {
  /** Section heading text, e.g. "Subjective". */
  title: string
  /** Raw markdown between this heading and the next level-2 heading. */
  body: string
}

export interface ParsedNoteSections {
  /** Markdown before the first level-2 heading (typically "# SOAP Note"). */
  preamble: string
  sections: NoteSection[]
}

const H2 = /^##\s+(.+?)\s*$/

/**
 * Parse the note into level-2 sections. Returns no sections when the note has
 * no `##` headings, so callers can fall back to rendering the note whole.
 */
export function parseNoteSections(markdown: string): ParsedNoteSections {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const sections: NoteSection[] = []
  const preamble: string[] = []
  let current: { title: string; body: string[] } | null = null

  for (const line of lines) {
    const heading = line.match(H2)
    if (heading) {
      if (current) sections.push({ title: current.title, body: current.body.join("\n").trim() })
      current = { title: heading[1], body: [] }
    } else if (current) {
      current.body.push(line)
    } else {
      preamble.push(line)
    }
  }
  if (current) sections.push({ title: current.title, body: current.body.join("\n").trim() })

  return { preamble: preamble.join("\n").trim(), sections }
}

/**
 * Reduce note markdown to plain text for pasting into plain-text EPR fields:
 * headings and inline bold/italic/code markers are stripped, bullets become
 * "- " lines, ordered-list numbering is kept, and blank runs are collapsed.
 */
export function markdownToPlainText(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const out: string[] = []

  for (const rawLine of lines) {
    let line = rawLine.trim()
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) continue // horizontal rule
    line = line.replace(/^#{1,6}\s+/, "")
    line = line.replace(/^[-*+]\s+/, "- ")
    line = line.replace(/^(\d+)[.)]\s+/, "$1. ")
    // Inline markers: bold, italic, code.
    line = line.replace(/\*\*([^*]+)\*\*/g, "$1")
    line = line.replace(/__([^_]+)__/g, "$1")
    line = line.replace(/`([^`]+)`/g, "$1")
    line = line.replace(/\*([^*\s][^*]*?)\*/g, "$1")
    out.push(line)
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
