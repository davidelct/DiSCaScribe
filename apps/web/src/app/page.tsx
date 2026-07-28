"use client"

/**
 * EPR landing page: the practice's patient register. The register itself is
 * the static study cohort (see @storage/patients); per-patient consultation
 * activity comes from local encounter storage.
 */

import Link from "next/link"
import { ChevronRight, Users } from "lucide-react"
import { format } from "date-fns"
import { ErrorBoundary, useEncounters, useHttpsWarning } from "@ui"
import {
  PATIENTS,
  formatNhsNumber,
  patientAge,
  patientFullName,
} from "@storage"
import type { Encounter } from "@storage/types"
import { TopBar } from "./top-bar"

function PatientRegister() {
  const { encounters } = useEncounters()
  const httpsWarning = useHttpsWarning()

  const consultationsFor = (patientId: string): Encounter[] =>
    encounters.filter((e: Encounter) => e.patient_id === patientId)

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
            <h1 className="font-display text-2xl font-medium tracking-tight text-foreground">Patients</h1>
            <p className="mt-1 text-sm text-muted-foreground">Registered patients at the practice.</p>
          </div>
          <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {PATIENTS.length} registered
          </span>
        </div>

        <div className="animate-fade-up space-y-3">
          {PATIENTS.map((patient) => {
            const consults = consultationsFor(patient.id)
            const lastConsult = consults[0]
            return (
              <Link
                key={patient.id}
                href={`/patients/${patient.id}`}
                className="group flex items-center gap-5 rounded-2xl border border-border bg-card p-5 shadow-soft surface transition-all hover:border-primary/30 hover:shadow-lifted"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-soft font-display text-base font-medium text-primary">
                  {patient.given_name[0]}
                  {patient.family_name[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 className="font-display text-lg font-medium tracking-tight text-foreground">
                      {patientFullName(patient)}
                    </h2>
                    <span className="text-xs text-muted-foreground">
                      {patientAge(patient)} · {patient.sex === "male" ? "Male" : "Female"} · Born{" "}
                      {format(new Date(`${patient.date_of_birth}T00:00:00`), "d MMM yyyy")}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      NHS {formatNhsNumber(patient.nhs_number)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">{patient.summary}</p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <span className="hidden text-right text-xs text-muted-foreground sm:block">
                    {consults.length === 0 ? (
                      "No consultations"
                    ) : (
                      <>
                        {consults.length} consultation{consults.length === 1 ? "" : "s"}
                        {lastConsult && (
                          <span className="block text-muted-foreground/70">
                            Last {format(new Date(lastConsult.created_at), "d MMM yyyy")}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                  <ChevronRight className="h-5 w-5 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
              </Link>
            )
          })}
        </div>
      </main>
    </div>
  )
}

export default function HomePage() {
  return (
    <ErrorBoundary>
      <PatientRegister />
    </ErrorBoundary>
  )
}
