"use client"

/**
 * The list controls shared by the consultation lists (consultations tab,
 * stimulated recall): a field picker joined to the query box, the same
 * control the patient register uses, and the registration filter.
 */

import { Search } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/lib/ui/select"
import { cn } from "@ui/lib/utils"
import { isLinkedToPatient } from "@storage"
import type { Encounter } from "@storage/types"

export type ConsultationSearchField = "patient" | "reason"

const PLACEHOLDERS: Record<ConsultationSearchField, string> = {
  patient: "Search by patient",
  reason: "Search by reason",
}

export function matchesConsultation(encounter: Encounter, field: ConsultationSearchField, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const haystack = field === "patient" ? encounter.patient_name : encounter.visit_reason || ""
  return haystack.toLowerCase().includes(needle)
}

/**
 * Whether the patient at the consultation was on the register. Every
 * consultation had a patient in the room; what varies is whether their
 * record was known and chosen at the start.
 */
export type RegistrationFilter = "all" | "registered" | "unregistered"

const REGISTRATION_FILTER_LABELS: Record<RegistrationFilter, string> = {
  all: "All",
  registered: "Registered",
  unregistered: "Unregistered",
}

export function matchesRegistration(encounter: Encounter, filter: RegistrationFilter): boolean {
  if (filter === "registered") return isLinkedToPatient(encounter)
  if (filter === "unregistered") return !isLinkedToPatient(encounter)
  return true
}

export function RegistrationFilterGroup({
  value,
  onChange,
}: {
  value: RegistrationFilter
  onChange: (value: RegistrationFilter) => void
}) {
  return (
    <div className="flex h-9 items-center gap-0.5 rounded-md bg-muted p-0.5" role="group" aria-label="Filter by patient registration">
      {(["all", "registered", "unregistered"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "h-8 rounded-sm px-3 text-xs font-medium transition-colors",
            value === option ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {REGISTRATION_FILTER_LABELS[option]}
        </button>
      ))}
    </div>
  )
}

export function ConsultationSearch({
  field,
  onFieldChange,
  query,
  onQueryChange,
}: {
  field: ConsultationSearchField
  onFieldChange: (field: ConsultationSearchField) => void
  query: string
  onQueryChange: (query: string) => void
}) {
  return (
    <div className="flex h-9 min-w-64 max-w-xl flex-1 items-center rounded-md border border-border bg-card shadow-soft transition-colors focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring/30">
      <Select value={field} onValueChange={(value) => onFieldChange(value as ConsultationSearchField)}>
        <SelectTrigger
          aria-label="Search field"
          className="h-full w-auto shrink-0 rounded-l-md rounded-r-none border-0 border-r border-border bg-transparent pl-3 pr-2.5 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start" className="min-w-36">
          <SelectItem value="patient">Patient</SelectItem>
          <SelectItem value="reason">Reason</SelectItem>
        </SelectContent>
      </Select>
      <Search className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" />
      <input
        placeholder={PLACEHOLDERS[field]}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        aria-label="Search consultations"
        className="h-full w-full rounded-r-md bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}
