"use client"

import { useEffect, useState } from "react"
import { Cpu, Cloud } from "lucide-react"

type TranscriptionProvider = "deepgram"

const TRANSCRIPTION_LABELS: Record<TranscriptionProvider, { label: string; cloud: boolean }> = {
  deepgram: { label: "Deepgram (Cloud)", cloud: true },
}

/**
 * Displays the current AI models in use for transcription and note generation.
 * Placed in the sidebar between the encounter list and settings bar.
 */
export function ModelIndicator() {
  // Transcription provider is decided server-side (TRANSCRIPTION_PROVIDER), so
  // fetch the resolved value rather than hardcoding a label.
  const [provider, setProvider] = useState<TranscriptionProvider | null>(null)

  useEffect(() => {
    let active = true
    fetch("/api/settings/transcription-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.provider) setProvider(data.provider as TranscriptionProvider)
      })
      .catch(() => {
        /* leave as null; falls back to a neutral label */
      })
    return () => {
      active = false
    }
  }, [])

  const transcription = provider ? TRANSCRIPTION_LABELS[provider] : null
  const transcriptionLabel = transcription?.label ?? "Deepgram (Cloud)"
  const TranscriptionIcon = transcription?.cloud === false ? Cpu : Cloud

  const noteModel = "Claude (Cloud)"
  const NoteIcon = Cloud

  return (
    <div className="shrink-0 border-t border-sidebar-border px-4 py-3.5">
      <p className="mb-2.5 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
        Models
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-card text-primary shadow-soft">
            <TranscriptionIcon className="h-3.5 w-3.5" />
          </span>
          <span className="truncate">{transcriptionLabel}</span>
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
