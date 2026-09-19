"use client"

/**
 * The consultation workspace: one consultation, from first recorded word to
 * the filed note. This is the recording / transcription / note-generation
 * flow that used to live in the app's single page, now reached at
 * /consultations/[id]. The stimulated-recall interview has its own tab
 * (/recall) and is not part of this view.
 *
 * Lifecycle: the encounter is created from the patient chart or the
 * consultations tab (mode + reason chosen there; the latter may leave it
 * untied from any patient); this page starts in a ready state (record or
 * upload), runs the capture pipeline, and hands the result to the note editor
 * for editing and approval. Approving files the note back to the patient's
 * chart, or just to the consultations list when there is no patient.
 */

import { useState, useCallback, useRef, useEffect } from "react"
import Link from "next/link"
import { ArrowLeft, FileQuestion, Loader2, Mic, Upload } from "lucide-react"
import {
  createFinalUploadFailure,
  createPipelineError,
  toFinalUploadWorkflowError,
  toPipelineError,
  type PipelineError,
} from "@pipeline-errors"
import type { Encounter, TranscriptWordSpan } from "@storage/types"
import { ErrorBoundary, PermissionsDialog, useEncounters, useHttpsWarning } from "@ui"
import { Button } from "@ui/lib/ui/button"
import { NoteEditor } from "@note-rendering"
import { useAudioRecorder, type RecordedSegment, warmupMicrophonePermission } from "@audio"
import { formatKeyterms, resolveKeyterms, useSegmentUpload, type UploadCapability, type UploadError } from "@transcription"
import { detectRecallExchanges, generateClinicalNote } from "@/app/actions"
import { takeConsultationIntent } from "@/lib/consultation-intent"
import {
  appendAudioSource,
  compressForUpload,
  fetchUploadCapability,
  stageAudio,
  transcriptionApiUrl,
} from "@/lib/transcription-upload"
import {
  appendNoteVersion,
  noteVersionsOf,
  getPatient,
  getPreferences,
  debugLog,
  debugLogPHI,
  debugError,
  debugWarn,
  saveEncounterAudio,
  loadByokApiKeys,
  writeAuditEntry,
} from "@storage"
import { TopBar } from "../../top-bar"

type LivePhase = "recording" | "processing" | null

type StepStatus = "pending" | "in-progress" | "done" | "failed"

const SEGMENT_DURATION_MS = 10000
const OVERLAP_MS = 250

function resolveApiBaseUrl(): string {
  if (typeof window === "undefined") return ""
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim()
  if (configured) {
    return configured.replace(/\/+$/, "")
  }
  const origin = window.location?.origin
  if (origin && origin !== "null") {
    return origin
  }
  return "http://localhost:3001"
}

interface ArchivePayload {
  session_id: string
  encounter: {
    id: string
    patient_name: string
    patient_id: string
    /** NHS number of the chart patient, recorded in metadata.json. */
    patient_nhs_number?: string
    visit_reason: string
    language: string
    created_at: string
    recording_duration?: number
  }
  /** Omitted for consultations that have no note yet. */
  note?: string
  /** Version of `note` in the trail: 0 = first note, then each saved edit. */
  note_version?: number
  /** True when `note` is the approved version filed to the record. */
  note_approved?: boolean
  /** Provenance of this note version: generated | manual | edited | approved. */
  note_source?: string
  transcript: string
  /** Keyterm vocabulary applied to this consultation, newline-separated. */
  keyterms: string
}

interface ArchiveResponse {
  ok?: boolean
  skipped?: boolean
  folderId?: string
  folderUrl?: string
}

/**
 * Ask the server to finish archiving a completed consultation (phase 2: note +
 * metadata manifest) to the configured storage backend. The heavy artifacts
 * (audio + raw transcript) were already uploaded by the transcription request,
 * so this carries only the note and lightweight encounter metadata. Throws on a
 * non-OK response; callers handle it best-effort.
 */
async function requestArchive(baseUrl: string, payload: ArchivePayload): Promise<ArchiveResponse> {
  const url = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/api/archive/note` : "/api/archive/note"
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(`Archive failed (${res.status})`)
  }
  return (await res.json()) as ArchiveResponse
}

/** Pre-capture state: record the consultation live, or transcribe a file. */
function ReadyPanel({
  encounter,
  onRecord,
  onUpload,
}: {
  encounter: Encounter
  onRecord: () => void
  onUpload: (file: File) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recordingOnly = encounter.mode === "recording_only"

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="animate-fade-up w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-lifted surface">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-primary">
          <Mic className="h-6 w-6" />
        </span>
        <h2 className="mt-5 font-display text-2xl font-medium tracking-tight text-foreground">Ready to record</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {recordingOnly
            ? "The consultation is recorded and transcribed; you write the clinical note afterwards."
            : "The consultation is recorded and transcribed, and the scribe drafts the clinical note for your review."}
        </p>
        <Button
          onClick={onRecord}
          className="mt-6 w-full rounded-full bg-primary py-5 text-primary-foreground shadow-soft hover:bg-brand-strong"
        >
          <Mic className="mr-2 h-4 w-4" />
          Start recording
        </Button>
        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (file) onUpload(file)
          }}
        />
        <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full rounded-full">
          <Upload className="mr-2 h-4 w-4" />
          Upload audio file
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">Transcribe an existing recording (WAV, MP3, M4A…).</p>
      </div>
    </div>
  )
}

function ConsultationWorkspaceContent({ encounterId }: { encounterId: string }) {
  const { encounters, updateEncounter, refresh } = useEncounters()
  const encounter = encounters.find((e: Encounter) => e.id === encounterId)

  const httpsWarning = useHttpsWarning()

  const [live, setLive] = useState<LivePhase>(null)
  const [transcriptionStatus, setTranscriptionStatus] = useState<StepStatus>("pending")
  const [noteGenerationStatus, setNoteGenerationStatus] = useState<StepStatus>("pending")
  const [transcriptionErrorMessage, setTranscriptionErrorMessage] = useState("")
  const [sessionId, setSessionId] = useState<string | null>(null)
  // Whether the active transcription provider streams live segments during
  // recording. Deepgram (the only provider) is final-pass only, so this
  // defaults false; the server confirms via /api/settings/transcription-status.
  const [liveSegmentsEnabled, setLiveSegmentsEnabled] = useState(false)
  // Retained as pipeline-error state (set by every failure path); the visible
  // error surface is the capture tab's error rows via transcriptionErrorMessage.
  const [_workflowError, setWorkflowError] = useState<PipelineError | null>(null)

  const sessionIdRef = useRef<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const finalTranscriptRef = useRef<string>("")
  const finalRecordingRef = useRef<Blob | null>(null)
  const apiBaseUrlRef = useRef<string>(resolveApiBaseUrl())

  const [showPermissionsDialog, setShowPermissionsDialog] = useState(false)
  const [preferredInputDeviceId, setPreferredInputDeviceId] = useState("")
  const [micPermissionStatus, setMicPermissionStatus] = useState("unknown")
  // Written by every failure path for parity with the old flow's diagnostics;
  // the settings dialog (top bar) surfaces its own readiness state instead.
  const [, setLastFailureCode] = useState("")

  // Encounters hydrate asynchronously from encrypted storage; give them a
  // beat before declaring the consultation missing.
  const [hydrationGraceOver, setHydrationGraceOver] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setHydrationGraceOver(true), 1500)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    setPreferredInputDeviceId(getPreferences().preferredInputDeviceId || "")
  }, [])

  // Surface the consultation's capture mode on <html> so the stylesheet flips
  // the brand accent (blue = scribed, green = recording-only) while inside
  // this consultation; restore the neutral accent on leave.
  useEffect(() => {
    document.documentElement.dataset.captureMode =
      encounter?.mode === "recording_only" ? "recording_only" : "scribed"
    return () => {
      document.documentElement.dataset.captureMode = "scribed"
    }
  }, [encounter?.mode])

  const refreshMicPermissionStatus = useCallback(async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.permissions?.query) {
        const status = await navigator.permissions.query({ name: "microphone" as PermissionName })
        setMicPermissionStatus(status.state)
        return
      }
    } catch {
      // Permissions API not supported for "microphone" in this browser.
    }
    setMicPermissionStatus("unknown")
  }, [])

  // Warm up microphone permission once on mount so the first recording starts fast.
  const permissionsPrimedRef = useRef(false)
  useEffect(() => {
    if (permissionsPrimedRef.current) return
    permissionsPrimedRef.current = true
    void warmupMicrophonePermission()
    void refreshMicPermissionStatus()
  }, [refreshMicPermissionStatus])

  const runMicReadinessCheck = useCallback(
    async (showPromptOnFailure = true): Promise<boolean> => {
      try {
        await refreshMicPermissionStatus()
        const warmed = await warmupMicrophonePermission()
        if (!warmed && showPromptOnFailure) {
          setLastFailureCode("MIC_STREAM_UNAVAILABLE")
          setTranscriptionErrorMessage("Unable to access microphone. Check permission and selected input device.")
          setShowPermissionsDialog(true)
        }
        return warmed
      } catch {
        if (showPromptOnFailure) {
          setLastFailureCode("MIC_STREAM_UNAVAILABLE")
          setTranscriptionErrorMessage("Microphone readiness check failed. Please verify permission and retry.")
          setShowPermissionsDialog(true)
        }
        return false
      }
    },
    [refreshMicPermissionStatus],
  )

  const handlePermissionsComplete = async () => {
    const ready = await runMicReadinessCheck(false)
    if (ready) {
      setShowPermissionsDialog(false)
      void warmupMicrophonePermission()
    }
  }

  const isBlankTranscriptText = useCallback((value: string): boolean => {
    const normalized = value.trim().toLowerCase()
    return (
      normalized.length === 0 ||
      normalized === "[blank_audio]" ||
      normalized === "audio file too small or empty" ||
      normalized === "no speech detected in audio" ||
      normalized === "none"
    )
  }, [])

  const handleUploadError = useCallback((error: UploadError) => {
    setWorkflowError(error)
    setTranscriptionStatus("failed")
    debugError("Segment upload failed:", error.code, "-", error.message)
    if (
      error.code.toLowerCase() === "blank_audio" ||
      (error.code === "validation_error" && error.message.toLowerCase().includes("blank_audio"))
    ) {
      setLastFailureCode("TRANSCRIPTION_BLANK_AUDIO")
      setTranscriptionErrorMessage("No speech signal detected. Check microphone input/device and retry.")
    }
  }, [])

  const { enqueueSegment, resetQueue } = useSegmentUpload(sessionId, {
    onError: handleUploadError,
    apiBaseUrl: apiBaseUrlRef.current || undefined,
  })

  const cleanupSession = useCallback(() => {
    debugLog("[Cleanup] Closing EventSource connection")
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    sessionIdRef.current = null
    setSessionId(null)
    resetQueue()
  }, [resetQueue])

  const handleSegmentReady = useCallback(
    (segment: RecordedSegment) => {
      if (!sessionIdRef.current) return
      enqueueSegment({
        seqNo: segment.seqNo,
        startMs: segment.startMs,
        endMs: segment.endMs,
        durationMs: segment.durationMs,
        overlapMs: segment.overlapMs,
        blob: segment.blob,
      })
    },
    [enqueueSegment],
  )

  const {
    isPaused,
    duration,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    error: recordingError,
    analyser,
  } = useAudioRecorder({
    onSegmentReady: handleSegmentReady,
    segmentDurationMs: SEGMENT_DURATION_MS,
    overlapMs: OVERLAP_MS,
    preferredInputDeviceId,
    emitSegments: liveSegmentsEnabled,
  })

  // Ask the server which transcription provider is active and whether it
  // streams live segments. Runs once on mount, well before recording starts.
  useEffect(() => {
    let active = true
    const baseUrl = apiBaseUrlRef.current
    const url = baseUrl
      ? `${baseUrl.replace(/\/+$/, "")}/api/settings/transcription-status`
      : "/api/settings/transcription-status"
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data && typeof data.liveSegments === "boolean") {
          setLiveSegmentsEnabled(data.liveSegments)
        }
      })
      .catch(() => {
        /* leave default */
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (recordingError) {
      debugError("Recording error:", recordingError)
      setLastFailureCode(micPermissionStatus === "denied" ? "MIC_PERMISSION_DENIED" : "MIC_STREAM_UNAVAILABLE")
      setTranscriptionErrorMessage("Recording failed. Check microphone permission and selected input device.")
      setWorkflowError(
        toPipelineError(recordingError, {
          code: "capture_error",
          message: "Recording failed. Check microphone permission and selected input device.",
          recoverable: true,
        }),
      )
      setTranscriptionStatus("failed")
    }
  }, [micPermissionStatus, recordingError])

  // Stable refs so SSE listeners never force EventSource recreation.
  const updateEncounterRef = useRef(updateEncounter)
  const encountersRef = useRef(encounters)
  const refreshRef = useRef(refresh)
  useEffect(() => {
    updateEncounterRef.current = updateEncounter
    encountersRef.current = encounters
    refreshRef.current = refresh
  }, [updateEncounter, encounters, refresh])

  const handleSegmentEvent = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { stitched_text?: string; transcript?: string }
        const transcript = data.stitched_text || data.transcript || ""
        if (!transcript) return
        void updateEncounterRef.current(encounterId, { transcript_text: transcript })
      } catch (error) {
        debugError("Failed to parse segment event", error)
      }
    },
    [encounterId],
  )

  // Best-effort: archive the consultation (phase 2: note + metadata; `note` is
  // omitted while none exists). Runs detached so it never blocks the UI, and
  // an archival outage or missing config never fails the encounter — it only
  // updates the archive statuses.
  const archiveEncounter = useCallback(
    (transcript: string, note?: string, noteVersion?: number, noteApproved?: boolean, noteSource?: string) => {
      void (async () => {
        const enc = encountersRef.current.find((e: Encounter) => e.id === encounterId)
        if (!enc?.session_id) return
        const patient = getPatient(enc.patient_id)
        const noteStatus = (status: Encounter["note_archive_status"]) =>
          note !== undefined ? { note_archive_status: status } : {}
        try {
          const data = await requestArchive(apiBaseUrlRef.current, {
            session_id: enc.session_id,
            encounter: {
              id: enc.id,
              patient_name: enc.patient_name,
              patient_id: enc.patient_id,
              patient_nhs_number: patient?.nhs_number,
              visit_reason: enc.visit_reason,
              language: enc.language,
              created_at: enc.created_at,
              recording_duration: enc.recording_duration,
            },
            note,
            note_version: note !== undefined ? (noteVersion ?? 0) : undefined,
            note_approved: note !== undefined ? Boolean(noteApproved) : undefined,
            note_source: note !== undefined ? noteSource : undefined,
            transcript,
            keyterms: formatKeyterms(resolveKeyterms(getPreferences().keytermsOverride)),
          })
          if (data.skipped) {
            await updateEncounterRef.current(encounterId, { archive_status: "skipped", ...noteStatus("skipped") })
          } else {
            await updateEncounterRef.current(encounterId, {
              archive_status: "archived",
              archive_location: data.folderId,
              archived_at: new Date().toISOString(),
              ...noteStatus("archived"),
            })
            debugLog(`✅ Consultation archived (container ${data.folderId})`)
          }
        } catch (archiveError) {
          debugError("Archive failed", archiveError)
          await updateEncounterRef.current(encounterId, { archive_status: "failed", ...noteStatus("failed") })
        }
      })()
    },
    [encounterId],
  )

  /**
   * Recording-only mode: the consultation is transcribed and archived for the
   * study's stimulated-recall layer; the clinician writes the note manually.
   */
  const completeRecordingOnlyEncounter = useCallback(
    async (transcript: string) => {
      debugLog(`Recording-only encounter ${encounterId}: skipping note generation`)
      await updateEncounterRef.current(encounterId, { status: "completed" })
      await refreshRef.current()
      setWorkflowError(null)
      setLive(null)
      archiveEncounter(transcript)
    },
    [archiveEncounter, encounterId],
  )

  /**
   * Stimulated recall: bracket the transcript's question–answer exchanges.
   * Launched beside note generation (both arms) and never awaited by the
   * capture flow; a failure is logged and the recall view falls back to a
   * question-mark heuristic, retrying detection when it opens.
   */
  const detectExchangesForEncounter = useCallback(
    async (transcript: string) => {
      try {
        const byokKeys = await loadByokApiKeys()
        const analysis = await detectRecallExchanges({ transcript }, { anthropicApiKey: byokKeys.anthropicApiKey })
        await updateEncounterRef.current(encounterId, { recall_analysis: analysis })
        debugLog(`✅ Recall exchanges saved to encounter (${analysis.exchanges.length})`)
      } catch (err) {
        debugError("Recall exchange detection failed:", err)
      }
    },
    [encounterId],
  )

  const processEncounterForNoteGeneration = useCallback(
    async (transcript: string) => {
      const enc = encountersRef.current.find((e: Encounter) => e.id === encounterId)
      const patientName = enc?.patient_name || ""
      const visitReason = enc?.visit_reason || ""

      debugLog("GENERATING CLINICAL NOTE")
      debugLog(`Encounter ID: ${encounterId}`)
      debugLogPHI(`Patient: ${patientName || "Unknown"}`)
      debugLogPHI(`Visit Reason: ${visitReason || "Not provided"}`)
      debugLog(`Transcript length: ${transcript.length} characters`)

      setNoteGenerationStatus("in-progress")
      try {
        // BYOK sessions supply their own Anthropic key; the server refuses to
        // use its env key for them.
        const byokKeys = await loadByokApiKeys()
        const note = await generateClinicalNote(
          {
            transcript,
            patient_name: patientName,
            visit_reason: visitReason,
          },
          { anthropicApiKey: byokKeys.anthropicApiKey },
        )
        const current = encountersRef.current.find((e: Encounter) => e.id === encounterId)
        const versionUpdates = current ? appendNoteVersion(current, "generated", note) : { note_text: note }
        await updateEncounterRef.current(encounterId, {
          ...versionUpdates,
          status: "completed",
        })
        await refreshRef.current()
        setNoteGenerationStatus("done")
        setWorkflowError(null)
        debugLog("✅ Clinical note saved to encounter")
        setLive(null)
        archiveEncounter(transcript, note, versionUpdates.note_version ?? 0, false, "generated")
      } catch (err) {
        debugError("❌ Note generation failed:", err)
        setWorkflowError(
          toPipelineError(err, {
            code: "note_generation_error",
            message: "Failed to generate clinical note",
            recoverable: true,
          }),
        )
        setNoteGenerationStatus("failed")
        await updateEncounterRef.current(encounterId, { status: "note_generation_failed" })
        await refreshRef.current()
      }
    },
    [archiveEncounter, encounterId],
  )

  const handleFinalEvent = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          final_transcript?: string
          final_transcript_words?: TranscriptWordSpan[] | null
        }
        const transcript = data.final_transcript || ""
        const transcriptWords = data.final_transcript_words ?? []
        if (!transcript) return
        if (isBlankTranscriptText(transcript)) {
          setTranscriptionErrorMessage("No speech signal detected. Check microphone input/device and retry.")
          setTranscriptionStatus("failed")
          setNoteGenerationStatus("pending")
          return
        }
        finalTranscriptRef.current = transcript
        setTranscriptionErrorMessage("")
        setTranscriptionStatus("done")
        void (async () => {
          await updateEncounterRef.current(encounterId, {
            transcript_text: transcript,
            transcript_confidence: transcriptWords,
          })
          await refreshRef.current()
          void detectExchangesForEncounter(transcript)
          const mode = encountersRef.current.find((e: Encounter) => e.id === encounterId)?.mode
          if (mode === "recording_only") {
            await completeRecordingOnlyEncounter(transcript)
          } else {
            await processEncounterForNoteGeneration(transcript)
          }
        })()
        cleanupSession()
      } catch (error) {
        debugError("Failed to parse final transcript event", error)
      }
    },
    [
      cleanupSession,
      completeRecordingOnlyEncounter,
      detectExchangesForEncounter,
      encounterId,
      isBlankTranscriptText,
      processEncounterForNoteGeneration,
    ],
  )

  // The upload calls apply a transcript from their own response through the
  // same handler; a ref so their stable callbacks always see the latest one.
  const handleFinalEventRef = useRef(handleFinalEvent)
  useEffect(() => {
    handleFinalEventRef.current = handleFinalEvent
  }, [handleFinalEvent])

  /**
   * Apply the transcript carried in the upload route's own response. The
   * stream delivers the same payload, but from an in-memory store that a
   * different serverless instance may never see; the response cannot miss.
   * Whichever arrives first wins and the other is a no-op.
   */
  const applyFinalFromResponse = useCallback(async (response: Response) => {
    let body: { final_transcript?: string } = {}
    try {
      body = (await response.clone().json()) as typeof body
    } catch {
      return
    }
    if (!body.final_transcript || finalTranscriptRef.current) return
    handleFinalEventRef.current(new MessageEvent("final", { data: JSON.stringify(body) }))
  }, [])

  const handleStreamError = useCallback((event: MessageEvent | Event) => {
    const readyState = eventSourceRef.current?.readyState
    const hasFinalTranscript = Boolean(finalTranscriptRef.current?.trim())
    const hasActiveSession = Boolean(sessionIdRef.current)

    // EventSource commonly emits a terminal "error" event on normal close.
    // Do not mark processing as failed if we already have final transcript or session is closed.
    if (hasFinalTranscript || !hasActiveSession) {
      debugWarn("Transcription stream closed", { readyState, hasFinalTranscript, hasActiveSession })
      return
    }

    debugError("Transcription stream error", { event, readyState, apiBaseUrl: apiBaseUrlRef.current })
    let streamMessage = "Transcription stream error. Please retry."
    if ("data" in event && typeof event.data === "string" && event.data.length > 0) {
      try {
        const parsed = JSON.parse(event.data) as { code?: string; message?: string }
        const code = (parsed.code || "").toLowerCase()
        if (code === "blank_audio") {
          streamMessage = "No speech signal detected. Check microphone input/device and retry."
        } else if (parsed.message) {
          streamMessage = parsed.message
        }
      } catch {
        // Keep default message for non-JSON or malformed payloads.
      }
    }
    setTranscriptionErrorMessage(streamMessage)
    setWorkflowError(createPipelineError("network_error", streamMessage, true, { readyState }))
    setTranscriptionStatus("failed")
  }, [])

  useEffect(() => {
    if (!sessionId) return

    debugLog("[EventSource] Connecting to session:", sessionId)
    const baseUrl = apiBaseUrlRef.current
    const streamUrl = baseUrl
      ? `${baseUrl.replace(/\/+$/, "")}/api/transcription/stream/${sessionId}`
      : `/api/transcription/stream/${sessionId}`
    const source = new EventSource(streamUrl)
    eventSourceRef.current = source

    const segmentListener = (event: Event) => handleSegmentEvent(event as MessageEvent)
    const finalListener = (event: Event) => handleFinalEvent(event as MessageEvent)
    const errorListener = (event: Event) => handleStreamError(event)

    source.addEventListener("segment", segmentListener)
    source.addEventListener("final", finalListener)
    source.addEventListener("error", errorListener)

    return () => {
      debugLog("[EventSource] Cleanup: closing connection for session:", sessionId)
      source.removeEventListener("segment", segmentListener)
      source.removeEventListener("final", finalListener)
      source.removeEventListener("error", errorListener)
      source.close()
      if (eventSourceRef.current === source) {
        eventSourceRef.current = null
      }
    }
  }, [handleFinalEvent, handleSegmentEvent, handleStreamError, sessionId])

  // Cleanup EventSource on page unload/refresh. Deliberately NOT on
  // visibilitychange: the stream carries the pipeline's `final` event, and
  // closing it while the tab is hidden (e.g. the clinician switches to the
  // patient chart during transcription) dropped the result with no way to
  // re-subscribe.
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [])

  const startNewSession = useCallback(
    (id: string) => {
      sessionIdRef.current = id
      setSessionId(id)
      resetQueue()
    },
    [resetQueue],
  )

  const handleStartRecording = async () => {
    if (!encounter) return
    try {
      const micReady = await runMicReadinessCheck(true)
      if (!micReady) {
        return
      }
      cleanupSession()
      finalTranscriptRef.current = ""
      finalRecordingRef.current = null
      setTranscriptionErrorMessage("")
      setTranscriptionStatus("pending")
      setNoteGenerationStatus("pending")

      const session = crypto.randomUUID()
      startNewSession(session)

      await updateEncounter(encounter.id, {
        status: "recording",
        session_id: session,
        transcript_text: "",
        // Drop any prior spans with the transcript they indexed into.
        transcript_confidence: [],
      })

      // Optimistically flip to recording immediately for responsive UI.
      setLive("recording")
      setTranscriptionStatus("in-progress")
      setWorkflowError(null)
      await startRecording()
    } catch (err) {
      debugError("Failed to start recording:", err)
      const message = err instanceof Error ? err.message.toLowerCase() : ""
      if (message.includes("denied") || message.includes("permission")) {
        setLastFailureCode("MIC_PERMISSION_DENIED")
      } else {
        setLastFailureCode("MIC_STREAM_UNAVAILABLE")
      }
      setTranscriptionErrorMessage("Failed to start recording. Check microphone input/device and permissions.")
      setWorkflowError(
        toPipelineError(err, {
          code: "capture_error",
          message: "Failed to start recording",
          recoverable: true,
        }),
      )
      setTranscriptionStatus("failed")
      setLive(null)
      await updateEncounter(encounter.id, { status: "idle" })
    }
  }

  const uploadFinalRecording = useCallback(
    async (activeSessionId: string, blob: Blob, encId: string, createdAt: string, attempt = 1): Promise<void> => {
      try {
        // Recordings are raw 16 kHz mono WAV (~1.9 MB/min). Compress to MP3 at the
        // best bitrate the upload path allows: 64 kbps when the audio can be staged
        // in the Blob store, squeezed to the request-body limit otherwise. The raw
        // WAV goes only if compression itself fails.
        const baseUrl = apiBaseUrlRef.current
        const capability = await fetchUploadCapability(baseUrl)
        const file = await compressForUpload(
          new File([blob], `${activeSessionId}-full.wav`, { type: blob.type || "audio/wav" }),
          capability,
          "final",
        )

        // Keep a local copy so the clinician can listen back later. Best-effort.
        if (encId) {
          void saveEncounterAudio(encId, file).catch((e) => debugWarn("Failed to store recording for playback", e))
        }

        const source = await stageAudio(file, capability, baseUrl)
        const formData = new FormData()
        formData.append("session_id", activeSessionId)
        appendAudioSource(formData, source)
        // Sent so the server can file the phase-1 artifacts (audio + raw
        // transcript) under the same per-consult container the note upload uses.
        if (encId) formData.append("encounter_id", encId)
        if (createdAt) formData.append("created_at", createdAt)
        // Keyterm vocabulary is a client-side setting, so it rides with the
        // request rather than being read from server config.
        formData.append("keyterms", formatKeyterms(resolveKeyterms(getPreferences().keytermsOverride)))
        const url = transcriptionApiUrl(baseUrl, "/api/transcription/upload")
        // BYOK sessions supply their own Deepgram key with each request.
        const byokKeys = await loadByokApiKeys()
        const response = await fetch(url, {
          method: "POST",
          headers: byokKeys.deepgramApiKey ? { "x-deepgram-key": byokKeys.deepgramApiKey } : undefined,
          body: formData,
        })
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500
          if (retryable && attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
            return uploadFinalRecording(activeSessionId, blob, encId, createdAt, attempt + 1)
          }
          let serverError: unknown = null
          try {
            const body = (await response.json()) as { error?: unknown }
            serverError = body?.error
          } catch {
            // ignore JSON parse failures
          }
          const failure = createFinalUploadFailure(response.status, serverError)
          const parsedError = failure.parsedError
          if (parsedError) {
            setWorkflowError(parsedError)
            if (String(parsedError.code).toLowerCase() === "blank_audio") {
              setLastFailureCode("TRANSCRIPTION_BLANK_AUDIO")
              setTranscriptionErrorMessage("No speech signal detected. Check microphone input/device and retry.")
            } else {
              setTranscriptionErrorMessage(parsedError.message)
            }
            throw failure.error
          }
          if (failure.error.message.toLowerCase().includes("blank audio")) {
            setLastFailureCode("TRANSCRIPTION_BLANK_AUDIO")
            setTranscriptionErrorMessage("No speech signal detected. Check microphone input/device and retry.")
          } else {
            setTranscriptionErrorMessage(failure.error.message || `Final upload failed (${response.status})`)
          }
          throw failure.error
        }
        await applyFinalFromResponse(response)
      } catch (error) {
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
          return uploadFinalRecording(activeSessionId, blob, encId, createdAt, attempt + 1)
        }
        debugError("Failed to upload final recording:", error)
        setTranscriptionErrorMessage((previous) => previous || "Transcription failed. Please retry.")
        const finalUploadWorkflowError = toFinalUploadWorkflowError(error)
        if (finalUploadWorkflowError) {
          setWorkflowError(finalUploadWorkflowError)
        }
        setTranscriptionStatus("failed")
        throw error
      }
    },
    [applyFinalFromResponse],
  )

  const uploadAudioFile = useCallback(
    async (
      activeSessionId: string,
      file: File,
      capability: UploadCapability,
      encId: string,
      createdAt: string,
    ): Promise<void> => {
      // Keep a local copy for later playback (best-effort).
      if (encId) {
        void saveEncounterAudio(encId, file).catch((e) => debugWarn("Failed to store recording for playback", e))
      }
      const baseUrl = apiBaseUrlRef.current
      const url = transcriptionApiUrl(baseUrl, "/api/transcription/upload")
      const maxAttempts = 3
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let response: Response
        try {
          // Staged afresh on every attempt: the server discards the staged copy
          // once it has answered, whatever the answer was.
          const source = await stageAudio(file, capability, baseUrl)
          const formData = new FormData()
          formData.append("session_id", activeSessionId)
          appendAudioSource(formData, source)
          if (encId) formData.append("encounter_id", encId)
          if (createdAt) formData.append("created_at", createdAt)
          formData.append("keyterms", formatKeyterms(resolveKeyterms(getPreferences().keytermsOverride)))
          // BYOK sessions supply their own Deepgram key with each request.
          const byokKeys = await loadByokApiKeys()
          response = await fetch(url, {
            method: "POST",
            headers: byokKeys.deepgramApiKey ? { "x-deepgram-key": byokKeys.deepgramApiKey } : undefined,
            body: formData,
          })
        } catch (networkError) {
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
            continue
          }
          debugError("Failed to upload audio file:", networkError)
          setTranscriptionErrorMessage((previous) => previous || "Transcription failed. Please retry.")
          const workflowError = toFinalUploadWorkflowError(networkError)
          if (workflowError) setWorkflowError(workflowError)
          setTranscriptionStatus("failed")
          throw networkError
        }

        if (response.ok) {
          await applyFinalFromResponse(response)
          return
        }

        const retryable = response.status === 429 || response.status >= 500
        if (retryable && attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
          continue
        }

        if (response.status === 413) {
          const message =
            "This recording is too large for the server's request limit (~4.5 MB). Attach a Blob store to lift it, or try a shorter file."
          setTranscriptionErrorMessage(message)
          setWorkflowError(createPipelineError("file_too_large", message, true))
          setTranscriptionStatus("failed")
          throw new Error(message)
        }

        let serverError: unknown = null
        try {
          const body = (await response.json()) as { error?: unknown }
          serverError = body?.error
        } catch {
          // ignore JSON parse failures
        }
        const failure = createFinalUploadFailure(response.status, serverError)
        const parsedError = failure.parsedError
        if (parsedError) {
          setWorkflowError(parsedError)
          if (String(parsedError.code).toLowerCase() === "blank_audio") {
            setLastFailureCode("TRANSCRIPTION_BLANK_AUDIO")
            setTranscriptionErrorMessage("No detectable speech in the uploaded file. Check the audio and try again.")
          } else {
            setTranscriptionErrorMessage(parsedError.message)
          }
        } else {
          setTranscriptionErrorMessage(failure.error.message || `Upload failed (${response.status})`)
        }
        setTranscriptionStatus("failed")
        throw failure.error
      }
    },
    [applyFinalFromResponse],
  )

  const handleUploadRecording = async (file: File) => {
    if (!encounter) return
    try {
      cleanupSession()
      finalTranscriptRef.current = ""
      finalRecordingRef.current = null
      setTranscriptionErrorMessage("")
      setWorkflowError(null)
      setTranscriptionStatus("in-progress")
      setNoteGenerationStatus("pending")

      const session = crypto.randomUUID()
      // Subscribes the SSE stream (via sessionId) before the upload POST begins,
      // so the server-pushed `final` event is received.
      startNewSession(session)

      await updateEncounter(encounter.id, {
        status: "processing",
        session_id: session,
        transcript_text: "",
        // Drop any prior spans with the transcript they indexed into.
        transcript_confidence: [],
      })
      setLive("processing")

      // Compress in the browser (16 kHz mono MP3) at the best bitrate the upload
      // path allows; the original goes only if it cannot be decoded.
      const capability = await fetchUploadCapability(apiBaseUrlRef.current)
      const uploadFile = await compressForUpload(file, capability, "upload")

      await uploadAudioFile(session, uploadFile, capability, encounter.id, encounter.created_at)
    } catch (err) {
      debugError("Failed to upload recording:", err)
      setTranscriptionErrorMessage((previous) => previous || "Failed to transcribe the uploaded file.")
      setTranscriptionStatus("failed")
    }
  }

  // Dispatch the launch intent chosen in the chart's start dialog (record now,
  // or transcribe an uploaded file) once the encounter has loaded. The intent
  // store is module memory: after a hard refresh there is none and the ready
  // panel takes over.
  const intentDispatchedRef = useRef(false)
  useEffect(() => {
    if (!encounter || intentDispatchedRef.current) return
    const intent = takeConsultationIntent(encounter.id)
    if (!intent) return
    intentDispatchedRef.current = true
    if (intent.action === "record") {
      void handleStartRecording()
    } else {
      void handleUploadRecording(intent.file)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounter?.id])

  const handleStopRecording = async () => {
    if (!encounter) return

    await updateEncounter(encounter.id, {
      status: "processing",
      recording_duration: duration,
    })
    setLive("processing")

    const audioBlob = await stopRecording()
    if (audioBlob) {
      // Store the raw recording immediately so playback appears the moment the
      // capture stops; the compressed copy replaces it once upload prep is done.
      void saveEncounterAudio(
        encounter.id,
        new File([audioBlob], `${encounter.id}-recording.wav`, { type: audioBlob.type || "audio/wav" }),
      ).catch((e) => debugWarn("Failed to store raw recording for playback", e))
    }
    if (!audioBlob) {
      setTranscriptionErrorMessage("No recording captured. Check microphone input/device and retry.")
      setWorkflowError(
        createPipelineError("processing_error", "Failed to finalize recording", true, { stage: "audio-ingest" }),
      )
      setTranscriptionStatus("failed")
      return
    }

    finalRecordingRef.current = audioBlob

    const activeSessionId = sessionIdRef.current
    if (activeSessionId) {
      void uploadFinalRecording(activeSessionId, audioBlob, encounter.id, encounter.created_at)
    } else {
      debugError("Missing session identifier for final upload")
      setTranscriptionErrorMessage("Missing session identifier for transcription.")
      setWorkflowError(createPipelineError("capture_error", "Missing session identifier for final upload", true))
      setTranscriptionStatus("failed")
    }
  }

  const handleRetryTranscription = async () => {
    const blob = finalRecordingRef.current
    const activeSessionId = sessionIdRef.current
    if (!blob || !activeSessionId || !encounter) return
    setTranscriptionErrorMessage("")
    setTranscriptionStatus("in-progress")
    setWorkflowError(null)
    try {
      await uploadFinalRecording(activeSessionId, blob, encounter.id, encounter.created_at)
    } catch {
      // handled in uploadFinalRecording
    }
  }

  const handleRetryNoteGeneration = async () => {
    const transcript = finalTranscriptRef.current || encounter?.transcript_text || ""
    if (!transcript) return
    setWorkflowError(null)
    await processEncounterForNoteGeneration(transcript)
  }

  // Saving an edit records the next version in the note trail; the very first
  // manual save (recording-only arm, or after a failed generation) is v0 with
  // source "manual".
  const handleSaveNote = async (noteText: string) => {
    const enc = encountersRef.current.find((e: Encounter) => e.id === encounterId)
    if (!enc) return
    const source = noteVersionsOf(enc).length > 0 ? "edited" : "manual"
    const updates = appendNoteVersion(enc, source, noteText)
    await updateEncounter(encounterId, { ...updates, status: "completed" })
    archiveEncounter(enc.transcript_text, noteText, updates.note_version, false, source)
  }

  // Approve & file: record the approved version, lock the consultation, and
  // archive the filed note. From here the chart shows it as a filed entry.
  const handleApproveNote = async (noteText: string) => {
    const enc = encountersRef.current.find((e: Encounter) => e.id === encounterId)
    if (!enc) return
    const updates = appendNoteVersion(enc, "approved", noteText)
    const approvedAt = new Date().toISOString()
    await updateEncounter(encounterId, {
      ...updates,
      status: "completed",
      approval_status: "approved",
      approved_at: approvedAt,
    })
    await writeAuditEntry({
      event_type: "note.approved",
      resource_id: encounterId,
      success: true,
      metadata: { note_version: updates.note_version },
    })
    archiveEncounter(enc.transcript_text, noteText, updates.note_version, true, "approved")
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!encounter) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <TopBar />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          {hydrationGraceOver ? (
            <>
              <FileQuestion className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">This consultation does not exist on this device.</p>
              <Link href="/consultations" className="text-sm font-medium text-primary hover:underline">
                Back to consultations
              </Link>
            </>
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>
    )
  }

  // Where "back" goes: the patient's chart when there is one, otherwise the
  // consultations tab (the only place an untied consultation is listed).
  const patient = getPatient(encounter.patient_id)
  const back = patient
    ? { href: `/patients/${patient.id}`, label: `${encounter.patient_name}'s chart` }
    : { href: "/consultations", label: "Consultations" }
  const hasTranscript = Boolean(encounter.transcript_text?.trim())
  const hasNote = Boolean(encounter.note_text?.trim())
  const showReady = !live && !hasTranscript && !hasNote

  const liveState =
    live === "recording"
      ? {
          phase: "recording" as const,
          duration,
          isPaused,
          analyser,
          onStop: handleStopRecording,
          onPause: pauseRecording,
          onResume: resumeRecording,
        }
      : live === "processing"
        ? {
            phase: "processing" as const,
            transcriptionStatus,
            noteGenerationStatus,
            transcriptionErrorMessage,
            onRetryTranscription: handleRetryTranscription,
            onRetryNoteGeneration: handleRetryNoteGeneration,
          }
        : undefined

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {httpsWarning && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-destructive px-4 py-2 text-center text-sm font-semibold text-destructive-foreground">
          {httpsWarning}
        </div>
      )}
      {showPermissionsDialog && (
        <PermissionsDialog onComplete={handlePermissionsComplete} preferredInputDeviceId={preferredInputDeviceId} />
      )}
      <TopBar />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {showReady ? (
          <>
            <div className="shrink-0 border-b border-border bg-card/50 px-8 py-2">
              <Link
                href={back.href}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {back.label}
              </Link>
            </div>
            <ReadyPanel
              encounter={encounter}
              onRecord={() => void handleStartRecording()}
              onUpload={(file) => void handleUploadRecording(file)}
            />
          </>
        ) : (
          <NoteEditor
            encounter={encounter}
            onSave={handleSaveNote}
            onApprove={handleApproveNote}
            live={liveState}
            backLink={
              <Link
                href={back.href}
                title={`Back to ${back.label}`}
                className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
            }
          />
        )}
      </main>
    </div>
  )
}

export function ConsultationWorkspace({ encounterId }: { encounterId: string }) {
  return (
    <ErrorBoundary>
      <ConsultationWorkspaceContent encounterId={encounterId} />
    </ErrorBoundary>
  )
}
