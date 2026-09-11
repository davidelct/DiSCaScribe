"use client"

/**
 * Everything needed to launch a consultation in one dialog: a live microphone
 * check, who it is for, the reason for visit, and the two ways in — record
 * now, or transcribe an uploaded file. The capture mode (study arm) is
 * deliberately NOT chosen here: it comes from Settings and is only displayed,
 * so the arm can't be flipped casually per consultation.
 *
 * Reached from two places. A patient's chart fixes the patient. The
 * consultations tab offers the register as a dropdown that defaults to "No
 * patient", because a consultation can run untied from any record.
 */

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Mic, Upload, X } from "lucide-react"
import { Button } from "@ui/lib/ui/button"
import { Input } from "@ui/lib/ui/input"
import { Label } from "@ui/lib/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/lib/ui/select"
import { MicTest, useEncounters } from "@ui"
import { PATIENTS, formatNhsNumber, getPatient, getPreferences, patientFullName } from "@storage"
import type { Patient } from "@storage/types"
import { setConsultationIntent, type ConsultationIntent } from "@/lib/consultation-intent"

/** Radix Select cannot carry an empty value, so "no patient" needs a sentinel. */
const NO_PATIENT = "__none__"

const FIELD_LABEL = "text-xs font-medium uppercase tracking-wide text-muted-foreground"

export interface StartConsultationDialogProps {
  /**
   * A fixed patient (launching from their chart). When absent the dialog
   * offers the register as a dropdown, with no patient selected by default.
   */
  patient?: Patient
  starting: boolean
  onCancel: () => void
  onRecord: (patient: Patient | undefined, visitReason: string) => void
  onUpload: (patient: Patient | undefined, visitReason: string, file: File) => void
}

export function StartConsultationDialog({
  patient: fixedPatient,
  starting,
  onCancel,
  onRecord,
  onUpload,
}: StartConsultationDialogProps) {
  const [visitReason, setVisitReason] = useState("")
  const [chosenPatientId, setChosenPatientId] = useState(NO_PATIENT)
  const [preferredDeviceId] = useState(() => getPreferences().preferredInputDeviceId || "")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const patient = fixedPatient ?? (chosenPatientId === NO_PATIENT ? undefined : getPatient(chosenPatientId))

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/20 p-4 backdrop-blur-sm">
      <div className="animate-scale-in w-full max-w-lg rounded-md border border-border bg-card p-6 shadow-lifted surface">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-medium tracking-tight text-foreground">New consultation</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {fixedPatient ? patientFullName(fixedPatient) : "Choose a patient, or run it untied from any record."}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="h-8 w-8 rounded-md p-0 text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4">
          <MicTest preferredDeviceId={preferredDeviceId} />

          {!fixedPatient && (
            <div className="space-y-2">
              <Label htmlFor="consultation-patient" className={FIELD_LABEL}>
                Patient
              </Label>
              <Select value={chosenPatientId} onValueChange={setChosenPatientId}>
                <SelectTrigger id="consultation-patient" aria-label="Patient" className="h-9 rounded-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PATIENT}>No patient</SelectItem>
                  {PATIENTS.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {patientFullName(candidate)} · NHS {formatNhsNumber(candidate.nhs_number)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="visit-reason" className={FIELD_LABEL}>
              Reason for visit (optional)
            </Label>
            <Input
              id="visit-reason"
              placeholder="e.g. GP consultation"
              value={visitReason}
              onChange={(e) => setVisitReason(e.target.value)}
              className="h-9 rounded-md border-border bg-background"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={starting}
              className="flex-1 rounded-md text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={() => onRecord(patient, visitReason)}
              disabled={starting}
              className="flex-[2] rounded-md bg-primary text-primary-foreground shadow-soft hover:bg-brand-strong"
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
              if (file) onUpload(patient, visitReason, file)
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={starting}
            className="w-full rounded-md"
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

/**
 * The launch the dialog performs: create the encounter (mode comes from
 * Settings; an absent patient leaves it untied), stash the launch intent for
 * the workspace to dispatch on mount, and navigate in.
 */
export function useLaunchConsultation() {
  const router = useRouter()
  const { addEncounter } = useEncounters()
  const [starting, setStarting] = useState(false)

  const launch = async (patient: Patient | undefined, visitReason: string, intent: ConsultationIntent) => {
    if (starting) return
    setStarting(true)
    try {
      const encounter = await addEncounter({
        patient_id: patient?.id ?? "",
        patient_name: patient ? patientFullName(patient) : "",
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

  return { launch, starting }
}
