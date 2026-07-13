"use client"

import { useState, useEffect } from "react"
import type { Encounter } from "@storage/types"
import { Button } from "@ui/lib/ui/button"
import { Textarea } from "@ui/lib/ui/textarea"
import { Badge } from "@ui/lib/ui/badge"
import { Save, Copy, Download, Check, Pencil } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@ui/lib/utils"
import { MarkdownNote } from "./markdown-note"
import { TranscriptView } from "./transcript-view"
import { AudioPlayer } from "./audio-player"

interface NoteEditorProps {
  encounter: Encounter
  onSave: (noteText: string) => void
}

type TabType = "note" | "transcript"

export function NoteEditor({ encounter, onSave }: NoteEditorProps) {
  // Recording-only encounters have no clinical note; only the transcript is shown.
  const recordingOnly = encounter.mode === "recording_only"
  const [activeTab, setActiveTab] = useState<TabType>(recordingOnly ? "transcript" : "note")
  const [noteMode, setNoteMode] = useState<"preview" | "edit">("preview")
  const [noteMarkdown, setNoteMarkdown] = useState<string>(encounter.note_text || "")
  const [hasChanges, setHasChanges] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setNoteMarkdown(encounter.note_text || "")
    setNoteMode("preview")
    setHasChanges(false)
    setActiveTab(encounter.mode === "recording_only" ? "transcript" : "note")
  }, [encounter.id, encounter.note_text, encounter.mode])

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

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border bg-card/60 px-8 py-5 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-display text-2xl font-medium tracking-tight text-foreground">
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
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{format(new Date(encounter.created_at), "MMM d, yyyy 'at' h:mm a")}</span>
              {encounter.visit_reason && (
                <>
                  <span className="text-border">·</span>
                  <span>{encounter.visit_reason}</span>
                </>
              )}
            </div>
            {/* Compact listen-back player (hidden when no recording is stored). */}
            <AudioPlayer encounterId={encounter.id} className="mt-3" />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-4 border-b border-border">
          <div className="flex gap-1">
            {!recordingOnly && (
              <button
                onClick={() => setActiveTab("note")}
                className={cn(
                  "px-4 py-2 text-sm font-medium transition-colors",
                  "border-b-2 -mb-px",
                  activeTab === "note"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                Clinical Note
              </button>
            )}
            <button
              onClick={() => setActiveTab("transcript")}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                "border-b-2 -mb-px",
                activeTab === "transcript"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              Transcript
            </button>
          </div>

          <div className="flex items-center gap-1 pb-2">
            {activeTab === "note" && (
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
            {activeTab === "note" && (
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
        <div className="mx-auto w-full max-w-3xl px-8 py-10">
          {activeTab === "note" ? (
            noteMode === "preview" ? (
              <div className="min-h-[640px] rounded-2xl border border-border bg-card p-8 shadow-soft sm:p-10">
                <MarkdownNote source={noteMarkdown} />
              </div>
            ) : (
              <Textarea
                value={noteMarkdown}
                onChange={(e) => handleNoteChange(e.target.value)}
                placeholder="Clinical note markdown…"
                className="min-h-[640px] resize-none rounded-2xl border-border bg-card p-6 font-mono text-sm leading-relaxed text-foreground shadow-soft focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/30"
              />
            )
          ) : (
            <div className="min-h-[640px] rounded-2xl border border-border bg-card p-7 shadow-soft">
              <TranscriptView text={encounter.transcript_text} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
