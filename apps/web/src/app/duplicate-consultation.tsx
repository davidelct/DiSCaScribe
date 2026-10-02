"use client"

/**
 * Duplicate a consultation: a new consultation with the same transcript and
 * recording and nothing else — no note, no recall. Made so a stimulated
 * recall can be run again over the same consultation, on the other rating
 * scales for instance, and the two compared, without transcribing the
 * recording again (which would not give the same words twice).
 *
 * The copy records which consultation it came from (duplicated_from). Its
 * recording is this browser's copy of the original's (or the archive's),
 * saved under the new id so the player and the recall work here at once;
 * every other browser streams the original's from the archive (see the
 * consultations audio route). The copy's own archive folder gets its
 * transcript and metadata, best effort, so Box recovery rebuilds it like any
 * other consultation; the recall's archive lands there later as usual.
 */

import { useState, type MouseEvent } from "react"
import { useRouter } from "next/navigation"
import { Copy, Loader2 } from "lucide-react"
import { Button } from "@ui/lib/ui/button"
import { cn } from "@ui/lib/utils"
import { useEncounters } from "@ui"
import { getEncounterAudio, getPatient, saveEncounterAudio } from "@storage"
import { createEncounter } from "@storage/encounters"
import type { Encounter } from "@storage/types"

/** What the copy takes from the original: the consultation as captured, not what was later made of it. */
export function duplicateFields(source: Encounter): Partial<Encounter> {
  return {
    patient_id: source.patient_id,
    patient_name: source.patient_name,
    visit_reason: source.visit_reason,
    mode: source.mode ?? "scribed",
    language: source.language,
    status: "completed",
    transcript_text: source.transcript_text,
    ...(source.transcript_confidence ? { transcript_confidence: source.transcript_confidence } : {}),
    ...(source.recall_analysis ? { recall_analysis: source.recall_analysis } : {}),
    ...(source.recording_duration !== undefined ? { recording_duration: source.recording_duration } : {}),
    ...(source.microphone_processing ? { microphone_processing: source.microphone_processing } : {}),
    // A copy of a copy points at the original, whose archive holds the recording.
    duplicated_from: source.duplicated_from ?? source.id,
  }
}

/**
 * The copy's archive folder: its transcript and metadata (no note), written
 * through the same route a consultation's note goes through. Returns the
 * archive fields to store on the copy; an outage marks it failed, like a
 * consultation's own archival would.
 */
async function archiveCopy(copy: Encounter, sessionId: string): Promise<Partial<Encounter>> {
  try {
    const res = await fetch("/api/archive/note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        encounter: {
          id: copy.id,
          patient_name: copy.patient_name,
          patient_id: copy.patient_id,
          patient_nhs_number: getPatient(copy.patient_id)?.nhs_number,
          visit_reason: copy.visit_reason,
          language: copy.language,
          created_at: copy.created_at,
          recording_duration: copy.recording_duration,
          microphone_processing: copy.microphone_processing,
          mode: copy.mode ?? "scribed",
          duplicated_from: copy.duplicated_from,
        },
        transcript: copy.transcript_text,
        keyterms: "",
      }),
    })
    if (!res.ok) throw new Error(`Archive failed (${res.status})`)
    const data = (await res.json()) as { skipped?: boolean; folderId?: string }
    if (data.skipped) return { archive_status: "skipped" }
    return { archive_status: "archived", archive_location: data.folderId, archived_at: new Date().toISOString() }
  } catch {
    return { archive_status: "failed" }
  }
}

/**
 * Makes the copy and opens its recall. The recording and the archive are
 * dealt with before the copy is listed, so it never appears half made.
 */
export function useDuplicateConsultation() {
  const router = useRouter()
  const { addEncounter } = useEncounters()
  const [duplicating, setDuplicating] = useState<string | null>(null)

  const duplicate = async (source: Encounter) => {
    if (duplicating) return
    setDuplicating(source.id)
    try {
      const copy = createEncounter(duplicateFields(source))
      const audio = await getEncounterAudio(source.id).catch(() => null)
      if (audio) await saveEncounterAudio(copy.id, audio)
      const archive = await archiveCopy(copy, source.session_id ?? "")
      await addEncounter({ ...copy, ...archive })
      router.push(`/recall/${copy.id}`)
    } finally {
      setDuplicating(null)
    }
  }

  return { duplicate, duplicating }
}

const TITLE = "Duplicate this consultation: a new one with the same transcript and recording, for another recall"

/** The action as a button: an icon in a list row, with its label elsewhere. */
export function DuplicateConsultationButton({
  encounter,
  label = false,
  className,
}: {
  encounter: Encounter
  /** Show "Duplicate" beside the icon. */
  label?: boolean
  className?: string
}) {
  const { duplicate, duplicating } = useDuplicateConsultation()
  const busy = duplicating === encounter.id
  const onClick = (event: MouseEvent) => {
    event.stopPropagation()
    void duplicate(encounter)
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={duplicating !== null}
      title={TITLE}
      className={cn("h-8 rounded-md border-border bg-card text-foreground shadow-none hover:bg-accent", label ? "px-3" : "w-8 px-0", className)}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
      {label ? <span className="ml-1.5 text-xs">Duplicate</span> : <span className="sr-only">Duplicate consultation</span>}
    </Button>
  )
}
