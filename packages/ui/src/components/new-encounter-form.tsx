"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@ui/lib/ui/button"
import { Input } from "@ui/lib/ui/input"
import { Label } from "@ui/lib/ui/label"
import { Mic } from "lucide-react"

interface NewEncounterFormProps {
  onStart: (data: { patient_name: string; patient_id: string; visit_reason: string }) => void
  onCancel: () => void
}

const VISIT_TYPE_OPTIONS = [
  { label: "History & Physical", value: "history_physical" },
  { label: "Problem Visit", value: "problem_visit" },
  { label: "Consult Note", value: "consult_note" },
]

export function NewEncounterForm({ onStart, onCancel }: NewEncounterFormProps) {
  const [patientName, setPatientName] = useState("")
  const [visitType, setVisitType] = useState(VISIT_TYPE_OPTIONS[0]?.value ?? "")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onStart({
      patient_name: patientName,
      patient_id: "",
      visit_reason: visitType,
    })
  }

  return (
    <div className="animate-fade-up mx-auto w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-lifted surface">
      <div className="mb-7 text-center">
        <h2 className="font-display text-2xl font-medium tracking-tight text-foreground">New Interview</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">A few details before we begin recording.</p>
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
      </form>
    </div>
  )
}
