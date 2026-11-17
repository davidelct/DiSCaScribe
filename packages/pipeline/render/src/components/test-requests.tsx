"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { ImagingRequestForm, NoteArchiveStatus, TestRequest } from "@storage/types"
import {
  IMAGING_URGENCIES,
  PREGNANCY_STATUSES,
  REQUEST_CATALOGUE,
  applyTestSelection,
  emptyImagingForm,
  parseImagingForm,
  requestKind,
  searchCatalogue,
  type PregnancyStatus,
  type RequestKind,
} from "@pipeline-errors"
import { Button } from "@ui/lib/ui/button"
import { Input } from "@ui/lib/ui/input"
import { Textarea } from "@ui/lib/ui/textarea"
import { cn } from "@ui/lib/utils"
import { ArrowLeft, Check, FlaskConical, Loader2, Search, X } from "lucide-react"
import { CARD, CARD_BODY, CARD_HEAD } from "./note-parts"

/**
 * Test requests, the same in both arms: a card listing what has been
 * requested, open at any point in the consultation (before, during or after
 * the recording), and a request screen laid out like a GP system's, split
 * between blood tests and imaging, each catalogue's groups side by side with
 * a tick per test. The card's chips
 * remove a single test in place; the request screen saves its ticks as a
 * whole. It works in two steps, as a GP system does: pick, then the request
 * details. Blood tests go with a clinical indication, one brief free-text
 * justification for the batch; imaging goes with its request form, whose
 * clinical details are mandatory. Both are required as a GP system requires
 * them. Filing the note locks the
 * requests with the rest of the consultation.
 */

const ARCHIVE_TITLES: Record<NoteArchiveStatus, string> = {
  pending: "Saving the requests to the archive…",
  archived: "The requests are saved to the archive",
  failed: "Archiving the requests failed; they are saved again with the next change",
  skipped: "Archiving not configured — stored locally only",
}

function ArchiveMark({ status }: { status?: NoteArchiveStatus }) {
  if (!status || status === "skipped") return null
  return (
    <span title={ARCHIVE_TITLES[status]} className="inline-flex items-center">
      {status === "pending" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
      {status === "archived" && <Check className="h-3 w-3 text-success" />}
      {status === "failed" && <X className="h-3 w-3 text-destructive" />}
    </span>
  )
}

/** The requests in the order they were laid out, gathered under their groups. */
function groupRequests(requests: TestRequest[]): Array<{ group: string; requests: TestRequest[] }> {
  const groups: Array<{ group: string; requests: TestRequest[] }> = []
  for (const request of requests) {
    const last = groups.at(-1)
    if (last?.group === request.group) last.requests.push(request)
    else groups.push({ group: request.group, requests: [request] })
  }
  return groups
}

/** The short answers of an imaging request form, for one line under its clinical details. */
function imagingFormMeta(form: ImagingRequestForm): string[] {
  const labelled = (label: string, value: string) => (value ? `${label}: ${value}` : "")
  return [
    IMAGING_URGENCIES.find((urgency) => urgency.value === form.urgency)?.label ?? "",
    PREGNANCY_STATUSES.find((status) => status.value === form.pregnancy_status)?.label ?? "",
    labelled("Bloods", form.relevant_bloods),
    labelled("Mobility", form.mobility),
    labelled("Allergies", form.allergies),
    labelled("Implants", form.implants),
  ].filter(Boolean)
}

export function TestRequestsCard({
  requests,
  clinicalIndication,
  imagingForm,
  locked,
  archiveStatus,
  onSave,
}: {
  requests: TestRequest[]
  /** The justification given for the blood tests; "" when none has been. */
  clinicalIndication: string
  /** The request form for the imaging; null when no imaging is requested. */
  imagingForm: ImagingRequestForm | null
  /** True once the note is filed: the requests are shown, not changed. */
  locked: boolean
  archiveStatus?: NoteArchiveStatus
  onSave: (requests: TestRequest[], clinicalIndication: string, imagingForm: ImagingRequestForm | null) => void
}) {
  const [picking, setPicking] = useState(false)
  const grouped = groupRequests(requests)

  return (
    <section className={CARD}>
      <div className={CARD_HEAD}>
        <h2 className={cn("text-sm font-semibold", requests.length ? "text-foreground" : "text-muted-foreground")}>
          Tests and imaging
        </h2>
        <span className="text-xs text-muted-foreground">
          {requests.length ? `${requests.length} requested` : locked ? "None requested" : ""}
        </span>
        <ArchiveMark status={requests.length || archiveStatus === "failed" ? archiveStatus : undefined} />
        {!locked && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPicking(true)}
            className="ml-auto h-8 rounded-md px-3"
          >
            <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
            <span className="text-xs">{requests.length ? "Change tests" : "Request tests"}</span>
          </Button>
        )}
      </div>
      {requests.length > 0 && (
        <div className={cn(CARD_BODY, "space-y-2")}>
          {grouped.map(({ group, requests: inGroup }) => (
            <div key={group} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
              <span className="w-52 shrink-0 text-xs text-muted-foreground">{group}</span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {inGroup.map((request) => (
                  <span
                    key={request.id}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background pl-2.5 pr-1 text-xs text-foreground"
                  >
                    {request.name}
                    {locked ? (
                      <span className="w-1.5" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          // The indication goes with the last blood test, the form with the last imaging.
                          const remaining = requests.filter((r) => r.id !== request.id)
                          const imagingLeft = remaining.some((r) => requestKind(r) === "imaging")
                          onSave(
                            remaining,
                            remaining.length > 0 && remaining.some((r) => requestKind(r) === "blood")
                              ? clinicalIndication
                              : "",
                            imagingLeft ? imagingForm : null,
                          )
                        }}
                        aria-label={`Remove ${request.name}`}
                        title="Remove this test"
                        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {clinicalIndication && (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 border-t border-border pt-2">
              <span className="w-52 shrink-0 text-xs text-muted-foreground">Blood tests indication</span>
              <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm text-foreground">{clinicalIndication}</p>
            </div>
          )}
          {imagingForm && (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 border-t border-border pt-2">
              <span className="w-52 shrink-0 text-xs text-muted-foreground">Imaging request</span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="whitespace-pre-wrap text-sm text-foreground">{imagingForm.clinical_details}</p>
                {imagingForm.clinical_question && (
                  <p className="whitespace-pre-wrap text-sm text-foreground">{imagingForm.clinical_question}</p>
                )}
                <p className="text-xs text-muted-foreground">{imagingFormMeta(imagingForm).join(" · ")}</p>
              </div>
            </div>
          )}
        </div>
      )}
      {picking && (
        <TestRequestDialog
          requests={requests}
          clinicalIndication={clinicalIndication}
          imagingForm={imagingForm}
          onCancel={() => setPicking(false)}
          onSave={(next, indication, form) => {
            setPicking(false)
            onSave(next, indication, form)
          }}
        />
      )}
    </section>
  )
}

const FIELD_LABEL = "mb-1.5 block text-sm font-medium text-foreground"
const OPTIONAL = <span className="font-normal text-muted-foreground"> (optional)</span>

function TestRequestDialog({
  requests,
  clinicalIndication,
  imagingForm,
  onCancel,
  onSave,
}: {
  requests: TestRequest[]
  clinicalIndication: string
  imagingForm: ImagingRequestForm | null
  onCancel: () => void
  onSave: (requests: TestRequest[], clinicalIndication: string, imagingForm: ImagingRequestForm | null) => void
}) {
  const [form, setForm] = useState<ImagingRequestForm>(() => imagingForm ?? emptyImagingForm())
  const setField = <K extends keyof ImagingRequestForm>(field: K, value: ImagingRequestForm[K]) =>
    setForm((current) => ({ ...current, [field]: value }))
  const [indication, setIndication] = useState(clinicalIndication)
  const [selected, setSelected] = useState(() => new Set(requests.map((request) => request.id)))
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<RequestKind>("blood")
  // Picking comes first; the details step asks what the picked requests need.
  const [step, setStep] = useState<"pick" | "details">("pick")
  const searchRef = useRef<HTMLInputElement>(null)
  // Every section is searched, so a tab can say what the other one holds.
  const sections = useMemo(
    () =>
      REQUEST_CATALOGUE.map((section) => {
        const groups = searchCatalogue(query, section.groups)
        return {
          ...section,
          groups,
          matches: groups.reduce((count, group) => count + group.tests.length, 0),
          ids: section.groups.flatMap((group) => group.tests.map((test) => test.id)),
        }
      }),
    [query],
  )
  const section = sections.find((s) => s.kind === kind) ?? sections[0]
  const groups = section.groups
  const elsewhere = sections.filter((s) => s.kind !== kind && s.matches > 0)
  const searching = query.trim().length > 0

  // Escape cancels, as the backdrop does. Read through a ref so the listener
  // is set once rather than on every render's new callback.
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  useEffect(() => {
    searchRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // With no blood test selected there is nothing to justify, and with no
  // imaging no form to send, so neither is kept. A request whose test has
  // left the catalogue counts as the blood test it was.
  const imagingIds = sections.find((s) => s.kind === "imaging")?.ids ?? []
  const imagingCount = imagingIds.filter((id) => selected.has(id)).length
  const bloodCount = selected.size - imagingCount
  const nextIndication = bloodCount ? indication.trim() : ""
  const indicationMissing = bloodCount > 0 && !nextIndication
  const nextForm = imagingCount ? parseImagingForm(form) : null
  const detailsMissing = nextForm !== null && !nextForm.clinical_details
  // What is picked, by name, for the details step to say what it is about.
  const picked = useMemo(() => applyTestSelection(requests, selected, ""), [requests, selected])
  const bloodPicked = picked.filter((request) => requestKind(request) === "blood")
  const imagingPicked = picked.filter((request) => requestKind(request) === "imaging")
  const changed =
    selected.size !== requests.length ||
    requests.some((request) => !selected.has(request.id)) ||
    nextIndication !== clinicalIndication ||
    JSON.stringify(nextForm) !== JSON.stringify(parseImagingForm(imagingForm))

  const save = () =>
    changed
      ? onSave(applyTestSelection(requests, selected, new Date().toISOString()), nextIndication, nextForm)
      : onCancel()

  // Portalled to the body, so no scrolling or transformed ancestor can clip it.
  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/20 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="test-request-title"
        className="animate-scale-in flex h-[min(88vh,820px)] w-full max-w-6xl flex-col rounded-md border border-border bg-card shadow-lifted surface"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-6 py-4">
          <h2 id="test-request-title" className="font-display text-xl font-medium tracking-tight text-foreground">
            {step === "pick" ? "Request tests" : "Request details"}
          </h2>
          {step === "pick" && (
            <div role="tablist" aria-label="What to request" className="flex items-center gap-1 rounded-md bg-muted p-1">
              {sections.map((s) => {
                const count = s.ids.filter((id) => selected.has(id)).length
                return (
                  <button
                    key={s.kind}
                    type="button"
                    role="tab"
                    aria-selected={s.kind === kind}
                    onClick={() => setKind(s.kind)}
                    className={cn(
                      "flex h-8 items-center gap-1.5 rounded px-3 text-sm font-medium transition-colors",
                      s.kind === kind
                        ? "bg-card text-foreground shadow-soft"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s.label}
                    {count > 0 && (
                      <span className="rounded-full bg-primary px-1.5 text-xs leading-5 text-primary-foreground">
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
          {step === "pick" && (
            <div className="relative ml-auto w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${section.label.toLowerCase()}`}
                aria-label={`Search ${section.label.toLowerCase()}`}
                className="h-9 rounded-md pl-8"
              />
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className={cn(
              "h-8 w-8 rounded-md p-0 text-muted-foreground hover:text-foreground",
              step === "details" && "ml-auto",
            )}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {step === "pick" ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {groups.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nothing in {section.label.toLowerCase()} matches “{query.trim()}”.
              </p>
            ) : (
              <div className="columns-1 gap-8 sm:columns-2 lg:columns-3">
                {groups.map((group) => (
                  <fieldset key={group.name} className="mb-6 break-inside-avoid">
                    <legend className="mb-2 w-full border-b border-primary/30 pb-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                      {group.name}
                    </legend>
                    {group.tests.map((test) => (
                      <label
                        key={test.id}
                        className={cn(
                          "flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent",
                          selected.has(test.id) ? "font-medium text-foreground" : "text-foreground/90",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(test.id)}
                          onChange={() => toggle(test.id)}
                          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                        />
                        {test.name}
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
            )}
            {searching &&
              elsewhere.map((other) => (
                <p key={other.kind} className="pb-2 text-center text-sm text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => setKind(other.kind)}
                    className="font-medium text-primary hover:underline"
                  >
                    {other.matches} {other.matches === 1 ? "match" : "matches"} in {other.label.toLowerCase()}
                  </button>
                </p>
              ))}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
            <div className="mx-auto max-w-2xl space-y-10">
              {bloodPicked.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-primary">Blood tests</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {bloodPicked.map((request) => request.name).join(" · ")}
                  </p>
                  <label htmlFor="test-clinical-indication" className={cn(FIELD_LABEL, "mt-5")}>
                    Clinical indication
                  </label>
                  <Textarea
                    id="test-clinical-indication"
                    autoFocus
                    value={indication}
                    onChange={(e) => setIndication(e.target.value)}
                    rows={3}
                    placeholder="Brief justification for these blood tests"
                    className="max-h-40 min-h-20 resize-none rounded-md"
                  />
                </section>
              )}
              {imagingPicked.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-primary">Imaging</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {imagingPicked.map((request) => `${request.group}: ${request.name}`).join(" · ")}
                  </p>
                  <div className="mt-5 space-y-5">
                    <div>
                      <label htmlFor="imaging-clinical-details" className={FIELD_LABEL}>
                        Clinical details / history
                      </label>
                      <Textarea
                        id="imaging-clinical-details"
                        autoFocus={bloodPicked.length === 0}
                        value={form.clinical_details}
                        onChange={(e) => setField("clinical_details", e.target.value)}
                        rows={3}
                        className="max-h-40 min-h-20 resize-none rounded-md"
                      />
                    </div>
                    <div>
                      <label htmlFor="imaging-clinical-question" className={FIELD_LABEL}>
                        Clinical question / indication{OPTIONAL}
                      </label>
                      <Textarea
                        id="imaging-clinical-question"
                        value={form.clinical_question}
                        onChange={(e) => setField("clinical_question", e.target.value)}
                        rows={2}
                        className="max-h-32 min-h-16 resize-none rounded-md"
                      />
                    </div>
                    <fieldset>
                      <legend className={FIELD_LABEL}>Urgency</legend>
                      <div className="inline-flex items-center gap-1 rounded-md bg-muted p-1">
                        {IMAGING_URGENCIES.map((urgency) => (
                          <button
                            key={urgency.value}
                            type="button"
                            aria-pressed={form.urgency === urgency.value}
                            onClick={() => setField("urgency", urgency.value)}
                            className={cn(
                              "h-8 rounded px-3 text-sm font-medium transition-colors",
                              form.urgency === urgency.value
                                ? "bg-card text-foreground shadow-soft"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {urgency.label}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="imaging-pregnancy" className={FIELD_LABEL}>
                          Pregnancy status{OPTIONAL}
                        </label>
                        <select
                          id="imaging-pregnancy"
                          value={form.pregnancy_status}
                          onChange={(e) => setField("pregnancy_status", e.target.value as PregnancyStatus)}
                          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          <option value="">Not answered</option>
                          {PREGNANCY_STATUSES.map((status) => (
                            <option key={status.value} value={status.value}>
                              {status.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="imaging-bloods" className={FIELD_LABEL}>
                          Relevant bloods{OPTIONAL}
                        </label>
                        <Input
                          id="imaging-bloods"
                          value={form.relevant_bloods}
                          onChange={(e) => setField("relevant_bloods", e.target.value)}
                          placeholder="e.g. eGFR"
                          className="h-9 rounded-md"
                        />
                      </div>
                      <div>
                        <label htmlFor="imaging-mobility" className={FIELD_LABEL}>
                          Mobility{OPTIONAL}
                        </label>
                        <Input
                          id="imaging-mobility"
                          value={form.mobility}
                          onChange={(e) => setField("mobility", e.target.value)}
                          className="h-9 rounded-md"
                        />
                      </div>
                      <div>
                        <label htmlFor="imaging-allergies" className={FIELD_LABEL}>
                          Allergies{OPTIONAL}
                        </label>
                        <Input
                          id="imaging-allergies"
                          value={form.allergies}
                          onChange={(e) => setField("allergies", e.target.value)}
                          className="h-9 rounded-md"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label htmlFor="imaging-implants" className={FIELD_LABEL}>
                          Implants or pacemaker{OPTIONAL}
                        </label>
                        <Input
                          id="imaging-implants"
                          value={form.implants}
                          onChange={(e) => setField("implants", e.target.value)}
                          placeholder="For MRI safety"
                          className="h-9 rounded-md"
                        />
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-border px-6 py-3">
          {step === "pick" ? (
            <>
              <span className="text-sm text-muted-foreground">
                {selected.size ? `${selected.size} selected` : "Nothing selected"}
              </span>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Clear
                </button>
              )}
            </>
          ) : (
            <Button
              variant="ghost"
              onClick={() => setStep("pick")}
              className="-ml-2 h-9 rounded-md px-2 text-muted-foreground"
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back to tests
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {step === "details" && (indicationMissing || detailsMissing) && (
              <span className="mr-1 text-xs text-muted-foreground">
                {indicationMissing ? "Add the clinical indication to save" : "Add the clinical details to save"}
              </span>
            )}
            <Button variant="ghost" onClick={onCancel} className="h-9 rounded-md px-4 text-muted-foreground">
              Cancel
            </Button>
            {step === "pick" && selected.size > 0 ? (
              <Button
                onClick={() => setStep("details")}
                className="h-9 rounded-md bg-primary px-4 text-primary-foreground shadow-soft hover:bg-brand-strong"
              >
                Continue
              </Button>
            ) : (
              <Button
                disabled={indicationMissing || detailsMissing}
                onClick={save}
                className="h-9 rounded-md bg-primary px-4 text-primary-foreground shadow-soft hover:bg-brand-strong"
              >
                Save
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
