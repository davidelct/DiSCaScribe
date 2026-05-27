"use client"

import { Cpu, Cloud } from "lucide-react"
import type { ProcessingMode } from "@storage/preferences"

interface ModelIndicatorProps {
  processingMode: ProcessingMode
}

/**
 * Displays the current AI models in use for transcription and note generation.
 * Placed in the sidebar between the encounter list and settings bar.
 */
export function ModelIndicator({ processingMode }: ModelIndicatorProps) {
  const noteModel = processingMode === "local" ? "Ollama (Local)" : "Claude (Cloud)"
  const NoteIcon = processingMode === "local" ? Cpu : Cloud

  return (
    <div className="shrink-0 border-t border-sidebar-border px-4 py-3.5">
      <p className="mb-2.5 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
        Models
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-card text-primary shadow-soft">
            <Cpu className="h-3.5 w-3.5" />
          </span>
          <span className="truncate">Whisper (Local)</span>
        </div>
        <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-card text-primary shadow-soft">
            <NoteIcon className="h-3.5 w-3.5" />
          </span>
          <span className="truncate">{noteModel}</span>
        </div>
      </div>
    </div>
  )
}
