"use client"

/**
 * The stimulated recall tab: every consultation on this device, with where
 * its recall interview stands and a way in. The interview walks the
 * transcript utterance by utterance, so a consultation without a transcript
 * is listed but cannot be started.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { MessageSquareQuote, Play } from "lucide-react"
import { Badge } from "@ui/lib/ui/badge"
import { Button } from "@ui/lib/ui/button"
import { ErrorBoundary, useEncounters, useHttpsWarning } from "@ui"
import { cn } from "@ui/lib/utils"
import { getRecallSessionSummary, type RecallSessionSummary } from "@note-rendering"
import { isLinkedToPatient } from "@storage"
import type { Encounter } from "@storage/types"
import { formatConsultationDuration } from "@/lib/consultation-display"
import {
  ConsultationSearch,
  RegistrationFilterGroup,
  matchesConsultation,
  matchesRegistration,
  type ConsultationSearchField,
  type RegistrationFilter,
} from "../consultation-search"
import { TopBar } from "../top-bar"

interface RecallStage {
  label: string
  className: string
  /** The button that takes the clinician in; null when recall cannot run. */
  action: "Start" | "Continue" | "Open" | null
}

function recallStage(summary: RecallSessionSummary | undefined, hasTranscript: boolean): RecallStage {
  if (!hasTranscript) {
    return { label: "No transcript", className: "border-border bg-muted text-muted-foreground", action: null }
  }
  if (!summary) return { label: "Loading", className: "border-border bg-muted text-muted-foreground", action: null }
  if (summary.archivedAt) {
    return { label: "Archived", className: "border-success/30 bg-success/10 text-success", action: "Open" }
  }
  if (summary.recorded) {
    return { label: "Recorded", className: "border-primary/25 bg-brand-soft/50 text-primary", action: "Open" }
  }
  if (summary.hypotheses > 0 || summary.rated > 0) {
    return {
      label: `In progress · ${summary.rated} rated`,
      className: "border-warning/40 bg-warning/10 text-warning-foreground",
      action: "Continue",
    }
  }
  return { label: "Not started", className: "border-border bg-muted text-muted-foreground", action: "Start" }
}

function RecallContent() {
  const router = useRouter()
  const { encounters } = useEncounters()
  const httpsWarning = useHttpsWarning()
  const [query, setQuery] = useState("")
  const [searchField, setSearchField] = useState<ConsultationSearchField>("patient")
  const [registration, setRegistration] = useState<RegistrationFilter>("all")
  const [summaries, setSummaries] = useState<Record<string, RecallSessionSummary>>({})

  // Each session lives in its own encrypted entry, so the stages load a beat
  // after the rows; a row shows "Loading" until its own summary is in.
  useEffect(() => {
    let cancelled = false
    const pending = encounters.filter((e: Encounter) => !(e.id in summaries) && e.transcript_text?.trim())
    if (pending.length === 0) return
    void Promise.all(
      pending.map(async (e: Encounter) => [e.id, await getRecallSessionSummary(e.id)] as const),
    ).then((loaded) => {
      if (cancelled) return
      setSummaries((current) => ({ ...current, ...Object.fromEntries(loaded) }))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounters])

  const consultations = encounters
    .filter((e: Encounter) => matchesRegistration(e, registration) && matchesConsultation(e, searchField, query))
    .sort((a: Encounter, b: Encounter) => b.created_at.localeCompare(a.created_at))

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {httpsWarning && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-destructive px-4 py-2 text-center text-sm font-semibold text-destructive-foreground">
          {httpsWarning}
        </div>
      )}
      <TopBar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-medium tracking-tight text-foreground">Stimulated recall</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Step back through a consultation and rate how each cue shaped your thinking.
            </p>
          </div>
          <span className="flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs text-muted-foreground">
            <MessageSquareQuote className="h-3.5 w-3.5" />
            {encounters.length} consultation{encounters.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <ConsultationSearch field={searchField} onFieldChange={setSearchField} query={query} onQueryChange={setQuery} />
          <RegistrationFilterGroup value={registration} onChange={setRegistration} />
        </div>

        {consultations.length === 0 ? (
          <div className="animate-fade-up flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-card/50 px-8 py-12 text-center">
            <MessageSquareQuote className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {encounters.length === 0
                ? "No consultations yet. Record one first, then come back to recall it."
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
                  <th className="px-3 py-3 font-medium">Duration</th>
                  <th className="px-3 py-3 font-medium">Recall</th>
                  <th className="px-3 py-3">
                    <span className="sr-only">Open recall</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {consultations.map((consultation: Encounter) => {
                  const hasTranscript = Boolean(consultation.transcript_text?.trim())
                  const stage = recallStage(summaries[consultation.id], hasTranscript)
                  const href = `/recall/${consultation.id}`
                  const open = () => {
                    if (stage.action) router.push(href)
                  }
                  return (
                    <tr
                      key={consultation.id}
                      onClick={open}
                      className={cn(
                        "group border-b border-border/60 transition-colors last:border-0",
                        stage.action ? "cursor-pointer hover:bg-accent/40" : "text-muted-foreground",
                      )}
                    >
                      <td className="whitespace-nowrap px-5 py-2.5">
                        <span className="font-medium text-foreground">
                          {format(new Date(consultation.created_at), "d MMM yyyy")}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {format(new Date(consultation.created_at), "HH:mm")}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {isLinkedToPatient(consultation) ? (
                          <Link
                            href={`/patients/${consultation.patient_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-foreground hover:text-primary hover:underline"
                          >
                            {consultation.patient_name || "Unknown patient"}
                          </Link>
                        ) : (
                          <span className="italic text-muted-foreground">Unregistered</span>
                        )}
                      </td>
                      <td className="max-w-xs truncate px-3 py-2.5 text-muted-foreground">
                        {consultation.visit_reason || "No reason recorded"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-foreground">
                        {formatConsultationDuration(consultation.recording_duration)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <Badge variant="outline" className={stage.className}>
                          {stage.label}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {stage.action && (
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              router.push(href)
                            }}
                            className={cn(
                              "h-8 rounded-md px-3",
                              stage.action === "Start"
                                ? "bg-primary text-primary-foreground shadow-soft hover:bg-brand-strong"
                                : "border border-border bg-card text-foreground shadow-none hover:bg-accent",
                            )}
                          >
                            <Play className="mr-1.5 h-3.5 w-3.5" />
                            {stage.action}
                          </Button>
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

export function RecallTable() {
  return (
    <ErrorBoundary>
      <RecallContent />
    </ErrorBoundary>
  )
}
