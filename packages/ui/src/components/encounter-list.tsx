"use client"

import type { Encounter } from "@storage/types"
import { cn } from "@ui/lib/utils"
import { Input } from "@ui/lib/ui/input"
import { Button } from "@ui/lib/ui/button"
import { ScrollArea } from "@ui/lib/ui/scroll-area"
import { Search, FileText, Clock, Plus, Trash2, Stethoscope } from "lucide-react"
import { useState, useMemo } from "react"
import { formatDistanceToNow } from "date-fns"

const VISIT_TYPE_LABELS: Record<string, string> = {
  history_physical: "History & Physical",
  problem_visit: "Problem Visit",
  consult_note: "Consult Note",
}

interface EncounterListProps {
  encounters: Encounter[]
  selectedId: string | null
  onSelect: (encounter: Encounter) => void
  onNewEncounter: () => void
  onDeleteEncounter?: (id: string) => void | Promise<void>
  disabled?: boolean
}

export function EncounterList({
  encounters,
  selectedId,
  onSelect,
  onNewEncounter,
  onDeleteEncounter,
  disabled,
}: EncounterListProps) {
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    if (!search.trim()) return encounters
    const q = search.toLowerCase()
    return encounters.filter(
      (e) =>
        e.patient_name.toLowerCase().includes(q) ||
        e.visit_reason.toLowerCase().includes(q) ||
        e.patient_id.toLowerCase().includes(q),
    )
  }, [encounters, search])

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand wordmark */}
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-soft">
          <Stethoscope className="h-4 w-4" />
        </span>
        <span className="font-display text-lg font-medium tracking-tight text-foreground">DiSCaScribe</span>
      </div>

      <div className="px-4 pb-4">
        <Button
          onClick={onNewEncounter}
          disabled={disabled}
          className="w-full justify-center gap-2 rounded-xl bg-primary text-primary-foreground shadow-soft transition-colors hover:bg-brand-strong"
        >
          <Plus className="h-4 w-4" />
          New Encounter
        </Button>
      </div>

      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search encounters…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 rounded-full border-transparent bg-background pl-10 text-foreground placeholder:text-muted-foreground"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="px-5 pb-2 pt-1">
        <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
          Encounters
        </h2>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-8 py-12 text-center">
            <FileText className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {encounters.length === 0 ? "No encounters yet" : "No matching encounters"}
            </p>
          </div>
        ) : (
          <div className="space-y-1 px-3 pb-3">
            {filtered.map((encounter) => {
              const isSelected = selectedId === encounter.id
              return (
                <div
                  key={encounter.id}
                  className={cn(
                    "group relative w-full rounded-xl text-left transition-all duration-200",
                    "hover:bg-sidebar-accent/70",
                    "focus-within:outline-none",
                    isSelected && "bg-card shadow-soft",
                  )}
                >
                  {/* teal active rail — small tab flush at the left edge */}
                  <span
                    className={cn(
                      "absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-primary transition-opacity duration-200",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <button
                    onClick={() => onSelect(encounter)}
                    disabled={disabled}
                    className={cn(
                      "w-full p-3 pl-4 text-left",
                      "focus-visible:outline-none",
                      "disabled:pointer-events-none disabled:opacity-50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 pr-8">
                        <p
                          className={cn(
                            "truncate text-sm font-medium",
                            isSelected ? "text-foreground" : "text-foreground/90",
                          )}
                        >
                          {encounter.patient_name || "Unknown patient"}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {VISIT_TYPE_LABELS[encounter.visit_reason] || encounter.visit_reason || "No reason specified"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground/80">
                      <Clock className="h-3 w-3" />
                      <span>
                        {formatDistanceToNow(new Date(encounter.created_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </button>
                  {onDeleteEncounter ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        void onDeleteEncounter(encounter.id)
                      }}
                      disabled={disabled}
                      aria-label="Delete encounter"
                      title="Delete encounter"
                      className={cn(
                        "absolute right-2.5 top-2.5 rounded-lg p-1.5 text-muted-foreground/60 opacity-0 transition-all",
                        "group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive",
                        "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                        "disabled:pointer-events-none disabled:opacity-50",
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
