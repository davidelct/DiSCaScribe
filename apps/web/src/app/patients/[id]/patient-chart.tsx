"use client"

/**
 * The patient chart: baseline record (demographics, problems, medications,
 * allergies, social history, historical observations) plus the consultation
 * history accumulated through the integrated scribe. The baseline is
 * deliberately read-only and sparse — presenting complaints and investigation
 * findings surface during consultations, never here (study integrity).
 *
 * Laid out as cards in rows: a details card, one equal-height row of the four
 * record cards, then consultations and observations as tables.
 */

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { ArrowLeft, ChevronRight, Plus, Trash2, Users } from "lucide-react"
import { Button } from "@ui/lib/ui/button"
import { ErrorBoundary, useEncounters, useHttpsWarning } from "@ui"
import { cn } from "@ui/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@ui/lib/ui/tooltip"
import {
  deleteEncounterAudio,
  formatNhsNumber,
  getPatient,
  getPatientObservations,
  patientAge,
  patientFullName,
} from "@storage"
import type { CodedEntry, Encounter, PatientObservation } from "@storage/types"
import { ModeBadge, StatusBadge } from "../../consultation-badges"
import { StartConsultationDialog, useLaunchConsultation } from "../../start-consultation-dialog"
import { TopBar } from "../../top-bar"

const CARD = "rounded-2xl border border-border bg-card shadow-soft"
const CARD_HEAD = "border-b border-border px-5 py-2.5"
const CARD_TITLE = "text-sm font-semibold text-foreground"
const TH = "py-3 text-left text-xs font-medium text-muted-foreground"
const ROW = "border-b border-border/60 last:border-0"

/**
 * A coded record entry. The chart reads as the record's own words; the code is
 * a quiet affordance behind them, the way a GP system shows the binding without
 * putting concept ids in the clinician's way.
 */
function CodedText({
  entry,
  components,
}: {
  entry: CodedEntry
  /** Coded parts behind a single displayed value, e.g. the two halves of a BP. */
  components?: PatientObservation["components"]
}) {
  if (!entry.code) return <>{entry.text}</>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-4"
        >
          {entry.text}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="block font-medium text-foreground">{entry.code.display}</span>
        <span className="mt-0.5 block font-mono text-[0.7rem] text-muted-foreground">
          SNOMED CT {entry.code.code}
        </span>
        {components?.length ? (
          <span className="mt-2 block border-t border-border pt-1.5">
            {components.map((component) => (
              <span key={component.code.code} className="block text-[0.7rem] text-muted-foreground">
                {component.code.display.replace(/\s*\(observable entity\)$/, "")}{" "}
                <span className="font-mono">
                  {component.value}
                  {component.unit ? ` ${component.unit}` : ""} · {component.code.code}
                </span>
              </span>
            ))}
          </span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** One of the four record cards: a title and a short list, or prose. */
function RecordCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={cn(CARD, "flex flex-col")}>
      <div className="border-b border-border px-4 py-2.5">
        <h2 className={CARD_TITLE}>{title}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-4 py-3">{children}</div>
    </section>
  )
}

function CodedList({ items, empty }: { items: CodedEntry[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm italic leading-relaxed text-muted-foreground">{empty}</p>
  return (
    <>
      {items.map((item) => (
        <p key={item.text} className="text-sm leading-relaxed text-foreground">
          <CodedText entry={item} />
        </p>
      ))}
    </>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  )
}

function PatientChartContent({ patientId }: { patientId: string }) {
  const router = useRouter()
  const { encounters, deleteEncounter } = useEncounters()
  const httpsWarning = useHttpsWarning()
  const { launch, starting } = useLaunchConsultation()
  const [showStartDialog, setShowStartDialog] = useState(false)

  const patient = getPatient(patientId)

  if (!patient) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <TopBar />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <Users className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No patient with this identifier is registered.</p>
          <Link href="/" className="text-sm font-medium text-primary hover:underline">
            Back to patients
          </Link>
        </div>
      </div>
    )
  }

  const observations = getPatientObservations(patient.id)
  const consultations = encounters
    .filter((e: Encounter) => e.patient_id === patient.id)
    .sort((a: Encounter, b: Encounter) => b.created_at.localeCompare(a.created_at))

  const handleDelete = async (encounterId: string) => {
    await deleteEncounter(encounterId)
    void deleteEncounterAudio(encounterId).catch(() => undefined)
    void deleteEncounterAudio(`recall:${encounterId}`).catch(() => undefined)
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {httpsWarning && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-destructive px-4 py-2 text-center text-sm font-semibold text-destructive-foreground">
          {httpsWarning}
        </div>
      )}
      <TopBar />
      {showStartDialog && (
        <StartConsultationDialog
          patient={patient}
          starting={starting}
          onCancel={() => setShowStartDialog(false)}
          onRecord={(_, reason) => void launch(patient, reason, { action: "record" })}
          onUpload={(_, reason, file) => void launch(patient, reason, { action: "upload", file })}
        />
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-8">
        {/* One row: back, who, and the way into a consultation. */}
        <div className="mb-4 flex items-center gap-3 border-b border-border py-2">
          <Link
            href="/"
            title="Back to patients"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="font-display text-base font-medium tracking-tight text-foreground">
            {patientFullName(patient)}
          </h1>
          <span className="text-xs text-muted-foreground">
            {patientAge(patient)} · {patient.sex === "male" ? "Male" : "Female"}
          </span>
          <Button
            onClick={() => setShowStartDialog(true)}
            disabled={starting}
            className="ml-auto rounded-md bg-primary px-4 text-primary-foreground shadow-soft hover:bg-brand-strong"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            New consultation
          </Button>
        </div>

        <div className="flex flex-col gap-3">
          {/* Details */}
          <section className={CARD}>
            <div className={CARD_HEAD}>
              <h2 className={CARD_TITLE}>Details</h2>
            </div>
            <div className="grid grid-cols-2 gap-4 px-5 py-3.5 sm:grid-cols-4">
              <Fact label="Born">{format(new Date(`${patient.date_of_birth}T00:00:00`), "d MMM yyyy")}</Fact>
              <Fact label="NHS number">
                <span className="font-mono text-[13px]">{formatNhsNumber(patient.nhs_number)}</span>
              </Fact>
              <Fact label="Address">{patient.address || "—"}</Fact>
              <Fact label="Phone">{patient.phone || "—"}</Fact>
            </div>
            <div className="border-t border-border/60 px-5 py-3">
              <p className="text-sm leading-relaxed text-foreground">{patient.summary}</p>
            </div>
          </section>

          {/* Record: one row, equal heights */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <RecordCard title="Problems">
              <CodedList items={patient.past_history} empty="No active problems recorded." />
            </RecordCard>
            <RecordCard title="Medications">
              <CodedList items={patient.medications} empty="No regular medications." />
            </RecordCard>
            <RecordCard title="Allergies">
              <CodedList items={patient.allergies} empty="None recorded." />
            </RecordCard>
            <RecordCard title="Social history">
              {patient.social_history ? (
                <p className="text-sm leading-relaxed text-foreground">{patient.social_history}</p>
              ) : (
                <p className="text-sm italic leading-relaxed text-muted-foreground">Not recorded.</p>
              )}
            </RecordCard>
          </div>

          {/* Consultations */}
          <section className={CARD}>
            <div className={CARD_HEAD}>
              <h2 className={CARD_TITLE}>Consultations</h2>
            </div>
            {consultations.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm italic text-muted-foreground">
                No consultations yet. Start one to record this patient's first visit.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className={cn(TH, "px-5")}>When</th>
                      <th className={cn(TH, "px-3")}>Reason</th>
                      <th className={cn(TH, "px-3")}>Mode</th>
                      <th className={cn(TH, "px-3")}>Status</th>
                      <th className="px-3 py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {consultations.map((consultation: Encounter) => {
                      const href = `/consultations/${consultation.id}`
                      return (
                        <tr
                          key={consultation.id}
                          onClick={() => router.push(href)}
                          className={cn(ROW, "group cursor-pointer transition-colors hover:bg-accent/40")}
                        >
                          <td className="whitespace-nowrap px-5 py-2.5">
                            <Link
                              href={href}
                              onClick={(e) => e.stopPropagation()}
                              className="font-medium text-foreground hover:text-primary"
                            >
                              {format(new Date(consultation.created_at), "d MMM yyyy")}
                            </Link>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {format(new Date(consultation.created_at), "HH:mm")}
                            </span>
                          </td>
                          <td className="max-w-xs truncate px-3 py-2.5 text-muted-foreground">
                            {consultation.visit_reason || "No reason recorded"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <ModeBadge mode={consultation.mode} />
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <StatusBadge encounter={consultation} />
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-end gap-1">
                              {consultation.approval_status !== "approved" && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void handleDelete(consultation.id)
                                  }}
                                  aria-label="Delete consultation"
                                  title="Delete consultation"
                                  className="rounded-md p-1.5 text-muted-foreground/60 opacity-0 transition-all group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                              <ChevronRight className="h-4 w-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Observations */}
          <section className={CARD}>
            <div className={CARD_HEAD}>
              <h2 className={CARD_TITLE}>Observations</h2>
            </div>
            {observations.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm italic text-muted-foreground">No observations on record.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className={cn(TH, "px-5")}>Date</th>
                      <th className={cn(TH, "px-3")}>Observation</th>
                      <th className={cn(TH, "px-3")}>Value</th>
                      <th className={cn(TH, "px-3")}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {observations.map((obs) => (
                      <tr key={obs.id} className={ROW}>
                        <td className="whitespace-nowrap px-5 py-2.5 text-muted-foreground">
                          {format(new Date(`${obs.date}T00:00:00`), "d MMM yyyy")}
                        </td>
                        <td className="px-3 py-2.5 text-foreground">
                          <CodedText entry={{ text: obs.name, code: obs.code }} components={obs.components} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-foreground">
                          {obs.value}
                          {obs.unit ? ` ${obs.unit}` : ""}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{obs.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

export function PatientChart({ patientId }: { patientId: string }) {
  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={150} skipDelayDuration={400}>
        <PatientChartContent patientId={patientId} />
      </TooltipProvider>
    </ErrorBoundary>
  )
}
