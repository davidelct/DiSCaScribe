"use client"

/**
 * EPR landing page: the practice's patient register, one row per patient.
 * The register itself is the static study cohort (see @storage/patients);
 * per-patient consultation activity comes from local encounter storage. The
 * registration summary stays on the chart, so the register reads as a list
 * to find someone in, not a stack of notes.
 */

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
  const router = useRouter()
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
    encounters
      .filter((e: Encounter) => e.patient_id === patientId)
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
            <h1 className="font-display text-2xl font-medium tracking-tight text-foreground">Patients</h1>
            <p className="mt-1 text-sm text-muted-foreground">Registered patients at the practice.</p>
          </div>
          <span className="flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {PATIENTS.length} registered
          </span>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          {/* Joined control: field picker + query input share one search bar. */}
          <div className="flex h-9 min-w-64 max-w-xl flex-1 items-center rounded-md border border-border bg-card shadow-soft transition-colors focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring/30">
            <Select value={searchField} onValueChange={(value) => setSearchField(value as PatientSearchField)}>
              <SelectTrigger
                aria-label="Search field"
                className="h-full w-auto shrink-0 rounded-l-md rounded-r-none border-0 border-r border-border bg-transparent pl-3 pr-2.5 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" className="min-w-44">
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="nhs_number">NHS number</SelectItem>
                <SelectItem value="date_of_birth">Date of birth</SelectItem>
              </SelectContent>
            </Select>
            <Search className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              placeholder={SEARCH_PLACEHOLDERS[searchField]}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search patients"
              className="h-full w-full rounded-r-md bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex h-9 items-center gap-0.5 rounded-md bg-muted p-0.5" role="group" aria-label="Filter by sex">
            {(["all", "male", "female"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSexFilter(value)}
                className={cn(
                  "h-8 rounded-sm px-3 text-xs font-medium transition-colors",
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

        {patients.length === 0 ? (
          <div className="animate-fade-up flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-card/50 px-8 py-12 text-center">
            <Search className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No patients match the current search and filters.</p>
          </div>
        ) : (
          <div className="animate-fade-up overflow-x-auto rounded-md border border-border bg-card shadow-soft surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Patient</th>
                  <th className="px-3 py-3 font-medium">Age</th>
                  <th className="px-3 py-3 font-medium">Sex</th>
                  <th className="px-3 py-3 font-medium">Date of birth</th>
                  <th className="px-3 py-3 font-medium">NHS number</th>
                  <th className="px-3 py-3 font-medium">Consultations</th>
                  <th className="px-3 py-3">
                    <span className="sr-only">Open chart</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {patients.map((patient) => {
                  const consults = consultationsFor(patient.id)
                  const lastConsult = consults[0]
                  const href = `/patients/${patient.id}`
                  return (
                    <tr
                      key={patient.id}
                      onClick={() => router.push(href)}
                      className="group cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-accent/40"
                    >
                      <td className="whitespace-nowrap px-5 py-2.5">
                        <Link
                          href={href}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-3 font-medium text-foreground hover:text-primary"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-soft text-xs font-medium text-primary">
                            {patient.given_name[0]}
                            {patient.family_name[0]}
                          </span>
                          {patientFullName(patient)}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-foreground">{patientAge(patient)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                        {patient.sex === "male" ? "Male" : "Female"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                        {format(new Date(`${patient.date_of_birth}T00:00:00`), "d MMM yyyy")}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-foreground">
                        {formatNhsNumber(patient.nhs_number)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                        {consults.length === 0 ? (
                          "None"
                        ) : (
                          <>
                            <span className="text-foreground">{consults.length}</span>
                            {lastConsult && ` · last ${format(new Date(lastConsult.created_at), "d MMM yyyy")}`}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <ChevronRight className="inline h-4 w-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
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

export default function HomePage() {
  return (
    <ErrorBoundary>
      <PatientRegister />
    </ErrorBoundary>
  )
}
