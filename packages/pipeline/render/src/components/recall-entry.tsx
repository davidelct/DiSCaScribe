"use client"

import { useEffect, useState, type FormEvent } from "react"
import { X } from "lucide-react"
import { Button } from "@ui/lib/ui/button"
import { cn } from "@ui/lib/utils"
import {
  LIKELIHOOD_RANGE,
  SUPPORT_RANGE,
  type FinalDiagnosisRow,
  type RecallEntry,
  type RecallHypothesis,
} from "./recall-session"

/**
 * One stop of the recall interview as a card: the turns it is about, the
 * template's table as a summary of the rows so far, and a form below it
 * that adds a row. Clicking a row loads it into the form to change it.
 *
 * A row is what the study asks of the clinician at a question: the
 * diagnostic hypothesis, the reason for asking, how likely the hypothesis
 * seemed (0–10), and how much the answer supported it (−10..+10).
 */

const CARD = "rounded-2xl border bg-card shadow-soft"
const LABEL = "text-xs text-muted-foreground"
const BOX =
  "w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-[13px] leading-[18px] text-foreground " +
  "placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
const NUMBER_BOX =
  BOX + " h-8 w-16 px-1 text-center font-mono font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
const TH = "pb-1.5 pr-3 text-left align-bottom text-xs font-medium text-muted-foreground"
const TD = "py-1.5 pr-3 align-top text-[13px] leading-[18px] text-foreground"

function formatSupport(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0"
}

function supportClass(value: number): string {
  return value > 0 ? "text-success" : value < 0 ? "text-amber-700" : "text-muted-foreground"
}

/** Parse a scale box: empty is null, anything else is clamped to the range. */
function parseScale(raw: string, min: number, max: number): number | null {
  if (raw.trim() === "") return null
  const parsed = Math.round(Number(raw))
  if (!Number.isFinite(parsed)) return null
  return Math.min(max, Math.max(min, parsed))
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  )
}

export interface EntryExcerptLine {
  label: string
  text: string
}

/** One row of the table: a hypothesis at this entry, with what the previous table carried. */
export interface EntryRow {
  hypothesis: RecallHypothesis
  reason: string
  /** As reported at this entry, or null when carried. */
  likelihood: number | null
  /** What the previous table had; what a null likelihood means. */
  carried: number | null
  support: number | null
}

/** What the form submits. */
export interface EntryRowInput {
  name: string
  reason: string
  likelihood: number | null
  support: number | null
}

interface RecallEntryCardProps {
  number: number
  entry: RecallEntry
  excerpt: EntryExcerptLine[]
  rows: EntryRow[]
  /** The entry whose turns are ticked in the transcript. */
  open: boolean
  onOpen: () => void
  onChange: (patch: Partial<Pick<RecallEntry, "notes">>) => void
  onAddRow: (row: EntryRowInput) => void
  onSaveRow: (hypothesisId: string, row: EntryRowInput) => void
  onRemoveHypothesis: (hypothesisId: string) => void
  onRemove: () => void
  cardRef: (element: HTMLElement | null) => void
}

const EMPTY_FORM = { name: "", reason: "", likelihood: "", support: "" }

export function RecallEntryCard({
  number,
  entry,
  excerpt,
  rows,
  open,
  onOpen,
  onChange,
  onAddRow,
  onSaveRow,
  onRemoveHypothesis,
  onRemove,
  cardRef,
}: RecallEntryCardProps) {
  // Removal asks once, inline: a browser confirm() is blocked in some
  // embedded views and would leave the X doing nothing.
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  useEffect(() => {
    if (!open) setConfirmingRemove(false)
  }, [open])

  const editRow = (row: EntryRow) => {
    setEditingId(row.hypothesis.id)
    setForm({
      name: row.hypothesis.name,
      reason: row.reason,
      likelihood: row.likelihood !== null ? String(row.likelihood) : row.carried !== null ? String(row.carried) : "",
      support: row.support !== null ? String(row.support) : "",
    })
  }

  const resetForm = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const name = form.name.trim()
    if (!name) return
    const row: EntryRowInput = {
      name,
      reason: form.reason.trim(),
      likelihood: parseScale(form.likelihood, LIKELIHOOD_RANGE.min, LIKELIHOOD_RANGE.max),
      support: parseScale(form.support, SUPPORT_RANGE.min, SUPPORT_RANGE.max),
    }
    if (editingId) onSaveRow(editingId, row)
    else onAddRow(row)
    resetForm()
  }

  return (
    <article
      ref={cardRef}
      onClick={open ? undefined : onOpen}
      className={cn(CARD, "shrink-0 transition-colors", open ? "border-primary" : "cursor-pointer border-border hover:border-input")}
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
        {open && confirmingRemove && (
          <span className="-mt-0.5 flex shrink-0 items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Remove this entry?</span>
            <button
              type="button"
              onClick={onRemove}
              className="rounded-md bg-destructive px-2 py-1 font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              className="rounded-md px-2 py-1 font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              Keep
            </button>
          </span>
        )}
        {open && !confirmingRemove && (
          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            title="Remove this entry"
            className="-mr-1 -mt-0.5 shrink-0 rounded-full p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <X className="h-3.5 w-3.5" />
            <span className="sr-only">Remove entry {number}</span>
          </button>
        )}
      </header>

      <div className="flex flex-col gap-4 border-t border-border px-4 pb-4 pt-3">
        {/* The template's table: a summary of the rows so far. */}
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className={cn(TH, "w-[32%]")}>Hypothesis</th>
              <th className={TH}>Reason for asking</th>
              <th className={cn(TH, "w-[76px] text-center")}>Likelihood</th>
              <th className={cn(TH, "w-[64px] pr-0 text-center")}>Support</th>
              {open && <th className="w-6" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={open ? 5 : 4} className="py-2 text-xs text-muted-foreground">
                  No rows yet.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr
                key={row.hypothesis.id}
                onClick={open ? () => editRow(row) : undefined}
                title={open ? "Click to change this row" : undefined}
                className={cn(
                  "border-b border-border/60 last:border-b-0",
                  open && "cursor-pointer hover:bg-accent/60",
                  editingId === row.hypothesis.id && "bg-brand-soft/50",
                )}
              >
                <td className={cn(TD, "text-sm")}>{row.hypothesis.name}</td>
                <td className={TD}>{row.reason}</td>
                <td className={cn(TD, "text-center font-mono font-semibold")}>
                  {row.likelihood !== null ? (
                    row.likelihood
                  ) : row.carried !== null ? (
                    <span className="text-muted-foreground" title="Carried over from the previous table">
                      {row.carried}
                    </span>
                  ) : null}
                </td>
                <td className={cn(TD, "pr-0 text-center font-mono font-semibold", row.support !== null && supportClass(row.support))}>
                  {row.support !== null ? formatSupport(row.support) : null}
                </td>
                {open && (
                  <td className="py-1 pl-1 text-right align-top">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (editingId === row.hypothesis.id) resetForm()
                        onRemoveHypothesis(row.hypothesis.id)
                      }}
                      title={`Remove ${row.hypothesis.name} from every table`}
                      className="rounded-full p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <X className="h-3 w-3" />
                      <span className="sr-only">Remove {row.hypothesis.name}</span>
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {/* The form: how a row is added, or changed once clicked. */}
        {open && (
          <form onSubmit={submit} className="flex flex-col gap-2.5 rounded-lg border border-border bg-background p-3">
            <Field label="Diagnostic hypothesis">
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={BOX} />
            </Field>
            <Field label="Reason for asking">
              <textarea rows={2} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} className={cn(BOX, "resize-none")} />
            </Field>
            <div className="flex flex-wrap items-end gap-2.5">
              <Field label="Likelihood 0–10">
                <input
                  type="number"
                  inputMode="numeric"
                  min={LIKELIHOOD_RANGE.min}
                  max={LIKELIHOOD_RANGE.max}
                  step={1}
                  value={form.likelihood}
                  onChange={(event) => setForm({ ...form, likelihood: event.target.value })}
                  className={NUMBER_BOX}
                />
              </Field>
              <Field label="Information support −10 to +10">
                <input
                  type="number"
                  inputMode="numeric"
                  min={SUPPORT_RANGE.min}
                  max={SUPPORT_RANGE.max}
                  step={1}
                  value={form.support}
                  onChange={(event) => setForm({ ...form, support: event.target.value })}
                  className={NUMBER_BOX}
                />
              </Field>
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={!form.name.trim()} className="h-8 rounded-md px-3">
                  {editingId ? "Save row" : "Add row"}
                </Button>
                {editingId && (
                  <Button type="button" variant="ghost" size="sm" onClick={resetForm} className="h-8 rounded-md px-2">
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          </form>
        )}

        {(open || entry.notes) && (
          <Field label="Notes">
            {open ? (
              <textarea rows={2} value={entry.notes} onChange={(event) => onChange({ notes: event.target.value })} className={cn(BOX, "resize-none")} />
            ) : (
              <p className="text-[13px] leading-[18px] text-foreground">{entry.notes}</p>
            )}
          </Field>
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

const EMPTY_DIAGNOSIS = { diagnosis: "", likelihood: "", why: "", difficulty: "" }

/**
 * The closing table: the diagnoses the clinician settled on, how likely,
 * why, and how difficult the case was. Same shape as the entries: the table
 * is the summary, the form below adds a row, clicking a row changes it.
 */
export function FinalDiagnosisCard({ rows, onChange, cardRef }: FinalDiagnosisCardProps) {
  const [form, setForm] = useState(EMPTY_DIAGNOSIS)
  const [editingId, setEditingId] = useState<string | null>(null)

  const resetForm = () => {
    setEditingId(null)
    setForm(EMPTY_DIAGNOSIS)
  }
  const editRow = (row: FinalDiagnosisRow) => {
    setEditingId(row.id)
    setForm({
      diagnosis: row.diagnosis,
      likelihood: row.likelihood !== null ? String(row.likelihood) : "",
      why: row.why,
      difficulty: row.difficulty,
    })
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const diagnosis = form.diagnosis.trim()
    if (!diagnosis) return
    const values = {
      diagnosis,
      likelihood: parseScale(form.likelihood, LIKELIHOOD_RANGE.min, LIKELIHOOD_RANGE.max),
      why: form.why.trim(),
      difficulty: form.difficulty.trim(),
    }
    if (editingId) onChange(rows.map((row) => (row.id === editingId ? { ...row, ...values } : row)))
    else onChange([...rows, { id: crypto.randomUUID(), ...values }])
    resetForm()
  }
  const removeRow = (id: string) => {
    if (editingId === id) resetForm()
    onChange(rows.filter((row) => row.id !== id))
  }

  return (
    <section ref={cardRef} className={cn(CARD, "shrink-0 border-border")}>
      <div className="flex min-h-8 items-center px-5 py-3">
        <h3 className="text-sm font-semibold text-foreground">Final diagnosis</h3>
      </div>
      <div className="flex flex-col gap-4 border-t border-border px-5 pb-4 pt-3">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className={cn(TH, "w-[30%]")}>Diagnosis</th>
              <th className={cn(TH, "w-[76px] text-center")}>Likelihood</th>
              <th className={TH}>Why</th>
              <th className={cn(TH, "w-[26%]")}>How difficult was the case?</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-2 text-xs text-muted-foreground">
                  No rows yet.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => editRow(row)}
                title="Click to change this row"
                className={cn("cursor-pointer border-b border-border/60 last:border-b-0 hover:bg-accent/60", editingId === row.id && "bg-brand-soft/50")}
              >
                <td className={cn(TD, "text-sm")}>{row.diagnosis}</td>
                <td className={cn(TD, "text-center font-mono font-semibold")}>{row.likelihood ?? null}</td>
                <td className={TD}>{row.why}</td>
                <td className={TD}>{row.difficulty}</td>
                <td className="py-1 pl-1 text-right align-top">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      removeRow(row.id)
                    }}
                    title="Remove this diagnosis"
                    className="rounded-full p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <X className="h-3 w-3" />
                    <span className="sr-only">Remove diagnosis</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <form onSubmit={submit} className="flex flex-col gap-2.5 rounded-lg border border-border bg-background p-3">
          <div className="flex flex-wrap items-end gap-2.5">
            <Field label="Diagnosis" className="min-w-[200px] flex-1">
              <input value={form.diagnosis} onChange={(event) => setForm({ ...form, diagnosis: event.target.value })} className={BOX} />
            </Field>
            <Field label="Likelihood 0–10">
              <input
                type="number"
                inputMode="numeric"
                min={LIKELIHOOD_RANGE.min}
                max={LIKELIHOOD_RANGE.max}
                step={1}
                value={form.likelihood}
                onChange={(event) => setForm({ ...form, likelihood: event.target.value })}
                className={NUMBER_BOX}
              />
            </Field>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Why">
              <textarea rows={2} value={form.why} onChange={(event) => setForm({ ...form, why: event.target.value })} className={cn(BOX, "resize-none")} />
            </Field>
            <Field label="How difficult was the case?">
              <textarea rows={2} value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value })} className={cn(BOX, "resize-none")} />
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={!form.diagnosis.trim()} className="h-8 rounded-md px-3">
              {editingId ? "Save row" : "Add row"}
            </Button>
            {editingId && (
              <Button type="button" variant="ghost" size="sm" onClick={resetForm} className="h-8 rounded-md px-2">
                Cancel
              </Button>
            )}
          </div>
        </form>
      </div>
    </section>
  )
}
