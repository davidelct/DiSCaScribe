"use client"

import { useState, useEffect, useRef, type ReactNode } from "react"
import type { Encounter, NoteVersion } from "@storage/types"
import { getPatient, formatNhsNumber, isLinkedToPatient, noteVersionsOf } from "@storage"
import { Button } from "@ui/lib/ui/button"
import { Textarea } from "@ui/lib/ui/textarea"
import { Badge } from "@ui/lib/ui/badge"
import {
  Save,
  Check,
  Loader2,
  Pencil,
  RotateCcw,
  X,
  FileCheck,
  History,
  ChevronDown,
} from "lucide-react"
import { format } from "date-fns"
import { cn } from "@ui/lib/utils"
import { MarkdownNote } from "./markdown-note"
import { TranscriptView } from "./transcript-view"
import { TranscriptSkeleton } from "./transcript-skeleton"
import { AudioPlayer } from "./audio-player"
import { RecordingBar } from "./recording-bar"
import { parseNoteSections, type NoteSection } from "../note-sections"
import { StimulatedRecallView } from "./stimulated-recall-view"

export type CaptureStepStatus = "pending" | "in-progress" | "done" | "failed"

/**
 * Live pipeline state for the encounter currently being captured. Present only
 * while this encounter is recording or processing; the Capture tab renders the
 * recording bar / generation progress from it, so the clinician stays in one
 * view from first word to finished note.
 */
export interface LiveCaptureState {
  phase: "recording" | "processing"
  /** Recording phase. */
  duration?: number
  isPaused?: boolean
  analyser?: AnalyserNode | null
  onStop?: () => void
  onPause?: () => void
  onResume?: () => void
  /** Processing phase. */
  transcriptionStatus?: CaptureStepStatus
  noteGenerationStatus?: CaptureStepStatus
  transcriptionErrorMessage?: string
  onRetryTranscription?: () => void
  onRetryNoteGeneration?: () => void
}

interface NoteEditorProps {
  encounter: Encounter
  /** Persist an edit (or the first manual note) as the next version. */
  onSave: (noteText: string) => void
  /** File this note to the patient record; the consultation locks after. */
  onApprove: (noteText: string) => void
  live?: LiveCaptureState
  /** Navigation element rendered before the patient name (back to chart). */
  backLink?: ReactNode
}

type TabType = "capture" | "note" | "recall"

const SOAP_TITLES = ["Subjective", "Objective", "Assessment", "Plan"]

const VERSION_SOURCE_LABELS: Record<NoteVersion["source"], string> = {
  generated: "AI draft",
  manual: "Written by clinician",
  edited: "Clinician edit",
  approved: "Approved & filed",
}

/** Reassemble section bodies into the canonical SOAP markdown shape. */
function sectionsToMarkdown(preamble: string, sections: NoteSection[]): string {
  const body =
    sections
      .map((section) => (section.body.trim() ? `## ${section.title}\n\n${section.body.trim()}` : `## ${section.title}`))
      .join("\n\n") + "\n"
  return preamble.trim() ? `${preamble.trim()}\n\n${body}` : body
}

/** Empty four-section scaffold for a manually written note. */
function emptySoapSections(): NoteSection[] {
  return SOAP_TITLES.map((title) => ({ title, body: "" }))
}

/**
 * Renders the note as its level-2 (SOAP) sections. Falls back to plain
 * whole-note rendering when the note has no sections.
 */
function SectionedNote({ source }: { source: string }) {
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

/** A failed pipeline step, shown in the capture flow with its retry action. */
function CaptureErrorRow({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-3">
      <X className="h-4 w-4 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1 text-sm text-destructive">{message}</p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="h-8 shrink-0 rounded-full border-destructive/40 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          <span className="text-xs">Retry</span>
        </Button>
      )}
    </div>
  )
}

export function NoteEditor({ encounter, onSave, onApprove, live, backLink }: NoteEditorProps) {
  const recordingOnly = encounter.mode === "recording_only"
  const approved = encounter.approval_status === "approved"
  const hasNote = Boolean(encounter.note_text?.trim())
  const hasTranscript = Boolean(encounter.transcript_text?.trim())
  const versions = noteVersionsOf(encounter)
  const linked = isLinkedToPatient(encounter)
  const patient = getPatient(encounter.patient_id)

  const [activeTab, setActiveTab] = useState<TabType>(hasNote ? "note" : "capture")
  const [noteMode, setNoteMode] = useState<"preview" | "edit">("preview")
  const [noteMarkdown, setNoteMarkdown] = useState<string>(encounter.note_text || "")
  // Per-section edit buffers. Null while previewing, and also null in edit
  // mode when the note has no ## sections (legacy notes fall back to a raw
  // markdown textarea).
  const [editSections, setEditSections] = useState<NoteSection[] | null>(null)
  const [editPreamble, setEditPreamble] = useState("")
  const [hasChanges, setHasChanges] = useState(false)
  // Read-only view of an older version from the trail; null = current note.
  const [viewingVersion, setViewingVersion] = useState<NoteVersion | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const prevNoteRef = useRef<string>(encounter.note_text || "")

  // Reset the view when switching encounters.
  useEffect(() => {
    setNoteMode("preview")
    setHasChanges(false)
    setEditSections(null)
    setViewingVersion(null)
    setShowHistory(false)
    setActiveTab(encounter.note_text?.trim() ? "note" : "capture")
    prevNoteRef.current = encounter.note_text || ""
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounter.id])

  // Keep the editable markdown in sync with the stored note, and auto-advance
  // from Capture to the note the moment generation delivers it.
  useEffect(() => {
    setNoteMarkdown(encounter.note_text || "")
    const hadNote = Boolean(prevNoteRef.current?.trim())
    const hasNoteNow = Boolean(encounter.note_text?.trim())
    if (!hadNote && hasNoteNow) {
      setActiveTab("note")
      setNoteMode("preview")
      setHasChanges(false)
    }
    prevNoteRef.current = encounter.note_text || ""
  }, [encounter.note_text])

  // Sequential enablement: the note tab opens once the note exists, or — for
  // writing one manually (recording-only arm, or a failed generation) — once
  // capture has finished and delivered a transcript.
  const noteEnabled = hasNote || (hasTranscript && !live)
  const recallEnabled = hasTranscript && (recordingOnly || hasNote)

  const noteVersionNumber = encounter.note_version ?? 0
  // Encounters archived before per-note status existed fall back to the
  // encounter-level archive state, so an archived v0 still shows its tick.
  const noteArchive = encounter.note_archive_status ?? encounter.archive_status

  const enterEditMode = () => {
    const { preamble, sections } = parseNoteSections(noteMarkdown)
    if (!noteMarkdown.trim()) {
      // First manual note: a clean four-section SOAP scaffold.
      setEditPreamble("")
      setEditSections(emptySoapSections())
    } else if (sections.length === 0) {
      // Legacy note without ## sections: edit as raw markdown.
      setEditPreamble("")
      setEditSections(null)
    } else {
      setEditPreamble(preamble)
      setEditSections(sections)
    }
    setViewingVersion(null)
    setShowHistory(false)
    setHasChanges(false)
    setNoteMode("edit")
  }

  const handleSectionChange = (index: number, body: string) => {
    setEditSections((current) => {
      if (!current) return current
      const next = [...current]
      next[index] = { ...next[index], body }
      return next
    })
    setHasChanges(true)
  }

  const handleRawChange = (value: string) => {
    setNoteMarkdown(value)
    setHasChanges(true)
  }

  const editedMarkdown = () =>
    editSections ? sectionsToMarkdown(editPreamble, editSections) : noteMarkdown

  const editHasContent = () =>
    editSections ? editSections.some((section) => section.body.trim()) : Boolean(noteMarkdown.trim())

  // Done editing: persist the edit as the next note version (the parent
  // archives it) and return to the formatted view. Leaving the text untouched
  // creates no new version.
  const handleSave = () => {
    const markdown = editedMarkdown()
    if (hasChanges && editHasContent()) {
      setNoteMarkdown(markdown)
      onSave(markdown)
    }
    setHasChanges(false)
    setEditSections(null)
    setNoteMode("preview")
  }

  // Throw the edit away: back to the stored note, no version bump.
  const handleDiscard = () => {
    setNoteMarkdown(encounter.note_text || "")
    setHasChanges(false)
    setEditSections(null)
    setNoteMode("preview")
  }

  const displayedNote = viewingVersion ? viewingVersion.note_text : noteMarkdown

  // The tabs are the pipeline: each step's live status is shown on its tab.
  const tabButton = (tab: TabType, label: string, enabled: boolean, status?: ReactNode) => (
    <button
      onClick={() => enabled && setActiveTab(tab)}
      disabled={!enabled}
      className={cn(
        "flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors",
        "border-b-2 -mb-px",
        activeTab === tab
          ? "border-primary text-foreground"
          : enabled
            ? "border-transparent text-muted-foreground hover:text-foreground"
            : "cursor-not-allowed border-transparent text-muted-foreground/40",
      )}
    >
      {label}
      {status}
    </button>
  )

  const captureStatus =
    live?.phase === "recording" ? (
      <span className={cn("h-2 w-2 rounded-full", live.isPaused ? "bg-muted-foreground" : "animate-pulse bg-recording")} />
    ) : live?.transcriptionStatus === "in-progress" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
    ) : live?.transcriptionStatus === "failed" ? (
      <X className="h-3.5 w-3.5 text-destructive" />
    ) : null

  const noteStatus =
    live?.noteGenerationStatus === "in-progress" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
    ) : live?.noteGenerationStatus === "failed" ? (
      <X className="h-3.5 w-3.5 text-destructive" />
    ) : null


  const showEditingActions = activeTab === "note" && noteMode === "edit"
  const showPreviewActions = activeTab === "note" && hasNote && noteMode === "preview" && !approved && !viewingVersion

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 bg-card/60 px-6 pt-2 backdrop-blur-sm">
        {/* Single compact row: back navigation + identity on the left. */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {backLink}
          <h2
            className={cn(
              "font-display truncate text-base font-medium tracking-tight",
              linked ? "text-foreground" : "italic text-muted-foreground",
            )}
          >
            {linked ? encounter.patient_name || "Unknown Patient" : "No patient"}
          </h2>
          {(patient || encounter.patient_id) && (
            <Badge
              variant="secondary"
              className="rounded-full border-transparent bg-brand-soft font-mono text-xs text-primary"
            >
              {patient ? `NHS ${formatNhsNumber(patient.nhs_number)}` : encounter.patient_id}
            </Badge>
          )}
          {approved && (
            <Badge className="rounded-full border-success/30 bg-success/10 text-xs font-semibold text-success">
              <FileCheck className="mr-1 h-3 w-3" />
              Filed
              {encounter.approved_at ? ` ${format(new Date(encounter.approved_at), "d MMM, HH:mm")}` : ""}
            </Badge>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{format(new Date(encounter.created_at), "MMM d, yyyy 'at' h:mm a")}</span>
            {encounter.visit_reason && (
              <>
                <span className="text-border">·</span>
                <span className="truncate">{encounter.visit_reason}</span>
              </>
            )}
          </div>
        </div>

        <div className="mt-1 flex items-center justify-between gap-4 border-b border-border">
          <div className="flex gap-1">
            {tabButton("capture", "Capture", true, captureStatus)}
            {tabButton("note", "Clinical Note", noteEnabled, noteStatus)}
            {tabButton("recall", "Stimulated Recall", recallEnabled)}
          </div>

          <div className="flex items-center gap-1 pb-2">
            {activeTab === "note" && hasNote && versions.length > 0 && (
              <div className="relative mr-1">
                <button
                  type="button"
                  onClick={() => setShowHistory((v) => !v)}
                  title={
                    noteArchive === "pending"
                      ? "Saving this version to the archive…"
                      : noteArchive === "archived"
                        ? "This version is saved to the archive"
                        : noteArchive === "failed"
                          ? "Archiving this version failed"
                          : noteArchive === "skipped"
                            ? "Archiving not configured — stored locally only"
                            : "Note version history"
                  }
                  className="flex h-8 items-center gap-1.5 rounded-full border border-border px-2.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <History className="h-3 w-3" />
                  v{noteVersionNumber}
                  {noteArchive === "pending" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                  {noteArchive === "archived" && <Check className="h-3 w-3 text-success" />}
                  {noteArchive === "failed" && <X className="h-3 w-3 text-destructive" />}
                  <ChevronDown className={cn("h-3 w-3 transition-transform", showHistory && "rotate-180")} />
                </button>
                {showHistory && (
                  <div className="absolute right-0 top-9 z-20 w-72 rounded-2xl border border-border bg-popover p-1.5 shadow-lifted">
                    {[...versions].reverse().map((version) => {
                      const isCurrent = version.version === noteVersionNumber && !viewingVersion
                      const isViewing = viewingVersion?.version === version.version
                      return (
                        <button
                          key={version.version}
                          type="button"
                          onClick={() => {
                            setViewingVersion(version.version === noteVersionNumber ? null : version)
                            setShowHistory(false)
                            setNoteMode("preview")
                          }}
                          className={cn(
                            "flex w-full items-baseline gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-accent",
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
            )}
            {showPreviewActions && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={enterEditMode}
                  title="Edit the note"
                  className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="mr-1.5 h-4 w-4" />
                  <span className="text-xs">Edit</span>
                </Button>
                <Button
                  size="sm"
                  onClick={() => onApprove(noteMarkdown)}
                  title="File this note to the patient record. The consultation locks after approval."
                  className="mr-1 h-8 rounded-full bg-primary px-3 text-primary-foreground shadow-soft hover:bg-brand-strong"
                >
                  <FileCheck className="mr-1.5 h-4 w-4" />
                  <span className="text-xs">Approve & file</span>
                </Button>
              </>
            )}
            {showEditingActions && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDiscard}
                  title="Discard your edits and keep the current version"
                  className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
                >
                  <X className="mr-1.5 h-4 w-4" />
                  <span className="text-xs">Discard</span>
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!editHasContent()}
                  title="Save as the next note version"
                  className="mr-1 h-8 rounded-full bg-primary px-3 text-primary-foreground shadow-soft hover:bg-brand-strong"
                >
                  <Save className="mr-1.5 h-4 w-4" />
                  <span className="text-xs">Save</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("mx-auto w-full px-6 py-4", activeTab === "recall" ? "max-w-6xl" : "max-w-3xl")}>
          {/* Panels stay mounted and hide via CSS, so the audio player (and its
              playback position) survives tab switches without remount flicker. */}
          <div className={cn("flex flex-col gap-4", activeTab !== "capture" && "hidden")}>
            {live?.transcriptionStatus === "failed" && (
              <CaptureErrorRow
                message={live.transcriptionErrorMessage || "Transcription failed."}
                onRetry={live.onRetryTranscription}
              />
            )}
            {live?.noteGenerationStatus === "failed" && (
              <CaptureErrorRow message="Clinical note generation failed." onRetry={live.onRetryNoteGeneration} />
            )}
            <div className="min-h-[480px] rounded-2xl border border-border bg-card p-7 shadow-soft">
              {/* The audio strip stays fixed at the top of the card: the live
                  recording controls morph in place into the playback player. */}
              {live?.phase === "recording" ? (
                <RecordingBar
                  duration={live.duration ?? 0}
                  isPaused={Boolean(live.isPaused)}
                  analyser={live.analyser ?? null}
                  onStop={live.onStop ?? (() => undefined)}
                  onPause={live.onPause ?? (() => undefined)}
                  onResume={live.onResume ?? (() => undefined)}
                  stopLabel={recordingOnly ? "Stop recording" : "Stop & generate"}
                  className="mb-5 border-b border-border pb-5"
                />
              ) : (
                <AudioPlayer
                  audioKey={encounter.id}
                  placeholder={Boolean(live)}
                  className="mb-5 border-b border-border pb-5"
                />
              )}
              {hasTranscript ? (
                // No wrapper animation: the turns animate themselves, and
                // fading the whole block at once flattens their stagger.
                <TranscriptView
                  text={encounter.transcript_text}
                  confidence={encounter.transcript_confidence}
                />
              ) : live?.phase === "processing" ? (
                // Hold the transcript's shape while it is on its way, so its
                // arrival is a crossfade rather than a jump from centred text.
                <TranscriptSkeleton />
              ) : (
                <div className="flex h-full min-h-[380px] items-center justify-center text-center">
                  <p className="max-w-xs text-sm leading-relaxed text-muted-foreground text-balance">
                    {live?.phase === "recording"
                      ? "The transcript will appear here once you stop the recording."
                      : "No transcript available."}
                  </p>
                </div>
              )}
            </div>
          </div>
          {noteEnabled && (
            <div className={cn(activeTab !== "note" && "hidden")}>
              {viewingVersion && (
                <div className="mb-4 flex items-center gap-3 rounded-2xl border border-border bg-accent/40 px-5 py-3">
                  <History className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                    Viewing v{viewingVersion.version} · {VERSION_SOURCE_LABELS[viewingVersion.source]} ·{" "}
                    {format(new Date(viewingVersion.created_at), "d MMM, HH:mm")} — read-only
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setViewingVersion(null)}
                    className="h-8 shrink-0 rounded-full px-3"
                  >
                    <span className="text-xs">Back to latest</span>
                  </Button>
                </div>
              )}
              {noteMode === "edit" ? (
                editSections ? (
                  <div className="space-y-4">
                    {!hasNote && (
                      <p className="text-sm text-muted-foreground">
                        Write the clinical note for this consultation. Each section is filed as part of the SOAP note.
                      </p>
                    )}
                    {editSections.map((section, index) => (
                      <div
                        key={section.title}
                        className="rounded-2xl border border-border bg-card p-5 shadow-soft"
                      >
                        <label
                          htmlFor={`soap-${section.title}`}
                          className="mb-2 block font-display text-lg font-medium tracking-tight text-foreground"
                        >
                          {section.title}
                        </label>
                        <Textarea
                          id={`soap-${section.title}`}
                          value={section.body}
                          onChange={(e) => handleSectionChange(index, e.target.value)}
                          placeholder={`${section.title}…`}
                          className="min-h-[120px] resize-y rounded-xl border-border bg-background p-4 text-sm leading-relaxed text-foreground focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/30"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Textarea
                    value={noteMarkdown}
                    onChange={(e) => handleRawChange(e.target.value)}
                    placeholder="Clinical note markdown…"
                    className="min-h-[640px] resize-none rounded-2xl border-border bg-card p-6 font-mono text-sm leading-relaxed text-foreground shadow-soft focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/30"
                  />
                )
              ) : hasNote ? (
                <div className="min-h-[640px] rounded-2xl border border-border bg-card p-6 shadow-soft sm:p-8">
                  <SectionedNote source={displayedNote} />
                </div>
              ) : (
                <div className="flex min-h-[480px] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
                  <Pencil className="h-8 w-8 text-muted-foreground/40" />
                  <p className="max-w-sm text-sm leading-relaxed text-muted-foreground text-balance">
                    {recordingOnly
                      ? "No note yet. Write the clinical note for this consultation yourself — the scribe stays out of it in this mode."
                      : "No note was generated. You can write the clinical note manually."}
                  </p>
                  <Button
                    onClick={enterEditMode}
                    className="rounded-full bg-primary px-5 text-primary-foreground shadow-soft hover:bg-brand-strong"
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Write clinical note
                  </Button>
                </div>
              )}
            </div>
          )}
          {recallEnabled && (
            <div className={cn(activeTab !== "recall" && "hidden")}>
              <StimulatedRecallView encounter={encounter} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
