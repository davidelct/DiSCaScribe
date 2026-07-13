"use client"

import { useState, useEffect, useRef, type ReactNode } from "react"
import type { Encounter } from "@storage/types"
import { Button } from "@ui/lib/ui/button"
import { Textarea } from "@ui/lib/ui/textarea"
import { Badge } from "@ui/lib/ui/badge"
import { Save, Copy, Download, Check, Loader2, Pencil, RotateCcw, X } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@ui/lib/utils"
import { MarkdownNote } from "./markdown-note"
import { TranscriptView } from "./transcript-view"
import { AudioPlayer } from "./audio-player"
import { RecordingBar } from "./recording-bar"
import { parseNoteSections, markdownToPlainText } from "../note-sections"
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
  onSave: (noteText: string) => void
  live?: LiveCaptureState
}

type TabType = "capture" | "note" | "recall"

/**
 * One SOAP section with its own copy button. The demo EPR splits the note
 * into one plain-text box per section, so the button copies the section body
 * as plain text (markdown markers stripped) ready to paste.
 */
function CopyableSection({ title, body }: { title: string; body: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(markdownToPlainText(body))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3 border-b border-border pb-2">
        <h2 className="font-display text-xl font-medium tracking-tight text-foreground">{title}</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          disabled={!body.trim()}
          title={`Copy ${title} as plain text`}
          className="h-7 shrink-0 rounded-full px-2.5 text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
          <span className="text-xs">{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>
      {body.trim() ? (
        <MarkdownNote source={body} className="[&>*:first-child]:mt-0" />
      ) : (
        <p className="my-3 text-sm italic text-muted-foreground">Empty</p>
      )}
    </section>
  )
}

/**
 * Renders the note with a copy button per level-2 (SOAP) section. Falls back
 * to plain whole-note rendering when the note has no sections.
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
        <CopyableSection key={section.title} title={section.title} body={section.body} />
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

export function NoteEditor({ encounter, onSave, live }: NoteEditorProps) {
  // Recording-only encounters have no clinical note; only capture + recall apply.
  const recordingOnly = encounter.mode === "recording_only"
  const hasNote = Boolean(encounter.note_text?.trim())
  const hasTranscript = Boolean(encounter.transcript_text?.trim())

  const [activeTab, setActiveTab] = useState<TabType>(hasNote ? "note" : "capture")
  const [noteMode, setNoteMode] = useState<"preview" | "edit">("preview")
  const [noteMarkdown, setNoteMarkdown] = useState<string>(encounter.note_text || "")
  const [hasChanges, setHasChanges] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const prevNoteRef = useRef<string>(encounter.note_text || "")

  // Reset the view when switching encounters.
  useEffect(() => {
    setNoteMode("preview")
    setHasChanges(false)
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

  // Sequential enablement: the note exists only after generation, and recall
  // opens once its inputs exist (transcript, plus the note in scribed mode).
  const noteEnabled = hasNote
  const recallEnabled = hasTranscript && (recordingOnly || hasNote)

  const handleNoteChange = (value: string) => {
    setNoteMarkdown(value)
    setHasChanges(true)
    setSaved(false)
  }

  const handleSave = () => {
    onSave(noteMarkdown)
    setHasChanges(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleCopy = async () => {
    const textToCopy = activeTab === "note" ? noteMarkdown : encounter.transcript_text
    await navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExport = () => {
    const isNote = activeTab === "note"
    const content = isNote ? noteMarkdown : encounter.transcript_text
    const blob = new Blob([content], { type: isNote ? "text/markdown" : "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const suffix = isNote ? "note" : "transcript"
    const extension = isNote ? "md" : "txt"
    a.download = `${encounter.patient_name || "encounter"}_${suffix}_${format(new Date(encounter.created_at), "yyyy-MM-dd")}.${extension}`
    a.click()
    URL.revokeObjectURL(url)
  }

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

  const showCopyExport =
    (activeTab === "capture" && hasTranscript) || (activeTab === "note" && hasNote)

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 bg-card/60 px-8 pt-3 backdrop-blur-sm">
        {/* Single compact row: identity on the left. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2 className="font-display truncate text-lg font-medium tracking-tight text-foreground">
            {encounter.patient_name || "Unknown Patient"}
          </h2>
          {encounter.patient_id && (
            <Badge
              variant="secondary"
              className="rounded-full border-transparent bg-brand-soft font-mono text-xs text-primary"
            >
              {encounter.patient_id}
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

        <div className="mt-1.5 flex items-center justify-between gap-4 border-b border-border">
          <div className="flex gap-1">
            {tabButton("capture", "Capture", true, captureStatus)}
            {!recordingOnly && tabButton("note", "Clinical Note", noteEnabled, noteStatus)}
            {tabButton("recall", "Stimulated Recall", recallEnabled)}
          </div>

          <div className="flex items-center gap-1 pb-2">
            {activeTab === "note" && hasNote && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNoteMode((m) => (m === "edit" ? "preview" : "edit"))}
                aria-pressed={noteMode === "edit"}
                title={noteMode === "edit" ? "Switch to formatted view" : "Edit raw markdown"}
                className={cn(
                  "mr-1 h-8 rounded-full px-3",
                  noteMode === "edit"
                    ? "bg-primary text-primary-foreground shadow-soft hover:bg-brand-strong hover:text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Pencil className="mr-1.5 h-4 w-4" />
                <span className="text-xs">Edit</span>
              </Button>
            )}
            {showCopyExport && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
                >
                  {copied ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
                  <span className="text-xs">Copy</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExport}
                  className="h-8 rounded-full px-3 text-muted-foreground hover:text-foreground"
                >
                  <Download className="h-4 w-4 mr-1.5" />
                  <span className="text-xs">Export</span>
                </Button>
              </>
            )}
            {activeTab === "note" && hasNote && (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!hasChanges}
                className={cn(
                  "ml-1 h-8 rounded-full bg-primary px-3 text-primary-foreground shadow-soft hover:bg-brand-strong",
                  saved && "bg-success hover:bg-success",
                )}
              >
                {saved ? <Check className="h-4 w-4 mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
                <span className="text-xs">{saved ? "Saved" : "Save"}</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("mx-auto w-full px-8 py-6", activeTab === "recall" ? "max-w-6xl" : "max-w-3xl")}>
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
                  <TranscriptView text={encounter.transcript_text} />
                ) : (
                  <div className="flex h-full min-h-[380px] items-center justify-center text-center">
                    <p className="max-w-xs text-sm leading-relaxed text-muted-foreground text-balance">
                      {live?.phase === "recording"
                        ? "The transcript will appear here once you stop the recording."
                        : live?.phase === "processing"
                          ? "Transcribing the consultation…"
                          : "No transcript available."}
                    </p>
                  </div>
                )}
              </div>
          </div>
          {!recordingOnly && hasNote && (
            <div className={cn(activeTab !== "note" && "hidden")}>
              {noteMode === "preview" ? (
                <div className="min-h-[640px] rounded-2xl border border-border bg-card p-8 shadow-soft sm:p-10">
                  <SectionedNote source={noteMarkdown} />
                </div>
              ) : (
                <Textarea
                  value={noteMarkdown}
                  onChange={(e) => handleNoteChange(e.target.value)}
                  placeholder="Clinical note markdown…"
                  className="min-h-[640px] resize-none rounded-2xl border-border bg-card p-6 font-mono text-sm leading-relaxed text-foreground shadow-soft focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/30"
                />
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
