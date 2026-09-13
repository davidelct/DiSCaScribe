"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Plus, X } from "lucide-react"
import { cn } from "@ui/lib/utils"
import {
  LIKELIHOOD_RANGE,
  SUPPORT_RANGE,
  type FinalDiagnosisRow,
  type RecallEntry,
  type RecallHypothesis,
  type RecallRating,
} from "./recall-session"

/**
 * One stop of the recall interview as a card: the turns it is about, then
 * the template's table — Why, Reason for asking a question, Hypothesis,
 * Likelihood, Information support — one row per hypothesis, and Notes.
 * Only the active card takes input; the others read as text so the column
 * stays quiet.
 */

const CARD = "rounded-2xl border bg-card shadow-soft"
const LABEL = "text-xs text-muted-foreground"
const TEXT_INPUT =
  "w-full rounded-md border border-input bg-card px-2 py-1.5 text-[13px] leading-[18px] text-foreground " +
  "placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
/** A table cell that reads as text until it is hovered or focused. */
const CELL_INPUT =
  "w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[13px] leading-[18px] text-foreground " +
  "placeholder:text-muted-foreground/70 hover:border-input focus-visible:border-primary focus-visible:outline-none"
const TH = "pb-1.5 pr-3 text-left align-bottom text-xs font-medium text-muted-foreground"
const TD = "py-1 pr-3 align-top text-[13px] leading-[18px] text-foreground"

function formatSupport(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0"
}

function supportClass(value: number): string {
  return value > 0 ? "text-success" : value < 0 ? "text-amber-700" : "text-muted-foreground"
}

/** A one-line textarea that grows with its text, so a short answer stays short. */
function AutoTextarea({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = "0px"
    element.style.height = `${element.scrollHeight + 2}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={label}
      className={cn(className ?? TEXT_INPUT, "resize-none")}
    />
  )
}

/**
 * An integer field for the scales. A null value with a carried-over number
 * shows that number as a dashed placeholder: the table inherited it, the
 * clinician has not re-rated it here.
 */
function NumberField({
  value,
  carried = null,
  min,
  max,
  onChange,
  label,
}: {
  value: number | null
  carried?: number | null
  min: number
  max: number
  onChange: (value: number | null) => void
  label: string
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value))
  useEffect(() => {
    setDraft(value === null ? "" : String(value))
  }, [value])
  const inherited = value === null && carried !== null
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      value={draft}
      placeholder={carried === null ? "" : String(carried)}
      aria-label={label}
      onChange={(event) => {
        const next = event.target.value
        setDraft(next)
        if (next.trim() === "") {
          onChange(null)
          return
        }
        const parsed = Number(next)
        if (Number.isInteger(parsed) && parsed >= min && parsed <= max) onChange(parsed)
      }}
      onBlur={() => {
        if (draft.trim() === "") return
        const parsed = Math.round(Number(draft))
        if (!Number.isFinite(parsed)) {
          setDraft(value === null ? "" : String(value))
          return
        }
        const clamped = Math.min(max, Math.max(min, parsed))
        setDraft(String(clamped))
        if (clamped !== value) onChange(clamped)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
      }}
      className={cn(
        "h-[30px] w-12 rounded-md border bg-card text-center font-mono text-[13px] font-semibold text-foreground",
        "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
        "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        inherited ? "border-dashed border-input placeholder:text-muted-foreground" : "border-input",
      )}
    />
  )
}

export interface EntryExcerptLine {
  label: string
  text: string
}

/** One row of the table: a hypothesis at this entry, with what the previous table carried. */
export interface EntryRow {
  hypothesis: RecallHypothesis
  why: string
  reason: string
  /** As reported at this entry, or null when carried. */
  likelihood: number | null
  /** What the previous table had; what a null likelihood means. */
  carried: number | null
  support: number | null
}

interface RecallEntryCardProps {
  number: number
  entry: RecallEntry
  excerpt: EntryExcerptLine[]
  rows: EntryRow[]
  active: boolean
  onActivate: () => void
  onChange: (patch: Partial<Pick<RecallEntry, "notes">>) => void
  onRate: (hypothesisId: string, patch: Partial<RecallRating>) => void
  onAddHypothesis: (name: string) => void
  onRemoveHypothesis: (hypothesisId: string) => void
  onRemove: () => void
  cardRef: (element: HTMLElement | null) => void
}

export function RecallEntryCard({
  number,
  entry,
  excerpt,
  rows,
  active,
  onActivate,
  onChange,
  onRate,
  onAddHypothesis,
  onRemoveHypothesis,
  onRemove,
  cardRef,
}: RecallEntryCardProps) {
  const [newHypothesis, setNewHypothesis] = useState("")

  const submitHypothesis = () => {
    const name = newHypothesis.trim()
    if (!name) return
    onAddHypothesis(name)
    setNewHypothesis("")
  }

  const textCell = (row: EntryRow, key: "why" | "reason", label: string, placeholder: string) =>
    active ? (
      <AutoTextarea
        value={row[key]}
        onChange={(value) => onRate(row.hypothesis.id, { [key]: value })}
        placeholder={placeholder}
        label={`${label} for ${row.hypothesis.name}`}
        className={CELL_INPUT}
      />
    ) : (
      <span className="block px-1.5 py-1">{row[key]}</span>
    )

  return (
    <article
      ref={cardRef}
      onClick={active ? undefined : onActivate}
      className={cn(CARD, "shrink-0 transition-colors", active ? "border-primary" : "cursor-pointer border-border hover:border-input")}
    >
      <header className="flex items-start gap-2.5 px-4 pb-2.5 pt-3">
        <span className="mt-px inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-primary px-1.5 font-mono text-[11px] font-semibold text-primary-foreground">
          {number}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {excerpt.map((line, index) => (
            <p key={index} className="line-clamp-2 text-[13px] leading-[19px] text-muted-foreground">
              <span className="font-semibold text-foreground/80">{line.label}:</span> {line.text}
            </p>
          ))}
        </div>
        {active && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove this entry"
            className="-mr-1 -mt-0.5 shrink-0 rounded-full p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <X className="h-3.5 w-3.5" />
            <span className="sr-only">Remove entry {number}</span>
          </button>
        )}
      </header>
      <div className="flex flex-col gap-3 border-t border-border px-4 pb-4 pt-3">
        {/* The template's table, one row per hypothesis. */}
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className={cn(TH, "w-[25%] pl-1.5")}>Why</th>
              <th className={cn(TH, "w-[28%] pl-1.5")}>Reason for asking</th>
              <th className={cn(TH, "pl-1.5")}>Hypothesis</th>
              <th className={cn(TH, "w-[80px] px-1 text-center")}>Likelihood</th>
              <th className={cn(TH, "w-[72px] pr-0 text-center")}>Support</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.hypothesis.id} className="group border-b border-border/60 last:border-b-0">
                <td className={TD}>{textCell(row, "why", "Why", "Why did you ask that?")}</td>
                <td className={TD}>{textCell(row, "reason", "Reason", "What were you thinking?")}</td>
                <td className={cn(TD, "text-sm")}>
                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1.5 py-1">
                    {row.hypothesis.name}
                    {active && (
                      <button
                        type="button"
                        onClick={() => onRemoveHypothesis(row.hypothesis.id)}
                        title={`Remove ${row.hypothesis.name} from every table`}
                        className="rounded-full p-0.5 text-muted-foreground/0 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:text-muted-foreground/60 focus-visible:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        <X className="h-3 w-3" />
                        <span className="sr-only">Remove {row.hypothesis.name}</span>
                      </button>
                    )}
                  </span>
                </td>
                <td className={cn(TD, "px-1 text-center")}>
                  {active ? (
                    <span className="inline-flex flex-col items-center gap-0.5">
                      <NumberField
                        value={row.likelihood}
                        carried={row.carried}
                        min={LIKELIHOOD_RANGE.min}
                        max={LIKELIHOOD_RANGE.max}
                        onChange={(likelihood) => onRate(row.hypothesis.id, { likelihood })}
                        label={`Likelihood of ${row.hypothesis.name}`}
                      />
                      {row.likelihood !== null && row.carried !== null && row.likelihood !== row.carried && (
                        <span className="font-mono text-[10px] text-muted-foreground">was {row.carried}</span>
                      )}
                    </span>
                  ) : row.likelihood !== null ? (
                    <span className="inline-block py-1 font-mono text-[13px] font-semibold">{row.likelihood}</span>
                  ) : row.carried !== null ? (
                    <span className="inline-block py-1 font-mono text-[13px] font-semibold text-muted-foreground" title="Carried over from the previous table">
                      {row.carried}
                    </span>
                  ) : null}
                </td>
                <td className={cn(TD, "pr-0 text-center")}>
                  {active ? (
                    <NumberField
                      value={row.support}
                      min={SUPPORT_RANGE.min}
                      max={SUPPORT_RANGE.max}
                      onChange={(support) => onRate(row.hypothesis.id, { support })}
                      label={`Support for ${row.hypothesis.name}`}
                    />
                  ) : row.support !== null ? (
                    <span className={cn("inline-block py-1 font-mono text-[13px] font-semibold", supportClass(row.support))}>{formatSupport(row.support)}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {active && (
          <div className="flex gap-2">
            <input
              value={newHypothesis}
              onChange={(event) => setNewHypothesis(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  submitHypothesis()
                }
              }}
              placeholder="Add a hypothesis"
              aria-label="New hypothesis"
              className={cn(TEXT_INPUT, "min-w-0 flex-1 border-dashed")}
            />
            <button
              type="button"
              onClick={submitHypothesis}
              disabled={!newHypothesis.trim()}
              aria-label="Add hypothesis"
              className="inline-flex h-[34px] w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}

        {(active || entry.notes) && (
          <div className="flex flex-col gap-0.5">
            <span className={cn(LABEL, "px-1.5")}>Notes</span>
            {active ? (
              <AutoTextarea value={entry.notes} onChange={(notes) => onChange({ notes })} placeholder="Optional" label="Notes" className={CELL_INPUT} />
            ) : (
              <p className="px-1.5 text-[13px] leading-[18px] text-foreground">{entry.notes}</p>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

interface FinalDiagnosisCardProps {
  rows: FinalDiagnosisRow[]
  onChange: (rows: FinalDiagnosisRow[]) => void
  cardRef?: (element: HTMLElement | null) => void
}

/**
 * The closing table: the diagnoses the clinician settled on, how likely,
 * why, and how difficult the case was. Always editable; a blank row waits
 * at the bottom and becomes real as soon as something is typed into it.
 */
export function FinalDiagnosisCard({ rows, onChange, cardRef }: FinalDiagnosisCardProps) {
  const blank: FinalDiagnosisRow = { id: "", diagnosis: "", likelihood: null, why: "", difficulty: "" }
  const patchRow = (row: FinalDiagnosisRow, patch: Partial<FinalDiagnosisRow>) => {
    if (row.id === "") {
      onChange([...rows, { ...blank, ...patch, id: crypto.randomUUID() }])
      return
    }
    onChange(rows.map((current) => (current.id === row.id ? { ...current, ...patch } : current)))
  }
  const removeRow = (id: string) => onChange(rows.filter((row) => row.id !== id))

  return (
    <section ref={cardRef} className={cn(CARD, "shrink-0 border-border")}>
      <div className="flex min-h-8 items-center px-5 py-3">
        <h3 className="text-sm font-semibold text-foreground">Final diagnosis</h3>
      </div>
      <div className="border-t border-border px-5 pb-4 pt-3">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className={cn(TH, "w-[30%] pl-1.5")}>Diagnosis</th>
              <th className={cn(TH, "w-[80px] px-1 text-center")}>Likelihood</th>
              <th className={cn(TH, "pl-1.5")}>Why</th>
              <th className={cn(TH, "w-[26%] pl-1.5")}>How difficult was the case?</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {[...rows, blank].map((row) => (
              <tr key={row.id || "blank"} className="border-b border-border/60 last:border-b-0">
                <td className="py-1 pr-3 align-top">
                  <AutoTextarea
                    value={row.diagnosis}
                    onChange={(diagnosis) => patchRow(row, { diagnosis })}
                    placeholder={row.id ? "" : "Add a diagnosis"}
                    label="Diagnosis"
                    className={CELL_INPUT}
                  />
                </td>
                <td className="py-1 px-1 text-center align-top">
                  <NumberField
                    value={row.likelihood}
                    min={LIKELIHOOD_RANGE.min}
                    max={LIKELIHOOD_RANGE.max}
                    onChange={(likelihood) => patchRow(row, { likelihood })}
                    label="Likelihood of the diagnosis"
                  />
                </td>
                <td className="py-1 pr-3 align-top">
                  <AutoTextarea value={row.why} onChange={(why) => patchRow(row, { why })} placeholder="" label="Why" className={CELL_INPUT} />
                </td>
                <td className="py-1 align-top">
                  <AutoTextarea
                    value={row.difficulty}
                    onChange={(difficulty) => patchRow(row, { difficulty })}
                    placeholder=""
                    label="How difficult was the case?"
                    className={CELL_INPUT}
                  />
                </td>
                <td className="py-1 pl-1.5 text-right align-top">
                  {row.id && (
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      title="Remove this diagnosis"
                      className="mt-1.5 rounded-full p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <X className="h-3 w-3" />
                      <span className="sr-only">Remove diagnosis</span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
