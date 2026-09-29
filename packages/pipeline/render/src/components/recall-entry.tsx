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
  type RecallRow,
} from "./recall-session"

/**
 * One stop of the recall interview as a card: the turns it is about, the
 * rows so far, and a form below them that adds a row (clicking a row loads
 * it into the form to change it).
 *
 * A row is what the template asks at a question: why it was asked and
 * whether hypotheses were in mind, what the answer told the clinician, how
 * likely the hypothesis seemed (0–10), how much the answer supported it
 * (−10..+10), and notes. Two of those are paragraphs, so a row is laid out
 * the way the template reads — question, answer, the ratings, notes — not
 * as a five-column table. A vague takeaway is a row with text and no numbers.
 */

const CARD = "rounded-2xl border bg-card shadow-soft"
const LABEL = "text-xs text-muted-foreground"
const BOX =
  "w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-[13px] leading-[18px] text-foreground " +
  "placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
const NUMBER_BOX =
  BOX + " h-8 w-16 px-1 text-center font-mono font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
// The final-diagnosis table below still reads as a table.
const TH = "pb-1.5 pr-3 text-left align-bottom text-xs font-medium text-muted-foreground"
const TD = "py-1.5 pr-3 align-top text-[13px] leading-[18px] text-foreground"
export const WHY_QUESTION = "Why did you ask this question / these questions? Did you have specific hypotheses in mind?"
export const TOLD_QUESTION = "What did the answer(s) tell you? Did it/they suggest specific hypotheses?"

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

/** One of the template's questions with its answer; nothing when unanswered. */
function Answer({ question, text }: { question: string; text: string }) {
  if (!text) return null
  return (
    <div className="mt-2">
      <p className="text-[11px] leading-4 text-muted-foreground">{question}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-[18px] text-foreground">{text}</p>
    </div>
  )
}

/** The row's two ratings as chips, or a note that they are still to come. */
function Ratings({ likelihood, support }: { likelihood: number | null; support: number | null }) {
  if (likelihood === null && support === null) {
    return <span className="text-[11px] text-muted-foreground">Not rated yet</span>
  }
  const chip = "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] leading-4"
  return (
    <>
      <span className={chip}>
        <span className="text-muted-foreground">Likelihood</span>
        <span className="font-mono font-semibold text-foreground">{likelihood ?? "–"}</span>
      </span>
      <span className={chip}>
        <span className="text-muted-foreground">Support</span>
        <span className={cn("font-mono font-semibold", support !== null ? supportClass(support) : "text-foreground")}>
          {support !== null ? formatSupport(support) : "–"}
        </span>
      </span>
    </>
  )
}

export interface EntryExcerptLine {
  label: string
  text: string
}

/** What the form submits: the template's fields. */
export interface EntryRowInput {
  why: string
  told: string
  likelihood: number | null
  support: number | null
  notes: string
}

interface RecallEntryCardProps {
  number: number
  entry: RecallEntry
  excerpt: EntryExcerptLine[]
  /** The entry whose turns are ticked in the transcript. */
  open: boolean
  onOpen: () => void
  onAddRow: (row: EntryRowInput) => void
  onSaveRow: (rowId: string, row: EntryRowInput) => void
  onRemoveRow: (rowId: string) => void
  onRemove: () => void
  cardRef: (element: HTMLElement | null) => void
}

const EMPTY_FORM = { why: "", told: "", likelihood: "", support: "", notes: "" }

export function RecallEntryCard({
  number,
  entry,
  excerpt,
  open,
  onOpen,
  onAddRow,
  onSaveRow,
  onRemoveRow,
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

  const editRow = (row: RecallRow) => {
    setEditingId(row.id)
    setForm({
      why: row.why,
      told: row.told,
      likelihood: row.likelihood !== null ? String(row.likelihood) : "",
      support: row.support !== null ? String(row.support) : "",
      notes: row.notes,
    })
  }

  const resetForm = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const canSubmit = Boolean(form.why.trim() || form.told.trim() || form.notes.trim())

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    const row: EntryRowInput = {
      why: form.why.trim(),
      told: form.told.trim(),
      likelihood: parseScale(form.likelihood, LIKELIHOOD_RANGE.min, LIKELIHOOD_RANGE.max),
      support: parseScale(form.support, SUPPORT_RANGE.min, SUPPORT_RANGE.max),
      notes: form.notes.trim(),
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
        {/* The rows so far, each laid out as the template reads. */}
        {entry.rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No rows yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {entry.rows.map((row, index) => (
              <li
                key={row.id}
                onClick={open ? () => editRow(row) : undefined}
                title={open ? "Click to change this row" : undefined}
                className={cn(
                  "rounded-lg border border-border/70 bg-background px-3 py-2.5",
                  open && "cursor-pointer hover:border-input",
                  editingId === row.id && "border-primary bg-brand-soft/40",
                )}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 font-mono text-[11px] font-semibold text-muted-foreground">Row {index + 1}</span>
                  <Ratings likelihood={row.likelihood} support={row.support} />
                  {open && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (editingId === row.id) resetForm()
                        onRemoveRow(row.id)
                      }}
                      title="Remove this row"
                      className="ml-auto rounded-full p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <X className="h-3 w-3" />
                      <span className="sr-only">Remove row {index + 1}</span>
                    </button>
                  )}
                </div>
                <Answer question={WHY_QUESTION} text={row.why} />
                <Answer question={TOLD_QUESTION} text={row.told} />
                <Answer question="Notes" text={row.notes} />
              </li>
            ))}
          </ol>
        )}

        {/* The form: how a row is added, or changed once clicked. */}
        {open && (
          <form onSubmit={submit} className="flex flex-col gap-2.5 rounded-lg border border-border bg-background p-3">
            <Field label={WHY_QUESTION}>
              <textarea rows={2} value={form.why} onChange={(event) => setForm({ ...form, why: event.target.value })} className={cn(BOX, "resize-none")} />
            </Field>
            <Field label={TOLD_QUESTION}>
              <textarea rows={2} value={form.told} onChange={(event) => setForm({ ...form, told: event.target.value })} className={cn(BOX, "resize-none")} />
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
            </div>
            <Field label="Notes">
              <textarea rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className={cn(BOX, "resize-none")} />
            </Field>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={!canSubmit} className="h-8 rounded-md px-3">
                {editingId ? "Save row" : "Add row"}
              </Button>
              {editingId && (
                <Button type="button" variant="ghost" size="sm" onClick={resetForm} className="h-8 rounded-md px-2">
                  Cancel
                </Button>
              )}
            </div>
          </form>
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
