"use client"

import { Skeleton } from "@ui/lib/ui/skeleton"

/**
 * Placeholder for the clinical note while it drafts.
 *
 * It borrows SectionedNote's own shape — the four SOAP headings, each over a
 * few lines — so the structure lands before the words do and the real note
 * fades in over the same layout. The line widths are a plausible note: a
 * fuller Subjective, a one-line Objective and Assessment, a three-point Plan.
 */

const SECTIONS: Array<{ title: string; lines: number[] }> = [
  { title: "Subjective", lines: [96, 88, 42] },
  { title: "Objective", lines: [58] },
  { title: "Assessment", lines: [64] },
  { title: "Plan", lines: [72, 66, 80] },
]

export function NoteSkeleton() {
  return (
    <div className="[&>*+*]:mt-8" role="status" aria-label="Drafting the clinical note">
      {SECTIONS.map((section, index) => (
        <section key={section.title} className="animate-rise" style={{ animationDelay: `${index * 60}ms` }}>
          <h2 className="mb-3 border-b border-border pb-2 font-display text-xl font-medium tracking-tight text-muted-foreground">
            {section.title}
          </h2>
          <div className="space-y-2.5">
            {section.lines.map((width, lineIndex) => (
              <Skeleton key={lineIndex} className="h-3" style={{ width: `${width}%` }} />
            ))}
          </div>
        </section>
      ))}
      <span className="sr-only">Drafting the clinical note…</span>
    </div>
  )
}
