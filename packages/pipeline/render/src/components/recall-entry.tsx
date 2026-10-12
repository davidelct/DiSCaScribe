"use client"

import { useEffect, useId, useState, type FormEvent } from "react"
import { X } from "lucide-react"
import { Button } from "@ui/lib/ui/button"
import { cn } from "@ui/lib/utils"
import {
  RECALL_TEMPLATE,
  VERBAL_ANCHOR_SETS,
  hypothesisLetter,
  hypothesisQuestion,
  supportDirection,
  type AnchorSet,
  type Rating,
} from "@pipeline-errors"
import {
  LIKELIHOOD_RANGE,
  SUPPORT_RANGE,
  type FinalDiagnosisRow,
  type RatingScale,
  type RecallEntry,
  type RecallRow,
} from "./recall-session"

/**
 * One highlight of the recall interview as a card: the turns it is about
 * and the template's three questions, answered in place. Question 1 names
 * the hypotheses, one box each, with a fresh box appearing once the last
 * is filled; questions 2 and 3 are then asked once per named hypothesis
 * (2a, 2b…), on the session's scales: a number box on the numeric ones, a
 * row of the session's anchors on the verbal ones. Notes close the stop.
 * Every change saves as it is made. Closed, the card reads back what was
 * answered. A row carried over from the earlier template shows the answers
 * it gave then, read-only, under that template's questions.
 */

const CARD = "rounded-2xl border bg-card shadow-soft"
const LABEL = "text-xs text-muted-foreground"
const QUESTION = "text-[13px] font-medium leading-[18px] text-foreground"
const BOX =
  "w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-[13px] leading-[18px] text-foreground " +
  "placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
const NUMBER_BOX =
  BOX + " h-8 w-16 px-1 text-center font-mono font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
// The final-diagnosis table below still reads as a table.
const TH = "pb-1.5 pr-3 text-left align-bottom text-xs font-medium text-muted-foreground"
const TD = "py-1.5 pr-3 align-top text-[13px] leading-[18px] text-foreground"

/** A rating as shown: a label as given, a number as is, or signed on the support scale. */
function formatRating(value: Rating, signed = false): string {
  if (typeof value === "string") return value
  if (!signed) return String(value)
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0"
}

function supportClass(value: Rating): string {
  const direction = supportDirection(value)
  return direction > 0 ? "text-success" : direction < 0 ? "text-amber-700" : "text-muted-foreground"
}

function formatRange(range: { min: number; max: number }): string {
  const bound = (value: number) => (value > 0 && range.min < 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : String(value))
  return range.min < 0 ? `${bound(range.min)} to ${bound(range.max)}` : `${bound(range.min)}–${bound(range.max)}`
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

/**
 * A verbal scale as a row of its anchors, the chosen one filled. Choosing it
 * again clears the rating, as emptying the number box does on the numeric
 * scales. A rating given under other wording of the anchors is shown as
 * given, so it is kept until changed.
 */
function AnchorPicker({
  label,
  labelClassName,
  anchors,
  value,
  onChange,
}: {
  label: string
  labelClassName?: string
  anchors: readonly string[]
  value: Rating | null
  onChange: (value: Rating | null) => void
}) {
  const current = typeof value === "string" ? value : value === null ? "" : String(value)
  const options = current && !anchors.includes(current) ? [...anchors, current] : anchors
  return (
    <div className="flex flex-col gap-1">
      <span className={labelClassName ?? LABEL}>{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
        {options.map((anchor) => {
          const checked = anchor === current
          return (
            <button
              key={anchor}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(checked ? null : anchor)}
              className={cn(
                "rounded-md border px-2 py-1 text-xs leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
                checked
                  ? "border-primary bg-primary font-medium text-primary-foreground"
                  : "border-input bg-card text-foreground hover:border-primary/60",
              )}
            >
              {anchor}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * A number box for one of the numeric scales. What is typed stays in the
 * box while it is typed (a minus sign on its own, say); the rating behind
 * it is the number once there is one, clamped to the range, and null when
 * the box is emptied.
 */
function NumberRating({
  label,
  labelClassName,
  range,
  value,
  onChange,
}: {
  label: string
  labelClassName?: string
  range: { min: number; max: number }
  value: Rating | null
  onChange: (value: Rating | null) => void
}) {
  const shown = value === null ? "" : String(value)
  const [draft, setDraft] = useState(shown)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setDraft(shown)
  }, [editing, shown])
  return (
    <label className="flex flex-col gap-1">
      <span className={labelClassName ?? LABEL}>
        {label} <span className="text-muted-foreground">{formatRange(range)}</span>
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={range.min}
        max={range.max}
        step={1}
        value={draft}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onChange={(event) => {
          const raw = event.target.value
          setDraft(raw)
          if (raw.trim() === "") onChange(null)
          else if (Number.isFinite(Number(raw))) onChange(parseScale(raw, range.min, range.max))
        }}
        className={NUMBER_BOX}
      />
    </label>
  )
}

/** One rating on the session's scales: a number box on the numeric ones, the anchors on the verbal ones. */
function RatingField({
  label,
  labelClassName,
  scale,
  range,
  anchors,
  value,
  onChange,
}: {
  label: string
  labelClassName?: string
  scale: RatingScale
  range: { min: number; max: number }
  anchors: readonly string[]
  value: Rating | null
  onChange: (value: Rating | null) => void
}) {
  if (scale === "verbal") return <AnchorPicker label={label} labelClassName={labelClassName} anchors={anchors} value={value} onChange={onChange} />
  return <NumberRating label={label} labelClassName={labelClassName} range={range} value={value} onChange={onChange} />
}

/** One of the earlier template's questions with its answer; nothing when unanswered. */
function Answer({ question, text }: { question: string; text: string }) {
  if (!text) return null
  return (
    <div className="mt-2">
      <p className="text-[11px] leading-4 text-muted-foreground">{question}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-[18px] text-foreground">{text}</p>
    </div>
  )
}

/** A row's two ratings as chips, in the template's order, or a note that they are still to come. */
function Ratings({ support, likelihood }: { support: Rating | null; likelihood: Rating | null }) {
  if (likelihood === null && support === null) {
    return <span className="text-[11px] text-muted-foreground">Not rated yet</span>
  }
  const chip = "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] leading-4"
  return (
    <>
      <span className={chip}>
        <span className="text-muted-foreground">Support</span>
        <span
          className={cn("font-semibold", typeof support === "number" && "font-mono", support !== null ? supportClass(support) : "text-foreground")}
        >
          {support !== null ? formatRating(support, true) : "–"}
        </span>
      </span>
      <span className={chip}>
        <span className="text-muted-foreground">Likelihood</span>
        <span className={cn("font-semibold text-foreground", typeof likelihood === "number" && "font-mono")}>
          {likelihood !== null ? formatRating(likelihood) : "–"}
        </span>
      </span>
    </>
  )
}

export interface EntryExcerptLine {
  label: string
  text: string
}

/** Whether a row has anything to ask the rating questions about: a name, a rating already, or carried-over answers. */
function rowIsNamed(row: RecallRow): boolean {
  return Boolean(row.hypothesis.trim() || row.legacy || row.support !== null || row.likelihood !== null)
}

interface RecallEntryCardProps {
  number: number
  entry: RecallEntry
  /** The scales the session's ratings are given on. */
  scale: RatingScale
  /** The verbal anchors the session is on. */
  anchors: AnchorSet
  /** Hypotheses already named in this session, offered as a box is typed in so one is spelt the same at every stop. */
  hypothesisSuggestions: string[]
  excerpt: EntryExcerptLine[]
  /** The entry whose turns are ticked in the transcript. */
  open: boolean
  onOpen: () => void
  onChangeRows: (rows: RecallRow[]) => void
  onChangeNotes: (notes: string) => void
  onRemove: () => void
  cardRef: (element: HTMLElement | null) => void
}

export function RecallEntryCard({
  number,
  entry,
  scale,
  anchors,
  hypothesisSuggestions,
  excerpt,
  open,
  onOpen,
  onChangeRows,
  onChangeNotes,
  onRemove,
  cardRef,
}: RecallEntryCardProps) {
  // Removal asks once, inline: a browser confirm() is blocked in some
  // embedded views and would leave the X doing nothing.
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  // The id the next row will get, settled before it exists: the empty box
  // is keyed by it, so when typing turns the box into a row the input the
  // clinician is typing in stays the same element and keeps the focus.
  const [nextId, setNextId] = useState(() => crypto.randomUUID())
  const suggestionsId = useId()
  const verbal = VERBAL_ANCHOR_SETS[anchors]
  useEffect(() => {
    if (!open) setConfirmingRemove(false)
  }, [open])

  const rows = entry.rows
  // Question 1's boxes: every row, plus an empty one once the last is filled.
  const slots: Array<RecallRow | null> = rows.length === 0 || rowIsNamed(rows[rows.length - 1]) ? [...rows, null] : rows
  const named = rows.map((row, index) => ({ row, number: index + 1 })).filter(({ row }) => rowIsNamed(row))
  const suggestions = hypothesisSuggestions.filter((name) => !rows.some((row) => row.hypothesis === name))

  const setHypothesis = (index: number, hypothesis: string) => {
    if (index >= rows.length) {
      if (!hypothesis) return
      onChangeRows([...rows, { id: nextId, hypothesis, support: null, likelihood: null }])
      setNextId(crypto.randomUUID())
      return
    }
    const next = rows.map((row, i) => (i === index ? { ...row, hypothesis } : row))
    // The last box emptied again, with nothing rated: it goes, so the stop does not keep a blank hypothesis.
    const last = next[next.length - 1]
    if (index === next.length - 1 && !rowIsNamed(last)) next.pop()
    onChangeRows(next)
  }
  const setRating = (id: string, field: "support" | "likelihood", value: Rating | null) =>
    onChangeRows(rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)))
  const removeRow = (id: string) => onChangeRows(rows.filter((row) => row.id !== id))

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
            <span className="text-muted-foreground">Remove this highlight?</span>
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
            title="Remove this highlight"
            className="-mr-1 -mt-0.5 shrink-0 rounded-full p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <X className="h-3.5 w-3.5" />
            <span className="sr-only">Remove highlight {number}</span>
          </button>
        )}
      </header>

      {open ? (
        <div className="flex flex-col gap-4 border-t border-border px-4 pb-4 pt-3">
          {/* 1. The hypotheses, one box each. */}
          <div className="flex flex-col gap-2">
            <p className={QUESTION}>1. {RECALL_TEMPLATE.hypothesis}</p>
            {slots.map((row, index) => (
              <div key={row?.id ?? nextId} className="flex items-start gap-2">
                <label htmlFor={`${suggestionsId}-h${index}`} className="w-[88px] shrink-0 pt-1.5 text-xs text-muted-foreground">
                  Hypothesis {index + 1}:
                </label>
                <div className="min-w-0 flex-1">
                  <input
                    id={`${suggestionsId}-h${index}`}
                    value={row?.hypothesis ?? ""}
                    onChange={(event) => setHypothesis(index, event.target.value)}
                    list={suggestions.length > 0 ? suggestionsId : undefined}
                    className={BOX}
                  />
                  {row?.legacy && (
                    <>
                      <Answer question={RECALL_TEMPLATE.legacyV5.why} text={row.legacy.why} />
                      <Answer question={RECALL_TEMPLATE.legacyV5.told} text={row.legacy.told} />
                    </>
                  )}
                </div>
                {row && (
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    title={`Remove hypothesis ${index + 1}`}
                    className="mt-1 shrink-0 rounded-full p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <X className="h-3 w-3" />
                    <span className="sr-only">Remove hypothesis {index + 1}</span>
                  </button>
                )}
              </div>
            ))}
            {suggestions.length > 0 && (
              <datalist id={suggestionsId}>
                {suggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            )}
          </div>

          {/* 2 and 3. Asked once per named hypothesis. */}
          {named.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {named.map(({ row, number: n }) => (
                <RatingField
                  key={row.id}
                  label={`2${hypothesisLetter(n)}. ${hypothesisQuestion(RECALL_TEMPLATE.support, n)}`}
                  labelClassName={QUESTION}
                  scale={scale}
                  range={SUPPORT_RANGE}
                  anchors={verbal.support}
                  value={row.support}
                  onChange={(value) => setRating(row.id, "support", value)}
                />
              ))}
            </div>
          )}
          {named.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {named.map(({ row, number: n }) => (
                <RatingField
                  key={row.id}
                  label={`3${hypothesisLetter(n)}. ${hypothesisQuestion(RECALL_TEMPLATE.likelihood, n)}`}
                  labelClassName={QUESTION}
                  scale={scale}
                  range={LIKELIHOOD_RANGE}
                  anchors={verbal.likelihood}
                  value={row.likelihood}
                  onChange={(value) => setRating(row.id, "likelihood", value)}
                />
              ))}
            </div>
          )}

          <Field label={RECALL_TEMPLATE.notes}>
            <textarea rows={2} value={entry.notes} onChange={(event) => onChangeNotes(event.target.value)} className={cn(BOX, "resize-none")} />
          </Field>
        </div>
      ) : (
        <div className="flex flex-col gap-2 border-t border-border px-4 pb-4 pt-3">
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">No hypotheses yet.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {rows.map((row, index) => (
                <li key={row.id} className="rounded-lg border border-border/70 bg-background px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 font-mono text-[11px] font-semibold text-muted-foreground">Hypothesis {index + 1}</span>
                    <Ratings support={row.support} likelihood={row.likelihood} />
                  </div>
                  {row.hypothesis && (
                    <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-[18px] text-foreground">{row.hypothesis}</p>
                  )}
                  {row.legacy && (
                    <>
                      <Answer question={RECALL_TEMPLATE.legacyV5.why} text={row.legacy.why} />
                      <Answer question={RECALL_TEMPLATE.legacyV5.told} text={row.legacy.told} />
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
          <Answer question={RECALL_TEMPLATE.notes} text={entry.notes} />
        </div>
      )}
    </article>
  )
}

interface FinalDiagnosisCardProps {
  rows: FinalDiagnosisRow[]
  /** The scales the session's ratings are given on. */
  scale: RatingScale
  /** The verbal anchors the session is on. */
  anchors: AnchorSet
  onChange: (rows: FinalDiagnosisRow[]) => void
  cardRef?: (element: HTMLElement | null) => void
}

const EMPTY_DIAGNOSIS = { diagnosis: "", likelihood: null as Rating | null, why: "", difficulty: "" }

/**
 * The closing table: the diagnoses the clinician settled on, how likely,
 * why, and how difficult the case was (free text on the numeric scales, one
 * of the anchors on the verbal ones). The table is the summary, the form
 * below adds a row, clicking a row changes it.
 */
export function FinalDiagnosisCard({ rows, scale, anchors, onChange, cardRef }: FinalDiagnosisCardProps) {
  const [form, setForm] = useState(EMPTY_DIAGNOSIS)
  const [editingId, setEditingId] = useState<string | null>(null)
  const verbal = VERBAL_ANCHOR_SETS[anchors]

  const resetForm = () => {
    setEditingId(null)
    setForm(EMPTY_DIAGNOSIS)
  }
  const editRow = (row: FinalDiagnosisRow) => {
    setEditingId(row.id)
    setForm({ diagnosis: row.diagnosis, likelihood: row.likelihood, why: row.why, difficulty: row.difficulty })
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const diagnosis = form.diagnosis.trim()
    if (!diagnosis) return
    const values = { diagnosis, likelihood: form.likelihood, why: form.why.trim(), difficulty: form.difficulty.trim() }
    if (editingId) onChange(rows.map((row) => (row.id === editingId ? { ...row, ...values } : row)))
    else onChange([...rows, { id: crypto.randomUUID(), ...values }])
    resetForm()
  }
  const removeRow = (id: string) => {
    if (editingId === id) resetForm()
    onChange(rows.filter((row) => row.id !== id))
  }

  const likelihoodField = (
    <RatingField
      label="Likelihood"
      scale={scale}
      range={LIKELIHOOD_RANGE}
      anchors={verbal.likelihood}
      value={form.likelihood}
      onChange={(likelihood) => setForm({ ...form, likelihood })}
    />
  )

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
              <th className={cn(TH, scale === "verbal" ? "w-[18%]" : "w-[76px] text-center")}>Likelihood</th>
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
                <td className={cn(TD, "font-semibold", typeof row.likelihood === "number" && "text-center font-mono")}>
                  {row.likelihood !== null ? formatRating(row.likelihood) : null}
                </td>
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
            {scale === "numeric" && likelihoodField}
          </div>
          {scale === "verbal" && likelihoodField}
          <div className={cn("grid gap-2.5", scale === "numeric" && "sm:grid-cols-2")}>
            <Field label="Why">
              <textarea rows={2} value={form.why} onChange={(event) => setForm({ ...form, why: event.target.value })} className={cn(BOX, "resize-none")} />
            </Field>
            {scale === "verbal" ? (
              <AnchorPicker
                label="How difficult was the case?"
                anchors={verbal.difficulty}
                value={form.difficulty || null}
                onChange={(difficulty) => setForm({ ...form, difficulty: typeof difficulty === "string" ? difficulty : "" })}
              />
            ) : (
              <Field label="How difficult was the case?">
                <textarea rows={2} value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value })} className={cn(BOX, "resize-none")} />
              </Field>
            )}
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
