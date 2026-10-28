"use client"

import { useState, useEffect, useRef, type ReactNode } from "react"
import type { Encounter, NoteVersion } from "@storage/types"
import { noteVersionsOf } from "@storage"
import { Button } from "@ui/lib/ui/button"
import { Textarea } from "@ui/lib/ui/textarea"
import { ArrowDown, Save, ChevronRight, Loader2, Pencil, Square, SquareCheck, X, FileCheck } from "lucide-react"
import { cn } from "@ui/lib/utils"
import { TranscriptView } from "./transcript-view"
import { TranscriptSkeleton } from "./transcript-skeleton"
import { NoteSkeleton } from "./note-skeleton"
import { AudioPlayer } from "./audio-player"
import { RecordingBar } from "./recording-bar"
import { RecordingOnlyEditor } from "./recording-only-editor"
import {
  CARD,
  CARD_BODY,
  CARD_HEAD,
  CaptureErrorRow,
  ConsultationHeader,
  NoteVersionMenu,
  SectionedNote,
  ViewingVersionBanner,
  emptySoapSections,
  sectionsToMarkdown,
} from "./note-parts"
import { parseNoteSections, type NoteSection } from "../note-sections"

/**
 * The consultation as one page that reads in the order things happen: the
 * audio, then the transcript, then the clinical note, stacked. A stage strip
 * under the identity row says which of the three is done, live or drafting.
 * Nothing sits behind a tab: while the note drafts the transcript is there to
 * read above it. When the note lands, nothing moves under the clinician: the
 * stage strip and the note card announce it, and if the note card is off
 * screen a pill offers to scroll to it. The transcript folds by default only
 * when a consultation is opened later with its note already present.
 */

export type CaptureStepStatus = "pending" | "in-progress" | "done" | "failed"

/**
 * Live pipeline state for the encounter currently being captured. Present only
 * while this encounter is recording or processing; the audio card renders the
 * recording bar from it and the stage strip and cards show the progress, so
 * the clinician stays in one view from first word to finished note.
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

export interface NoteEditorProps {
  encounter: Encounter
  /** Persist an edit (or the first manual note) as the next version. */
  onSave: (noteText: string) => void
  /** File this note to the patient record; the consultation locks after. */
  onApprove: (noteText: string) => void
  live?: LiveCaptureState
  /** Navigation element rendered before the patient name (back to chart). */
  backLink?: ReactNode
  /**
   * Begin capture from the page itself. The recording-only arm opens on its
   * note form rather than a ready panel, so its recording strip starts the
   * recording (or takes a file) before anything has been captured.
   */
  onStartRecording?: () => void
  onUploadRecording?: (file: File) => void
}

type StageState = "pending" | "live" | "active" | "done" | "failed"

/**
 * One stage of the pipeline: a label and nothing but a mark. Done, live and
 * drafting all use the accent, drawn in outline so nothing on the strip is
 * heavier than the content below it.
 */
function StageChip({ label, state }: { label: string; state: StageState }) {
  const mark =
    state === "done" ? (
      <SquareCheck className="h-4 w-4 text-primary" />
    ) : state === "active" ? (
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
    ) : state === "live" ? (
      <span className="mx-[3px] h-2.5 w-2.5 animate-pulse rounded-[3px] bg-primary ring-4 ring-primary/20" />
    ) : state === "failed" ? (
      <X className="h-4 w-4 text-destructive" />
    ) : (
      <Square className="h-4 w-4 text-muted-foreground/50" />
    )
  // Plain text beside its mark: a label, not a control.
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        state === "active" || state === "live"
          ? "text-primary"
          : state === "failed"
            ? "text-destructive"
            : state === "pending"
              ? "text-muted-foreground"
              : "text-foreground",
      )}
    >
      {mark}
      {label}
    </span>
  )
}

/**
 * The recording-only arm is laid out as an EHR's note form with a recording
 * strip above it; the scribed arm is the pipeline view below.
 */
export function NoteEditor(props: NoteEditorProps) {
  return props.encounter.mode === "recording_only" ? <RecordingOnlyEditor {...props} /> : <ScribedNoteEditor {...props} />
}

function ScribedNoteEditor({ encounter, onSave, onApprove, live, backLink }: NoteEditorProps) {
  const approved = encounter.approval_status === "approved"
  const hasNote = Boolean(encounter.note_text?.trim())
  const hasTranscript = Boolean(encounter.transcript_text?.trim())
  const versions = noteVersionsOf(encounter)

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
  // The transcript starts open when it is the only thing to read, and starts
  // folded when the note already exists on open. It never folds by itself.
  const [transcriptOpen, setTranscriptOpen] = useState(!hasNote)
  // Set when the note arrives during this session; cleared once the note
  // card has been seen. Drives the "note ready" pill.
  const [noteJustArrived, setNoteJustArrived] = useState(false)
  const noteCardRef = useRef<HTMLElement>(null)
  const prevNoteRef = useRef<string>(encounter.note_text || "")

  // Reset the view when switching encounters.
  useEffect(() => {
    setNoteMode("preview")
    setHasChanges(false)
    setEditSections(null)
    setViewingVersion(null)
    setTranscriptOpen(!encounter.note_text?.trim())
    setNoteJustArrived(false)
    prevNoteRef.current = encounter.note_text || ""
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounter.id])

  // Keep the editable markdown in sync with the stored note. When the note
  // first arrives, announce it rather than rearranging the page: the clinician
  // may be mid-way through the transcript.
  useEffect(() => {
    setNoteMarkdown(encounter.note_text || "")
    const hadNote = Boolean(prevNoteRef.current?.trim())
    const hasNoteNow = Boolean(encounter.note_text?.trim())
    if (!hadNote && hasNoteNow) {
      setNoteMode("preview")
      setHasChanges(false)
      setNoteJustArrived(true)
    }
    prevNoteRef.current = encounter.note_text || ""
  }, [encounter.note_text])

  // The pill lives only while the freshly arrived note card is out of view;
  // the moment it scrolls into view (or already is), the pill goes.
  useEffect(() => {
    if (!noteJustArrived) return
    const card = noteCardRef.current
    if (!card || typeof IntersectionObserver === "undefined") {
      setNoteJustArrived(false)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNoteJustArrived(false)
      },
      { threshold: 0.25 },
    )
    observer.observe(card)
    return () => observer.disconnect()
  }, [noteJustArrived])

  const scrollToNote = () => {
    noteCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    setNoteJustArrived(false)
  }

  // A note can be written by hand after a failed generation, once capture has
  // finished and delivered a transcript.
  const noteEnabled = hasNote || (hasTranscript && !live)

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

  // ── Stage states ──────────────────────────────────────────────────────
  const recordingStage: StageState =
    live?.phase === "recording"
      ? "live"
      : hasTranscript || live?.phase === "processing" || Boolean(encounter.recording_duration)
        ? "done"
        : "pending"
  const transcriptStage: StageState =
    live?.transcriptionStatus === "failed"
      ? "failed"
      : live?.phase === "processing" && live.transcriptionStatus === "in-progress"
        ? "active"
        : hasTranscript
          ? "done"
          : "pending"
  const noteStage: StageState =
    live?.noteGenerationStatus === "failed"
      ? "failed"
      : live?.noteGenerationStatus === "in-progress"
        ? "active"
        : hasNote
          ? "done"
          : "pending"

  const transcriptCanOpen = hasTranscript || transcriptStage === "active"
  const showTranscriptBody = transcriptCanOpen && transcriptOpen

  // A note is on its way from the moment processing starts, so its shape
  // shows while the transcript is still being made, not only once generation
  // itself begins. Nothing is expected after a failure.
  const noteExpected =
    !hasNote &&
    live?.phase === "processing" &&
    live.transcriptionStatus !== "failed" &&
    noteStage !== "failed"

  const showEditingActions = noteMode === "edit"
  const showPreviewActions = hasNote && noteMode === "preview" && !approved && !viewingVersion

  // What the note card holds beneath its header, if anything.
  const noteBody: ReactNode = (() => {
    if (noteMode === "edit") {
      return editSections ? (
        <div className="space-y-4">
          {!hasNote && (
            <p className="text-sm text-muted-foreground">
              Write the clinical note for this consultation. Each section is filed as part of the SOAP note.
            </p>
          )}
          {editSections.map((section, index) => (
            <div key={section.title} className="rounded-xl border border-border bg-background p-4">
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
                className="min-h-[120px] resize-y rounded-lg border-border bg-card p-4 text-sm leading-relaxed text-foreground focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/30"
              />
            </div>
          ))}
        </div>
      ) : (
        <Textarea
          value={noteMarkdown}
          onChange={(e) => handleRawChange(e.target.value)}
          placeholder="Clinical note markdown…"
          className="min-h-[520px] resize-none rounded-lg border-border bg-background p-5 font-mono text-sm leading-relaxed text-foreground focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      )
    }
    if (hasNote) return <SectionedNote source={displayedNote} />
    if (noteExpected) return <NoteSkeleton />
    if (noteEnabled) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
          <Pencil className="h-8 w-8 text-muted-foreground/40" />
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground text-balance">
            No note was generated. You can write the clinical note manually.
          </p>
          <Button
            onClick={enterEditMode}
            className="rounded-md bg-primary px-4 text-primary-foreground shadow-soft hover:bg-brand-strong"
          >
            <Pencil className="mr-2 h-4 w-4" />
            Write clinical note
          </Button>
        </div>
      )
    }
    return null
  })()

  return (
    <div className="flex h-full flex-col">
      <ConsultationHeader encounter={encounter} backLink={backLink}>
        <div className="ml-2 flex items-center gap-2.5">
          <StageChip label="Recording" state={recordingStage} />
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
          <StageChip label="Transcript" state={transcriptStage} />
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
          <StageChip label="Clinical note" state={noteStage} />
        </div>
      </ConsultationHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full flex-col gap-3 px-6 py-4">
          {live?.transcriptionStatus === "failed" && (
            <CaptureErrorRow
              message={live.transcriptionErrorMessage || "Transcription failed."}
              onRetry={live.onRetryTranscription}
            />
          )}
          {live?.noteGenerationStatus === "failed" && (
            <CaptureErrorRow message="Clinical note generation failed." onRetry={live.onRetryNoteGeneration} />
          )}

          {/* Audio: its own card. The live recording controls morph in place
              into the playback player once the capture stops. */}
          {live?.phase === "recording" ? (
            <RecordingBar
              duration={live.duration ?? 0}
              isPaused={Boolean(live.isPaused)}
              analyser={live.analyser ?? null}
              onStop={live.onStop ?? (() => undefined)}
              onPause={live.onPause ?? (() => undefined)}
              onResume={live.onResume ?? (() => undefined)}
              stopLabel="Stop & generate"
              className={cn(CARD, "px-5 py-3.5")}
            />
          ) : (
            <AudioPlayer
              audioKey={encounter.id}
              placeholder={Boolean(live)}
              downloadName={`consultation_${encounter.id}`}
              className={cn(CARD, "px-5 py-3.5")}
            />
          )}

          {/* Transcript: a collapsible card. */}
          <section className={CARD}>
            <button
              type="button"
              onClick={() => transcriptCanOpen && setTranscriptOpen((open) => !open)}
              disabled={!transcriptCanOpen}
              aria-expanded={showTranscriptBody}
              className={cn(
                "flex w-full items-center gap-2.5 px-5 py-3 text-left",
                transcriptCanOpen ? "cursor-pointer" : "cursor-default",
              )}
            >
              <h2 className={cn("text-sm font-semibold", transcriptCanOpen ? "text-foreground" : "text-muted-foreground")}>
                Transcript
              </h2>
              {transcriptCanOpen && (
                <span className="ml-auto text-xs font-medium text-primary">{showTranscriptBody ? "Hide" : "Show"}</span>
              )}
            </button>
            {/* The body stays mounted and its row animates between 0fr and
                1fr, so folding and unfolding slide rather than snap. */}
            {transcriptCanOpen && (
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-300 ease-out",
                  showTranscriptBody ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className="min-h-0 overflow-hidden" aria-hidden={!showTranscriptBody} inert={!showTranscriptBody}>
                  <div className={CARD_BODY}>
                    {hasTranscript ? (
                      <TranscriptView text={encounter.transcript_text} confidence={encounter.transcript_confidence} />
                    ) : (
                      <TranscriptSkeleton />
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Clinical note: the deliverable, with its own actions. */}
          <section ref={noteCardRef} className={CARD}>
            <div className={CARD_HEAD}>
              <h2 className={cn("text-sm font-semibold", noteBody ? "text-foreground" : "text-muted-foreground")}>
                Clinical note
              </h2>
              <div className="ml-auto flex items-center gap-1.5">
                {noteStage === "active" && (
                  <span className="inline-flex h-8 items-center gap-2 text-xs font-medium text-primary">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Drafting
                  </span>
                )}
                {hasNote && versions.length > 0 && (
                  <NoteVersionMenu
                    versions={versions}
                    currentVersion={noteVersionNumber}
                    archiveStatus={noteArchive}
                    viewing={viewingVersion}
                    onSelect={(version) => {
                      setViewingVersion(version)
                      setNoteMode("preview")
                    }}
                  />
                )}
                {showPreviewActions && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={enterEditMode}
                      title="Edit the note"
                      className="h-8 rounded-md px-3"
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      <span className="text-xs">Edit</span>
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => onApprove(noteMarkdown)}
                      title="File this note to the patient record. The consultation locks after approval."
                      className="h-8 rounded-md bg-primary px-3 text-primary-foreground shadow-soft hover:bg-brand-strong"
                    >
                      <FileCheck className="mr-1.5 h-3.5 w-3.5" />
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
                      className="h-8 rounded-md px-3 text-muted-foreground hover:text-foreground"
                    >
                      <X className="mr-1.5 h-3.5 w-3.5" />
                      <span className="text-xs">Discard</span>
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={!editHasContent()}
                      title="Save as the next note version"
                      className="h-8 rounded-md bg-primary px-3 text-primary-foreground shadow-soft hover:bg-brand-strong"
                    >
                      <Save className="mr-1.5 h-3.5 w-3.5" />
                      <span className="text-xs">Save</span>
                    </Button>
                  </>
                )}
              </div>
            </div>
            {noteBody && (
              <div className={CARD_BODY}>
                {viewingVersion && (
                  <ViewingVersionBanner version={viewingVersion} onBack={() => setViewingVersion(null)} />
                )}
                {noteBody}
              </div>
            )}
          </section>
        </div>
      </div>

      {noteJustArrived && (
        <button
          type="button"
          onClick={scrollToNote}
          className="animate-rise fixed bottom-6 left-1/2 z-30 inline-flex h-9 -translate-x-1/2 items-center gap-2 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground shadow-lifted transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <SquareCheck className="h-4 w-4" />
          Clinical note ready
          <ArrowDown className="h-3.5 w-3.5 opacity-80" />
        </button>
      )}
    </div>
  )
}
