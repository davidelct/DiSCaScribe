/**
 * Presentation helpers shared by every list of consultations (the patient
 * chart's history, the consultations tab, stimulated recall): one lifecycle
 * label and one duration format, so a consultation reads the same wherever it
 * appears.
 */

import type { Encounter } from "@storage/types"

/** Chart-facing lifecycle label for one consultation. */
export function consultationStatus(e: Encounter): { label: string; className: string } {
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

/**
 * Recording duration as m:ss (h:mm:ss past an hour). Consultations transcribed
 * from an uploaded file carry no duration; those, and anything not yet
 * recorded, read as a dash.
 */
export function formatConsultationDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "—"
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes)
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(secs).padStart(2, "0")}`
}
