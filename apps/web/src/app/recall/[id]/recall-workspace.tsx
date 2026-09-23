"use client"

/**
 * One consultation's stimulated-recall interview, reached from the recall
 * tab. The interview itself — the transcript with its question–answer
 * exchanges, the per-stop tables, the recall recording and its archival — is
 * the render package's StimulatedRecallView; this page frames it with the
 * consultation's identity and a way back, and lends it the server action
 * that detects exchanges for a consultation that has none yet.
 */

import { useCallback } from "react"
import Link from "next/link"
import { format } from "date-fns"
import { ArrowLeft, FileQuestion, Loader2 } from "lucide-react"
import { ErrorBoundary, useEncounters, useHttpsWarning } from "@ui"
import { cn } from "@ui/lib/utils"
import { StimulatedRecallView } from "@note-rendering"
import { getPatient, isLinkedToPatient, loadByokApiKeys } from "@storage"
import type { Encounter } from "@storage/types"
import { detectRecallExchanges } from "@/app/actions"
import { TopBar } from "../../top-bar"

function RecallWorkspaceContent({ encounterId }: { encounterId: string }) {
  const { encounters, loaded: encountersLoaded, updateEncounter } = useEncounters()
  const httpsWarning = useHttpsWarning()
  const encounter = encounters.find((e: Encounter) => e.id === encounterId)


  // Detection normally runs beside note generation; older consultations, and
  // any where it failed, get it here on first open.
  const detectExchanges = useCallback(
    async (transcript: string) => {
      const byokKeys = await loadByokApiKeys()
      const analysis = await detectRecallExchanges({ transcript }, { anthropicApiKey: byokKeys.anthropicApiKey })
      await updateEncounter(encounterId, { recall_analysis: analysis })
    },
    [encounterId, updateEncounter],
  )

  if (!encounter) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <TopBar />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          {encountersLoaded ? (
            <>
              <FileQuestion className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">This consultation does not exist.</p>
              <Link href="/recall" className="text-sm font-medium text-primary hover:underline">
                Back to stimulated recall
              </Link>
            </>
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>
    )
  }

  const linked = isLinkedToPatient(encounter)
  const patient = getPatient(encounter.patient_id)
  // Where "back" goes, as in the consultation workspace: the patient's chart
  // when there is one, otherwise the recall list (the only place an untied
  // consultation is listed). The tab in the top bar always leads to the list.
  const back = patient
    ? { href: `/patients/${patient.id}`, title: `Back to ${encounter.patient_name}'s chart` }
    : { href: "/recall", title: "Back to stimulated recall" }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {httpsWarning && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-destructive px-4 py-2 text-center text-sm font-semibold text-destructive-foreground">
          {httpsWarning}
        </div>
      )}
      <TopBar />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Same identity row as the consultation workspace, so the clinician
            knows whose consultation they are stepping back through. */}
        <div className="shrink-0 border-b border-border bg-card/60 px-6 py-2 backdrop-blur-sm">
          <div className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1">
            <Link
              href={back.href}
              title={back.title}
              className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h2
              className={cn(
                "font-display truncate text-base font-medium tracking-tight",
                linked ? "text-foreground" : "italic text-muted-foreground",
              )}
            >
              {linked ? encounter.patient_name || "Unknown Patient" : "Unregistered patient"}
            </h2>
            <span className="text-xs font-medium text-muted-foreground">Stimulated recall</span>
            <div className="ml-auto flex min-w-0 items-center gap-x-2 text-xs text-muted-foreground">
              <span className="whitespace-nowrap">{format(new Date(encounter.created_at), "d MMM yyyy, HH:mm")}</span>
              {encounter.visit_reason && (
                <>
                  <span className="text-border">·</span>
                  <span className="truncate">{encounter.visit_reason}</span>
                </>
              )}
            </div>
          </div>
        </div>
        {/* The two columns scroll on their own from lg up; narrower than
            that they stack and the page scrolls. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4 lg:overflow-hidden">
          <StimulatedRecallView encounter={encounter} detectExchanges={detectExchanges} />
        </div>
      </main>
    </div>
  )
}

export function RecallWorkspace({ encounterId }: { encounterId: string }) {
  return (
    <ErrorBoundary>
      <RecallWorkspaceContent encounterId={encounterId} />
    </ErrorBoundary>
  )
}
