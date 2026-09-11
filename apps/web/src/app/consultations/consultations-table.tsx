"use client"

/**
 * The consultations tab: every consultation on this device in one table,
 * newest first, tied to a patient or not. The patient register answers "what
 * has happened to this patient?"; this answers "what have I recorded?", and
 * it is where a consultation starts when there is no patient to start it from.
 */

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { ClipboardList, Plus, Search, Trash2 } from "lucide-react"
import { Button } from "@ui/lib/ui/button"
import { ErrorBoundary, useEncounters, useHttpsWarning } from "@ui"
import { cn } from "@ui/lib/utils"
import { deleteEncounterAudio, isLinkedToPatient } from "@storage"
import type { Encounter } from "@storage/types"
import { formatConsultationLength } from "@/lib/consultation-display"
import { ModeBadge, StatusBadge } from "../consultation-badges"
import { StartConsultationDialog, useLaunchConsultation } from "../start-consultation-dialog"
import { TopBar } from "../top-bar"

type LinkFilter = "all" | "linked" | "unlinked"

const LINK_FILTER_LABELS: Record<LinkFilter, string> = {
  all: "All",
  linked: "With patient",
  unlinked: "No patient",
}

function matchesQuery(encounter: Encounter, query: string): boolean {
  if (!query) return true
  return (
    encounter.patient_name.toLowerCase().includes(query) ||
    (encounter.visit_reason || "").toLowerCase().includes(query)
  )
}

function ConsultationsContent() {
  const router = useRouter()
  const { encounters, deleteEncounter } = useEncounters()
  const httpsWarning = useHttpsWarning()
  const { launch, starting } = useLaunchConsultation()
  const [showStartDialog, setShowStartDialog] = useState(false)
  const [query, setQuery] = useState("")
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all")

  const normalizedQuery = query.trim().toLowerCase()
  const consultations = encounters
    .filter((e: Encounter) => {
      if (linkFilter === "linked" && !isLinkedToPatient(e)) return false
      if (linkFilter === "unlinked" && isLinkedToPatient(e)) return false
      return matchesQuery(e, normalizedQuery)
    })
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
          starting={starting}
          onCancel={() => setShowStartDialog(false)}
          onRecord={(patient, reason) => void launch(patient, reason, { action: "record" })}
          onUpload={(patient, reason, file) => void launch(patient, reason, { action: "upload", file })}
        />
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-medium tracking-tight text-foreground">Consultations</h1>
            <p className="mt-1 text-sm text-muted-foreground">Every consultation recorded on this device.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs text-muted-foreground">
              <ClipboardList className="h-3.5 w-3.5" />
              {encounters.length} recorded
            </span>
            <Button
              onClick={() => setShowStartDialog(true)}
              disabled={starting}
              className="rounded-md bg-primary px-4 text-primary-foreground shadow-soft hover:bg-brand-strong"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              New
            </Button>
          </div>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex h-9 min-w-64 max-w-xl flex-1 items-center rounded-md border border-border bg-card shadow-soft transition-colors focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring/30">
            <Search className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              placeholder="Search by patient or reason"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search consultations"
              className="h-full w-full rounded-md bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex h-9 items-center gap-0.5 rounded-md bg-muted p-0.5" role="group" aria-label="Filter by patient link">
            {(["all", "linked", "unlinked"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setLinkFilter(value)}
                className={cn(
                  "h-8 rounded-sm px-3 text-xs font-medium transition-colors",
                  linkFilter === value ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {LINK_FILTER_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        {consultations.length === 0 ? (
          <div className="animate-fade-up flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-card/50 px-8 py-12 text-center">
            <ClipboardList className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {encounters.length === 0
                ? "No consultations yet. Start one with New."
                : "No consultations match the current search and filter."}
            </p>
          </div>
        ) : (
          <div className="animate-fade-up overflow-x-auto rounded-md border border-border bg-card shadow-soft surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">When</th>
                  <th className="px-3 py-3 font-medium">Patient</th>
                  <th className="px-3 py-3 font-medium">Reason</th>
                  <th className="px-3 py-3 font-medium">Length</th>
                  <th className="px-3 py-3 font-medium">Mode</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {consultations.map((consultation: Encounter) => {
                  const linked = isLinkedToPatient(consultation)
                  const href = `/consultations/${consultation.id}`
                  return (
                    <tr
                      key={consultation.id}
                      onClick={() => router.push(href)}
                      className="group cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-accent/40"
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
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {linked ? (
                          <Link
                            href={`/patients/${consultation.patient_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-foreground hover:text-primary hover:underline"
                          >
                            {consultation.patient_name || "Unknown patient"}
                          </Link>
                        ) : (
                          <span className="italic text-muted-foreground">No patient</span>
                        )}
                      </td>
                      <td className="max-w-xs truncate px-3 py-2.5 text-muted-foreground">
                        {consultation.visit_reason || "No reason recorded"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-foreground">
                        {formatConsultationLength(consultation.recording_duration)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <ModeBadge mode={consultation.mode} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <StatusBadge encounter={consultation} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {consultation.approval_status !== "approved" && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleDelete(consultation.id)
                            }}
                            aria-label="Delete consultation"
                            title="Delete consultation"
                            className="rounded-lg p-1.5 text-muted-foreground/60 opacity-0 transition-all group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

export function ConsultationsTable() {
  return (
    <ErrorBoundary>
      <ConsultationsContent />
    </ErrorBoundary>
  )
}
