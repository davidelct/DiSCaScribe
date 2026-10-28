"use client"

import { useEffect, useRef, useState } from "react"
import type { NoteVersion } from "@storage/types"
import { clearNoteDraft, loadNoteDraft, noteVersionsOf, saveNoteDraft } from "@storage"
import { Button } from "@ui/lib/ui/button"
import { Textarea } from "@ui/lib/ui/textarea"
import { FileCheck, Loader2, Mic, Upload } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@ui/lib/utils"
import { AudioPlayer } from "./audio-player"
import { RecordingBar } from "./recording-bar"
import { TestRequestsCard } from "./test-requests"
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
import type { NoteEditorProps } from "./note-editor"

/**
 * The recording-only (control) arm, laid out as a normal EHR consultation:
 * the clinician writes the note in a SOAP form that is open from the moment
 * the page opens, before, during and after the recording, and the recording
 * strip above it is the only addition. Nothing of the pipeline shows: no
 * stage strip and no transcript, which is still made and archived for
 * stimulated recall. The tests card under the note is the same as the
 * scribed arm's. The form keeps a draft as the clinician types (see
 * note-drafts.ts); Approve & file records it in the note trail and locks the
 * consultation, once the recording is in.
 */

/** How long typing has to pause before the draft is written. */
const DRAFT_SAVE_DELAY_MS = 500

/**
 * The form's contents: SOAP sections, or the raw markdown of an older note
 * that has none, which is edited as it stands rather than forced into SOAP.
 */
type NoteForm = { preamble: string; sections: NoteSection[] } | { raw: string }

function formFrom(noteText: string): NoteForm {
  if (!noteText.trim()) return { preamble: "", sections: emptySoapSections() }
  const { preamble, sections } = parseNoteSections(noteText)
  return sections.length ? { preamble, sections } : { raw: noteText }
}

function formMarkdown(form: NoteForm): string {
  return "raw" in form ? form.raw : sectionsToMarkdown(form.preamble, form.sections)
}

function formHasContent(form: NoteForm): boolean {
  return "raw" in form ? Boolean(form.raw.trim()) : form.sections.some((section) => section.body.trim())
}

const TEXTAREA =
  "resize-y rounded-lg border-border bg-card p-4 text-sm leading-relaxed text-foreground focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/30"

export function RecordingOnlyEditor({
  encounter,
  onApprove,
  live,
  backLink,
  onStartRecording,
  onUploadRecording,
  onSaveTests,
}: NoteEditorProps) {
  const approved = encounter.approval_status === "approved"
  const hasTranscript = Boolean(encounter.transcript_text?.trim())
  const versions = noteVersionsOf(encounter)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Null until the stored draft has been looked up, so a draft never loses
  // to the empty scaffold it would otherwise replace under the clinician.
  const [form, setForm] = useState<NoteForm | null>(null)
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)
  const [viewingVersion, setViewingVersion] = useState<NoteVersion | null>(null)
  const pendingDraftRef = useRef<string | null>(null)
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Open on the draft when there is one, else on the stored note (an older
  // consultation saved before filing), else on an empty SOAP form. Leaving
  // the page writes any draft still waiting on the typing pause.
  useEffect(() => {
    const encounterId = encounter.id
    let cancelled = false
    setForm(null)
    setDraftSavedAt(null)
    setViewingVersion(null)
    void loadNoteDraft(encounterId).then((draft) => {
      if (cancelled) return
      setForm(formFrom(draft?.note_text ?? encounter.note_text ?? ""))
      setDraftSavedAt(draft?.saved_at ?? null)
    })
    return () => {
      cancelled = true
      clearTimeout(draftTimerRef.current)
      if (pendingDraftRef.current !== null) void saveNoteDraft(encounterId, pendingDraftRef.current)
      pendingDraftRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounter.id])

  // Once filed, the note trail holds the note and the draft has no use.
  useEffect(() => {
    if (!approved) return
    clearTimeout(draftTimerRef.current)
    pendingDraftRef.current = null
    clearNoteDraft(encounter.id)
  }, [approved, encounter.id])

  const updateForm = (next: NoteForm) => {
    setForm(next)
    const encounterId = encounter.id
    pendingDraftRef.current = formMarkdown(next)
    clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(() => {
      const text = pendingDraftRef.current
      pendingDraftRef.current = null
      if (text === null) return
      void saveNoteDraft(encounterId, text).then((draft) => {
        if (draft && !pendingDraftRef.current) setDraftSavedAt(draft.saved_at)
      })
    }, DRAFT_SAVE_DELAY_MS)
  }

  const handleSectionChange = (index: number, body: string) => {
    if (!form || "raw" in form) return
    const sections = [...form.sections]
    sections[index] = { ...sections[index], body }
    updateForm({ ...form, sections })
  }

  // ── Capture state ─────────────────────────────────────────────────────
  const recording = live?.phase === "recording"
  // Stopped, and the recording is still on its way to transcription and the
  // archive. A failed transcription is not waiting on anything: its row
  // offers the retry, and the note can be filed regardless.
  const saving = live?.phase === "processing" && live.transcriptionStatus !== "failed"
  const notStarted = !live && !hasTranscript && !encounter.recording_duration

  // Filing locks the consultation, so it waits for a recording to exist and
  // to have stopped: the study needs the consultation's audio.
  const fileBlocker = recording
    ? "Stop the recording to file the note"
    : saving
      ? "Saving the recording…"
      : notStarted
        ? "Record the consultation before filing the note"
        : !form || !formHasContent(form)
          ? "Write the note before filing it"
          : null

  const handleFile = () => {
    if (!form || fileBlocker) return
    clearTimeout(draftTimerRef.current)
    pendingDraftRef.current = null
    onApprove(formMarkdown(form))
  }

  const audioStrip = recording ? (
    <RecordingBar
      duration={live.duration ?? 0}
      isPaused={Boolean(live.isPaused)}
      analyser={live.analyser ?? null}
      onStop={live.onStop ?? (() => undefined)}
      onPause={live.onPause ?? (() => undefined)}
      onResume={live.onResume ?? (() => undefined)}
      stopLabel="Stop recording"
      className={cn(CARD, "px-5 py-3.5")}
    />
  ) : notStarted && onStartRecording && !approved ? (
    <div className={cn(CARD, "flex items-center gap-3 px-5 py-3.5")}>
      <Mic className="h-4 w-4 shrink-0 text-primary" />
      <span className="text-sm text-muted-foreground">Not recording</span>
      <div className="ml-auto flex items-center gap-2">
        {onUploadRecording && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ""
                if (file) onUploadRecording(file)
              }}
            />
            <Button
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              title="Transcribe an existing recording (WAV, MP3, M4A…)"
              className="h-9 rounded-full px-3 text-muted-foreground hover:text-foreground"
            >
              <Upload className="mr-2 h-3.5 w-3.5" />
              Upload audio
            </Button>
          </>
        )}
        <Button
          onClick={onStartRecording}
          className="h-9 shrink-0 rounded-full bg-primary px-4 text-primary-foreground shadow-soft hover:bg-brand-strong"
        >
          <Mic className="mr-2 h-3.5 w-3.5" />
          Start recording
        </Button>
      </div>
    </div>
  ) : (
    <AudioPlayer
      audioKey={encounter.id}
      placeholder={Boolean(live)}
      downloadName={`consultation_${encounter.id}`}
      className={cn(CARD, "px-5 py-3.5")}
    />
  )

  const noteBody = (() => {
    if (approved || viewingVersion) {
      return <SectionedNote source={viewingVersion ? viewingVersion.note_text : encounter.note_text} />
    }
    if (!form) return null
    if ("raw" in form) {
      return (
        <Textarea
          value={form.raw}
          onChange={(e) => updateForm({ raw: e.target.value })}
          aria-label="Clinical note"
          className={cn(TEXTAREA, "min-h-[520px] bg-background p-5 font-mono")}
        />
      )
    }
    return (
      <div className="space-y-4">
        {form.sections.map((section, index) => (
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
              className={cn(TEXTAREA, "min-h-[120px]")}
            />
          </div>
        ))}
      </div>
    )
  })()

  return (
    <div className="flex h-full flex-col">
      <ConsultationHeader encounter={encounter} backLink={backLink} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full flex-col gap-3 px-6 py-4">
          {live?.transcriptionStatus === "failed" && (
            <CaptureErrorRow
              message={live.transcriptionErrorMessage || "Transcription failed."}
              onRetry={live.onRetryTranscription}
            />
          )}

          {audioStrip}

          <section className={CARD}>
            <div className={CARD_HEAD}>
              <h2 className="text-sm font-semibold text-foreground">Clinical note</h2>
              {!approved && draftSavedAt && (
                <span className="text-xs text-muted-foreground">
                  Draft saved {format(new Date(draftSavedAt), "HH:mm")}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                {!approved && saving && (
                  <span className="inline-flex h-8 items-center gap-2 px-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Saving the recording
                  </span>
                )}
                {versions.length > 0 && (
                  <NoteVersionMenu
                    versions={versions}
                    currentVersion={encounter.note_version ?? 0}
                    archiveStatus={encounter.note_archive_status ?? encounter.archive_status}
                    viewing={viewingVersion}
                    onSelect={setViewingVersion}
                  />
                )}
                {/* The reason sits on a wrapper: a disabled button shows no tooltip. */}
                {!approved && (
                  <span
                    title={fileBlocker ?? "File this note to the patient record. The consultation locks after filing."}
                  >
                    <Button
                      size="sm"
                      onClick={handleFile}
                      disabled={Boolean(fileBlocker)}
                      className="h-8 rounded-md bg-primary px-3 text-primary-foreground shadow-soft hover:bg-brand-strong"
                    >
                      <FileCheck className="mr-1.5 h-3.5 w-3.5" />
                      <span className="text-xs">Approve & file</span>
                    </Button>
                  </span>
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

          <TestRequestsCard
            requests={encounter.test_requests ?? []}
            locked={approved}
            archiveStatus={encounter.test_requests_archive_status}
            onSave={onSaveTests}
          />
        </div>
      </div>
    </div>
  )
}
