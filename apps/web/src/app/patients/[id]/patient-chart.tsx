"use client"

/**
 * The patient chart: baseline record (demographics, problems, medications,
 * allergies, social history, historical observations) plus the consultation
 * history accumulated through the integrated scribe. The baseline is
 * deliberately read-only and sparse — presenting complaints and investigation
 * findings surface during consultations, never here (study integrity).
 */

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  ClipboardList,
  Mic,
  Pill,
  ShieldAlert,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react"
import { Button } from "@ui/lib/ui/button"
import { Input } from "@ui/lib/ui/input"
import { Label } from "@ui/lib/ui/label"
import { ErrorBoundary, MicTest, useEncounters, useHttpsWarning } from "@ui"
import { setConsultationIntent, type ConsultationIntent } from "@/lib/consultation-intent"
import { cn } from "@ui/lib/utils"
import {
  deleteEncounterAudio,
  formatNhsNumber,
  getPatient,
  getPatientObservations,
  getPreferences,
  patientAge,
  patientFullName,
} from "@storage"
import type { Encounter, Patient } from "@storage/types"
import { TopBar } from "../../top-bar"

/** Chart-facing lifecycle label for one consultation. */
function consultationStatus(e: Encounter): { label: string; className: string } {
  if (e.approval_status === "approved") {
    return { label: "Filed", className: "border-success/30 bg-success/10 text-success" }
  }
  if (e.status === "transcription_failed" || e.status === "note_generation_failed") {
    return { label: "Failed", className: "border-destructive/30 bg-destructive/10 text-destructive" }
  }
  if (e.note_text?.trim()) {
    return { label: "Draft note", className: "border-warning/40 bg-warning/10 text-warning-foreground" }
  }
  if (e.status === "completed") {
    return { label: "Awaiting note", className: "border-warning/40 bg-warning/10 text-warning-foreground" }
  }
  return { label: "In progress", className: "border-border bg-muted text-muted-foreground" }
}

function SummaryBlock({
  title,
  icon,
  items,
  empty,
}: {
  title: string
  icon: React.ReactNode
  items: string[]
  empty: string
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-soft surface">
      <h2 className="mb-3 flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
        {icon}
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item} className="text-sm leading-relaxed text-foreground">
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Everything needed to launch a consultation in one dialog: a live microphone
 * check, the reason for visit, and the two ways in — record now, or transcribe
 * an uploaded file. The capture mode (study arm) is deliberately NOT chosen
 * here: it comes from Settings and is only displayed, so the arm can't be
 * flipped casually per consultation.
 */
function StartConsultationDialog({
  patient,
  starting,
  onCancel,
  onRecord,
  onUpload,
}: {
  patient: Patient
  starting: boolean
  onCancel: () => void
  onRecord: (visitReason: string) => void
  onUpload: (visitReason: string, file: File) => void
}) {
  const [visitReason, setVisitReason] = useState("")
  const [preferredDeviceId] = useState(() => getPreferences().preferredInputDeviceId || "")
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/20 p-4 backdrop-blur-sm">
      <div className="animate-scale-in w-full max-w-lg rounded-3xl border border-border bg-card p-7 shadow-lifted surface">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-medium tracking-tight text-foreground">New consultation</h2>
            <p className="mt-1 text-sm text-muted-foreground">{patientFullName(patient)}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="h-8 w-8 rounded-full p-0 text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4">
          <MicTest preferredDeviceId={preferredDeviceId} />

          <div className="space-y-2">
            <Label
              htmlFor="visit-reason"
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              Reason for visit (optional)
            </Label>
            <Input
              id="visit-reason"
              placeholder="e.g. GP consultation"
              value={visitReason}
              onChange={(e) => setVisitReason(e.target.value)}
              className="h-11 rounded-xl border-border bg-background"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={starting}
              className="flex-1 rounded-full text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={() => onRecord(visitReason)}
              disabled={starting}
              className="flex-[2] rounded-full bg-primary text-primary-foreground shadow-soft hover:bg-brand-strong"
            >
              <Mic className="mr-2 h-4 w-4" />
              Start recording
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ""
              if (file) onUpload(visitReason, file)
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={starting}
            className="w-full rounded-full"
          >
            <Upload className="mr-2 h-4 w-4" />
            Upload audio file
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Transcribe an existing recording (WAV, MP3, M4A…).
          </p>
        </div>
      </div>
    </div>
  )
}

function PatientChartContent({ patientId }: { patientId: string }) {
  const router = useRouter()
  const { encounters, addEncounter, deleteEncounter } = useEncounters()
  const httpsWarning = useHttpsWarning()
  const [showStartDialog, setShowStartDialog] = useState(false)
  const [starting, setStarting] = useState(false)

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

  // Create the encounter (mode comes from Settings), stash the launch intent
  // for the workspace to dispatch on mount, and navigate in.
  const launchConsultation = async (visitReason: string, intent: ConsultationIntent) => {
    if (starting) return
    setStarting(true)
    try {
      const encounter = await addEncounter({
        patient_id: patient.id,
        patient_name: patientFullName(patient),
        visit_reason: visitReason.trim() || "GP consultation",
        status: "idle",
        transcript_text: "",
        mode: getPreferences().encounterMode || "scribed",
      })
      setConsultationIntent(encounter.id, intent)
      router.push(`/consultations/${encounter.id}`)
    } finally {
      setStarting(false)
    }
  }

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
          onRecord={(reason) => void launchConsultation(reason, { action: "record" })}
          onUpload={(reason, file) => void launchConsultation(reason, { action: "upload", file })}
        />
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Link
          href="/"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Patients
        </Link>

        {/* Patient banner */}
        <div className="animate-fade-up rounded-3xl border border-border bg-card p-6 shadow-soft surface">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-soft font-display text-xl font-medium text-primary">
                {patient.given_name[0]}
                {patient.family_name[0]}
              </span>
              <div>
                <h1 className="font-display text-2xl font-medium tracking-tight text-foreground">
                  {patientFullName(patient)}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {patientAge(patient)} years · {patient.sex === "male" ? "Male" : "Female"}
                  </span>
                  <span>Born {format(new Date(`${patient.date_of_birth}T00:00:00`), "d MMM yyyy")}</span>
                  <span className="font-mono">NHS {formatNhsNumber(patient.nhs_number)}</span>
                  {patient.address && <span>{patient.address}</span>}
                  {patient.phone && <span>{patient.phone}</span>}
                </div>
              </div>
            </div>
            <Button
              onClick={() => setShowStartDialog(true)}
              disabled={starting}
              className="rounded-full bg-primary px-5 text-primary-foreground shadow-soft hover:bg-brand-strong"
            >
              <Mic className="mr-2 h-4 w-4" />
              Start consultation
            </Button>
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">{patient.summary}</p>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.5fr]">
          {/* Left rail: baseline record */}
          <div className="space-y-4">
            <SummaryBlock
              title="Active problems"
              icon={<AlertCircle className="h-3.5 w-3.5" />}
              items={patient.past_history}
              empty="No active problems recorded."
            />
            <SummaryBlock
              title="Medications"
              icon={<Pill className="h-3.5 w-3.5" />}
              items={patient.medications}
              empty="No regular medications."
            />
            <SummaryBlock
              title="Allergies"
              icon={<ShieldAlert className="h-3.5 w-3.5" />}
              items={patient.allergies}
              empty="None recorded."
            />
            <section className="rounded-2xl border border-border bg-card p-5 shadow-soft surface">
              <h2 className="mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                Social history
              </h2>
              <p className="text-sm leading-relaxed text-foreground">
                {patient.social_history || <span className="italic text-muted-foreground">Not recorded.</span>}
              </p>
            </section>
          </div>

          {/* Right rail: consultations + observations */}
          <div className="space-y-4">
            <section className="rounded-2xl border border-border bg-card p-5 shadow-soft surface">
              <h2 className="mb-3 flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                <ClipboardList className="h-3.5 w-3.5" />
                Consultations
              </h2>
              {consultations.length === 0 ? (
                <p className="py-6 text-center text-sm italic text-muted-foreground">
                  No consultations yet. Start one to record this patient's first visit.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {consultations.map((consultation: Encounter) => {
                    const status = consultationStatus(consultation)
                    return (
                      <li key={consultation.id} className="group relative">
                        <Link
                          href={`/consultations/${consultation.id}`}
                          className="flex items-center gap-3 rounded-xl border border-transparent p-3 pr-10 transition-colors hover:border-border hover:bg-accent/40"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-foreground">
                                {format(new Date(consultation.created_at), "d MMM yyyy 'at' HH:mm")}
                              </p>
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold",
                                  status.className,
                                )}
                              >
                                {status.label}
                              </span>
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold",
                                  consultation.mode === "recording_only"
                                    ? "border-success/30 bg-success/5 text-success"
                                    : "border-primary/25 bg-brand-soft/50 text-primary",
                                )}
                              >
                                {consultation.mode === "recording_only" ? "Recording only" : "Scribed"}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {consultation.visit_reason || "No reason recorded"}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                        {consultation.approval_status !== "approved" && (
                          <button
                            type="button"
                            onClick={() => void handleDelete(consultation.id)}
                            aria-label="Delete consultation"
                            title="Delete consultation"
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground/60 opacity-0 transition-all group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 shadow-soft surface">
              <h2 className="mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                Observations
              </h2>
              {observations.length === 0 ? (
                <p className="py-4 text-center text-sm italic text-muted-foreground">No observations on record.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">Date</th>
                        <th className="pb-2 pr-4 font-medium">Observation</th>
                        <th className="pb-2 pr-4 font-medium">Value</th>
                        <th className="pb-2 font-medium">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {observations.map((obs) => (
                        <tr key={obs.id} className="border-b border-border/60 last:border-0">
                          <td className="py-2.5 pr-4 whitespace-nowrap text-muted-foreground">
                            {format(new Date(`${obs.date}T00:00:00`), "d MMM yyyy")}
                          </td>
                          <td className="py-2.5 pr-4 text-foreground">{obs.name}</td>
                          <td className="py-2.5 pr-4 whitespace-nowrap font-mono text-xs text-foreground">
                            {obs.value}
                            {obs.unit ? ` ${obs.unit}` : ""}
                          </td>
                          <td className="py-2.5 text-xs text-muted-foreground">{obs.notes || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}

export function PatientChart({ patientId }: { patientId: string }) {
  return (
    <ErrorBoundary>
      <PatientChartContent patientId={patientId} />
    </ErrorBoundary>
  )
}
