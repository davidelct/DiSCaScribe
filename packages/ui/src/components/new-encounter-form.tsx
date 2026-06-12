"use client"

import type React from "react"

import { useRef, useState } from "react"
import { Button } from "@ui/lib/ui/button"
import { Input } from "@ui/lib/ui/input"
import { Label } from "@ui/lib/ui/label"
import { Mic, Upload } from "lucide-react"

interface EncounterFormData {
  patient_name: string
  patient_id: string
  visit_reason: string
}

interface NewEncounterFormProps {
  onStart: (data: EncounterFormData) => void
  onCancel: () => void
  /** When provided, shows an "Upload audio file" action that transcribes an existing recording. */
  onUpload?: (data: EncounterFormData, file: File) => void
}

const VISIT_TYPE_OPTIONS = [
  { label: "History & Physical", value: "history_physical" },
  { label: "Problem Visit", value: "problem_visit" },
  { label: "Consult Note", value: "consult_note" },
]

export function NewEncounterForm({ onStart, onCancel, onUpload }: NewEncounterFormProps) {
  const [patientName, setPatientName] = useState("")
  const [visitType, setVisitType] = useState(VISIT_TYPE_OPTIONS[0]?.value ?? "")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentData = (): EncounterFormData => ({
    patient_name: patientName,
    patient_id: "",
    visit_reason: visitType,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onStart(currentData())
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset so selecting the same file again re-triggers onChange.
    e.target.value = ""
    if (file && onUpload) {
      onUpload(currentData(), file)
    }
  }

  return (
    <div className="animate-fade-up mx-auto w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-lifted surface">
      <div className="mb-7 text-center">
        <h2 className="font-display text-2xl font-medium tracking-tight text-foreground">New Interview</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">A few details to get started.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="patient-name" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Patient Name
          </Label>
          <Input
            id="patient-name"
            placeholder="Enter patient name (optional)"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            className="h-11 rounded-xl border-border bg-background"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="visit-type" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Note Type
          </Label>
          <select
            id="visit-type"
            value={visitType}
            onChange={(e) => setVisitType(e.target.value)}
            className="h-11 w-full rounded-xl border border-border bg-background px-4 text-sm text-foreground transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {VISIT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3 pt-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            className="flex-1 rounded-full text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="flex-1 rounded-full bg-primary text-primary-foreground shadow-soft hover:bg-brand-strong"
          >
            <Mic className="mr-2 h-4 w-4" />
            Start Recording
          </Button>
        </div>

        {onUpload && (
          <>
            <div className="flex items-center gap-3 pt-1">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-full"
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload audio file
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Transcribe an existing recording (WAV, MP3, M4A…).
            </p>
          </>
        )}
      </form>
    </div>
  )
}
