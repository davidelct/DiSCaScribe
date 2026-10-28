"use client"

import { useState, type ReactNode } from "react"
import type { Encounter, NoteArchiveStatus, NoteVersion } from "@storage/types"
import { isLinkedToPatient } from "@storage"
import { Button } from "@ui/lib/ui/button"
import { Badge } from "@ui/lib/ui/badge"
import { Check, ChevronDown, FileCheck, History, Loader2, RotateCcw, X } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@ui/lib/utils"
import { MarkdownNote } from "./markdown-note"
import { parseNoteSections, type NoteSection } from "../note-sections"

/**
 * The pieces both consultation layouts share: the scribed note editor and the
 * recording-only arm's EHR-style note form.
 */

export const CARD = "rounded-2xl border border-border bg-card shadow-soft"
export const CARD_HEAD = "flex min-h-8 flex-wrap items-center gap-2 px-5 py-3"
export const CARD_BODY = "border-t border-border px-5 py-4"

const SOAP_TITLES = ["Subjective", "Objective", "Assessment", "Plan"]

export const VERSION_SOURCE_LABELS: Record<NoteVersion["source"], string> = {
  generated: "AI draft",
  manual: "Written by clinician",
  edited: "Clinician edit",
  approved: "Approved & filed",
}

/** Reassemble section bodies into the canonical SOAP markdown shape. */
export function sectionsToMarkdown(preamble: string, sections: NoteSection[]): string {
  const body =
    sections
      .map((section) => (section.body.trim() ? `## ${section.title}\n\n${section.body.trim()}` : `## ${section.title}`))
      .join("\n\n") + "\n"
  return preamble.trim() ? `${preamble.trim()}\n\n${body}` : body
}

/** Empty four-section scaffold for a manually written note. */
export function emptySoapSections(): NoteSection[] {
  return SOAP_TITLES.map((title) => ({ title, body: "" }))
}

/**
 * Renders the note as its level-2 (SOAP) sections. Falls back to plain
 * whole-note rendering when the note has no sections.
 */
export function SectionedNote({ source }: { source: string }) {
  const { preamble, sections } = parseNoteSections(source)

  if (sections.length === 0) {
    return <MarkdownNote source={source} />
  }

  return (
    <div className="[&>*+*]:mt-8">
      {preamble && <MarkdownNote source={preamble} className="[&>*:first-child]:mt-0" />}
      {sections.map((section) => (
        <section key={section.title}>
          <h2 className="mb-3 border-b border-border pb-2 font-display text-xl font-medium tracking-tight text-foreground">
            {section.title}
          </h2>
          {section.body.trim() ? (
            <MarkdownNote source={section.body} className="[&>*:first-child]:mt-0" />
          ) : (
            <p className="my-3 text-sm italic text-muted-foreground">Empty</p>
          )}
        </section>
      ))}
    </div>
  )
}

/** A failed pipeline step, shown above the stages with its retry action. */
export function CaptureErrorRow({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-3">
      <X className="h-4 w-4 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1 text-sm text-destructive">{message}</p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="h-8 shrink-0 rounded-md border-destructive/40 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          <span className="text-xs">Retry</span>
        </Button>
      )}
    </div>
  )
}

/**
 * One row: back, who, whether the note is filed, anything the layout adds
 * (the scribed arm's stage strip), and when on the right.
 */
export function ConsultationHeader({
  encounter,
  backLink,
  children,
}: {
  encounter: Encounter
  backLink?: ReactNode
  children?: ReactNode
}) {
  const linked = isLinkedToPatient(encounter)
  return (
    <div className="shrink-0 border-b border-border bg-card/60 px-6 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
        {backLink}
        <h2
          className={cn(
            "font-display truncate text-base font-medium tracking-tight",
            linked ? "text-foreground" : "italic text-muted-foreground",
          )}
        >
          {linked ? encounter.patient_name || "Unknown Patient" : "Unregistered patient"}
        </h2>
        {encounter.approval_status === "approved" && (
          <Badge className="rounded-md border-success/30 bg-success/10 text-xs font-semibold text-success">
            <FileCheck className="mr-1 h-3 w-3" />
            Filed
            {encounter.approved_at ? ` ${format(new Date(encounter.approved_at), "d MMM, HH:mm")}` : ""}
          </Badge>
        )}
        {children}
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
  )
}

/**
 * The current version's number with its archive state, opening the note
 * trail. Choosing a version shows it read-only; choosing the current one
 * returns to it (null).
 */
export function NoteVersionMenu({
  versions,
  currentVersion,
  archiveStatus,
  viewing,
  onSelect,
}: {
  versions: NoteVersion[]
  currentVersion: number
  archiveStatus?: NoteArchiveStatus
  viewing: NoteVersion | null
  onSelect: (version: NoteVersion | null) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          archiveStatus === "pending"
            ? "Saving this version to the archive…"
            : archiveStatus === "archived"
              ? "This version is saved to the archive"
              : archiveStatus === "failed"
                ? "Archiving this version failed"
                : archiveStatus === "skipped"
                  ? "Archiving not configured — stored locally only"
                  : "Note version history"
        }
        className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <History className="h-3 w-3" />v{currentVersion}
        {archiveStatus === "pending" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
        {archiveStatus === "archived" && <Check className="h-3 w-3 text-success" />}
        {archiveStatus === "failed" && <X className="h-3 w-3 text-destructive" />}
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-72 rounded-xl border border-border bg-popover p-1.5 shadow-lifted">
          {[...versions].reverse().map((version) => {
            const isCurrent = version.version === currentVersion && !viewing
            const isViewing = viewing?.version === version.version
            return (
              <button
                key={version.version}
                type="button"
                onClick={() => {
                  onSelect(version.version === currentVersion ? null : version)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-baseline gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent",
                  (isCurrent || isViewing) && "bg-accent/60",
                )}
              >
                <span className="font-mono text-xs text-foreground">v{version.version}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {VERSION_SOURCE_LABELS[version.source]}
                </span>
                <span className="shrink-0 text-[0.65rem] text-muted-foreground/70">
                  {format(new Date(version.created_at), "HH:mm")}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Above an older version opened from the trail: what it is, and the way back. */
export function ViewingVersionBanner({ version, onBack }: { version: NoteVersion; onBack: () => void }) {
  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-accent/40 px-4 py-2.5">
      <History className="h-4 w-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        Viewing v{version.version} · {VERSION_SOURCE_LABELS[version.source]} ·{" "}
        {format(new Date(version.created_at), "d MMM, HH:mm")} — read-only
      </p>
      <Button variant="outline" size="sm" onClick={onBack} className="h-8 shrink-0 rounded-md px-3">
        <span className="text-xs">Back to latest</span>
      </Button>
    </div>
  )
}
