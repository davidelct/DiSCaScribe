/**
 * The two badges every consultation carries, at one size everywhere they
 * appear (consultations table, chart history, note editor header): capture
 * mode and lifecycle status.
 */

import { Badge } from "@ui/lib/ui/badge"
import { cn } from "@ui/lib/utils"
import type { Encounter } from "@storage/types"
import { consultationStatus } from "@/lib/consultation-display"

export function StatusBadge({ encounter }: { encounter: Encounter }) {
  const status = consultationStatus(encounter)
  return (
    <Badge variant="outline" className={status.className}>
      {status.label}
    </Badge>
  )
}

export function ModeBadge({ mode }: { mode: Encounter["mode"] }) {
  const recordingOnly = mode === "recording_only"
  return (
    <Badge
      variant="outline"
      className={cn(
        recordingOnly ? "border-success/30 bg-success/5 text-success" : "border-primary/25 bg-brand-soft/50 text-primary",
      )}
    >
      {recordingOnly ? "Recording only" : "Scribed"}
    </Badge>
  )
}
