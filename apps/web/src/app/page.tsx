"use client"

/**
 * EPR landing page: the practice's patient register. The register itself is
 * the static study cohort (see @storage/patients); per-patient consultation
 * activity comes from local encounter storage.
 */

import { useState } from "react"
import Link from "next/link"
import { ChevronRight, Search, Users } from "lucide-react"
import { format } from "date-fns"
import { ErrorBoundary, useEncounters, useHttpsWarning } from "@ui"
import { cn } from "@ui/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/lib/ui/select"
import {
  PATIENTS,
  formatNhsNumber,
  patientAge,
  patientFullName,
  searchPatients,
  type PatientSearchField,
} from "@storage"
import type { Encounter } from "@storage/types"
import { TopBar } from "./top-bar"

const SEARCH_PLACEHOLDERS: Record<PatientSearchField, string> = {
  name: "Search by name",
  nhs_number: "Search by NHS number",
  date_of_birth: "Search by date of birth",
}

type SexFilter = "all" | "male" | "female"

function PatientRegister() {
  const { encounters } = useEncounters()
  const httpsWarning = useHttpsWarning()
  const [query, setQuery] = useState("")
  const [searchField, setSearchField] = useState<PatientSearchField>("name")
  const [sexFilter, setSexFilter] = useState<SexFilter>("all")
  const patients = searchPatients({
    query,
    field: searchField,
    sex: sexFilter === "all" ? undefined : sexFilter,
  })

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

        <div className="mb-5 flex flex-wrap items-center gap-3">
          {/* Joined control: field picker + query input share one search bar. */}
          <div className="flex h-11 min-w-64 max-w-xl flex-1 items-center rounded-full border border-border bg-card shadow-soft transition-colors focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring/30">
            <Select value={searchField} onValueChange={(value) => setSearchField(value as PatientSearchField)}>
              <SelectTrigger
                aria-label="Search field"
                className="h-full w-auto shrink-0 rounded-l-full rounded-r-none border-0 border-r border-border bg-transparent pl-4 pr-3 text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" className="min-w-44">
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="nhs_number">NHS number</SelectItem>
                <SelectItem value="date_of_birth">Date of birth</SelectItem>
              </SelectContent>
            </Select>
            <Search className="ml-3.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              placeholder={SEARCH_PLACEHOLDERS[searchField]}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search patients"
              className="h-full w-full rounded-r-full bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex items-center gap-1 rounded-full bg-muted p-1" role="group" aria-label="Filter by sex">
            {(["all", "male", "female"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSexFilter(value)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                  sexFilter === value
                    ? "bg-card text-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {value === "all" ? "All" : value === "male" ? "Male" : "Female"}
              </button>
            ))}
          </div>
        </div>

        {patients.length === 0 && (
          <div className="animate-fade-up flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card/50 px-8 py-12 text-center">
            <Search className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No patients match the current search and filters.</p>
          </div>
        )}

        <div className="animate-fade-up space-y-3">
          {patients.map((patient) => {
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
