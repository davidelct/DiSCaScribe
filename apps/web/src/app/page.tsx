"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import {
  createFinalUploadFailure,
  createPipelineError,
  toFinalUploadWorkflowError,
  toPipelineError,
  type PipelineError,
} from "@pipeline-errors"
import type { Encounter } from "@storage/types"
import { useEncounters, EncounterList, IdleView, NewEncounterForm, RecordingView, ProcessingView, ErrorBoundary, PermissionsDialog, SettingsDialog, SettingsBar, ModelIndicator, useHttpsWarning } from "@ui"
import { NoteEditor } from "@note-rendering"
import { useAudioRecorder, type RecordedSegment, warmupMicrophonePermission, compressAudioFileToMp3 } from "@audio"
import { useSegmentUpload, type UploadError } from "@transcription";
import { WorkflowErrorDisplay } from "./workflow-error-display"
import { generateClinicalNote } from "@/app/actions"
import {
  getPreferences,
  setPreferences,
  debugLog,
  debugLogPHI,
  debugError,
  debugWarn,
  initializeAuditLog,
} from "@storage"

type ViewState =
  | { type: "idle" }
  | { type: "new-form" }
  | { type: "recording"; encounterId: string }
  | { type: "processing"; encounterId: string }
  | { type: "viewing"; encounterId: string }

type StepStatus = "pending" | "in-progress" | "done" | "failed"
type ProcessingMetrics = {
  processingStartedAt?: number
  processingEndedAt?: number
  transcriptionStartedAt?: number
  transcriptionEndedAt?: number
  noteGenerationStartedAt?: number
  noteGenerationEndedAt?: number
}

const SEGMENT_DURATION_MS = 10000
const OVERLAP_MS = 250

type MicReadinessResult = {
  success: boolean
  code?: string
  userMessage?: string
  metrics?: {
    rms: number
    peak: number
  }
  activeDeviceId?: string
}

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

interface BoxArchivePayload {
  session_id: string
  encounter: {
    id: string
    patient_name: string
    patient_id: string
    visit_reason: string
    language: string
    created_at: string
    recording_duration?: number
  }
  note: string
  transcript: string
}

interface BoxArchiveResponse {
  ok?: boolean
  skipped?: boolean
  folderId?: string
  folderUrl?: string
}

/**
 * Ask the server to finish archiving a completed consultation to Box (phase 2:
 * note + metadata manifest). The heavy artifacts (audio + raw transcript) were
 * already uploaded by the transcription request, so this carries only the note
 * and lightweight encounter metadata. Throws on a non-OK response; callers
 * handle it best-effort.
 */
async function requestBoxArchive(baseUrl: string, payload: BoxArchivePayload): Promise<BoxArchiveResponse> {
  const url = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/api/box/upload` : "/api/box/upload"
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(`Box archive failed (${res.status})`)
  }
  return (await res.json()) as BoxArchiveResponse
}

function HomePageContent() {
  const { encounters, addEncounter, updateEncounter, deleteEncounter: removeEncounter, refresh } = useEncounters()

  // HIPAA Compliance: Warn if production build is served over HTTP
  const httpsWarning = useHttpsWarning()

  const [view, setView] = useState<ViewState>({ type: "idle" })
  const [transcriptionStatus, setTranscriptionStatus] = useState<StepStatus>("pending")
  const [noteGenerationStatus, setNoteGenerationStatus] = useState<StepStatus>("pending")
  const [transcriptionErrorMessage, setTranscriptionErrorMessage] = useState("")
  const [, setProcessingMetrics] = useState<ProcessingMetrics>({})
  const [sessionId, setSessionId] = useState<string | null>(null)
  // Whether the active transcription provider streams live segments during
  // recording. Final-pass-only providers (e.g. Deepgram) set this false so the
  // recorder skips segment chunking/uploads. Defaults true (server confirms).
  const [liveSegmentsEnabled, setLiveSegmentsEnabled] = useState(true)
  const [workflowError, setWorkflowError] = useState<PipelineError | null>(null)

  const currentEncounterIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const finalTranscriptRef = useRef<string>("")
  const finalRecordingRef = useRef<Blob | null>(null)
  const apiBaseUrlRef = useRef<string>(resolveApiBaseUrl())

  const [showPermissionsDialog, setShowPermissionsDialog] = useState(false)
  const permissionsPrimedRef = useRef(false)

  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [preferredInputDeviceId, setPreferredInputDeviceId] = useState("")
  const [audioInputDevices, setAudioInputDevices] = useState<Array<{ id: string; label: string }>>([])
  const [micPermissionStatus, setMicPermissionStatus] = useState("unknown")
  const [lastMicReadiness, setLastMicReadiness] = useState<MicReadinessResult | null>(null)
  const [lastFailureCode, setLastFailureCode] = useState("")

  useEffect(() => {
    const prefs = getPreferences()
    setPreferredInputDeviceId(prefs.preferredInputDeviceId || "")

    // Initialize audit logging system (cleanup old entries, setup periodic cleanup)
    void initializeAuditLog()
  }, [])

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return

    const refreshAudioDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const inputs = devices
          .filter((device) => device.kind === "audioinput")
          .map((device, index) => ({
            id: device.deviceId,
            label: device.label || `Microphone ${index + 1}`,
          }))
        setAudioInputDevices(inputs)
      } catch (error) {
        debugWarn("Failed to enumerate audio input devices", error)
      }
    }

    void refreshAudioDevices()
    navigator.mediaDevices.addEventListener?.("devicechange", refreshAudioDevices)
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", refreshAudioDevices)
  }, [])

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
  useEffect(() => {
    if (permissionsPrimedRef.current) return
    permissionsPrimedRef.current = true
    void warmupMicrophonePermission()
    void refreshMicPermissionStatus()
  }, [refreshMicPermissionStatus])

  const handleOpenSettings = () => {
    setShowSettingsDialog(true)
  }

  const handleCloseSettings = () => {
    setShowSettingsDialog(false)
  }

  const runMicReadinessCheck = useCallback(
    async (showPromptOnFailure = true): Promise<boolean> => {
      try {
        await refreshMicPermissionStatus()
        const warmed = await warmupMicrophonePermission()
        const result: MicReadinessResult = warmed
          ? { success: true }
          : {
              success: false,
              code: "MIC_STREAM_UNAVAILABLE",
              userMessage: "Unable to access microphone. Check permission and selected input device.",
            }
        setLastMicReadiness(result)
        if (!result.success && showPromptOnFailure) {
          setLastFailureCode(result.code || "MIC_STREAM_UNAVAILABLE")
          setTranscriptionErrorMessage(
            result.userMessage || "Microphone is not ready. Check permission and selected input device.",
          )
          setShowPermissionsDialog(true)
          return false
        }
        return !!result.success
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

  const handlePreferredInputDeviceChange = useCallback((value: string) => {
    setPreferredInputDeviceId(value)
    void setPreferences({ preferredInputDeviceId: value })
  }, [])

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
    setProcessingMetrics((prev) => ({
      ...prev,
      transcriptionEndedAt: prev.transcriptionEndedAt ?? Date.now(),
      processingEndedAt: Date.now(),
    }))
    debugError("Segment upload failed:", error.code, "-", error.message);
    if (
      error.code.toLowerCase() === "blank_audio" ||
      (error.code === "validation_error" && error.message.toLowerCase().includes("blank_audio"))
    ) {
      setLastFailureCode("TRANSCRIPTION_BLANK_AUDIO")
      setTranscriptionErrorMessage("No speech signal detected. Check microphone input/device and retry.")
    }
  }, []);

  const { enqueueSegment, resetQueue } = useSegmentUpload(sessionId, {
    onError: handleUploadError,
    apiBaseUrl: apiBaseUrlRef.current || undefined,
  })

  const cleanupSession = useCallback(() => {
    debugLog('[Cleanup] Closing EventSource connection')
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
  } = useAudioRecorder({
    onSegmentReady: handleSegmentReady,
    segmentDurationMs: SEGMENT_DURATION_MS,
    overlapMs: OVERLAP_MS,
    preferredInputDeviceId,
    emitSegments: liveSegmentsEnabled,
  })

  // Ask the server which transcription provider is active and whether it streams
  // live segments. Runs once on mount, well before any recording can start.
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
        /* leave default (live segments enabled) */
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

  // Stable ref for updateEncounter to avoid EventSource recreation
  const updateEncounterRef = useRef(updateEncounter)
  useEffect(() => {
    updateEncounterRef.current = updateEncounter
  }, [updateEncounter])

  const handleSegmentEvent = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          stitched_text?: string
          transcript?: string
        }
        const transcript = data.stitched_text || data.transcript || ""
        if (!transcript) return
        const encounterId = currentEncounterIdRef.current
        if (encounterId) {
          void updateEncounterRef.current(encounterId, { transcript_text: transcript })
        }
      } catch (error) {
        debugError("Failed to parse segment event", error)
      }
    },
    [], // No dependencies - uses refs instead
  )

  // Stable refs to avoid EventSource recreation
  const encountersRef = useRef(encounters)
  const refreshRef = useRef(refresh)

  useEffect(() => {
    encountersRef.current = encounters
    refreshRef.current = refresh
  }, [encounters, refresh])

  const processEncounterForNoteGeneration = useCallback(
    async (encounterId: string, transcript: string) => {
      const enc = encountersRef.current.find((e: Encounter) => e.id === encounterId)
      const patientName = enc?.patient_name || ""
      const visitReason = enc?.visit_reason || ""

      debugLog("\n" + "=".repeat(80))
      debugLog("GENERATING CLINICAL NOTE")
      debugLog("=".repeat(80))
      debugLog(`Encounter ID: ${encounterId}`)
      debugLogPHI(`Patient: ${patientName || "Unknown"}`)
      debugLogPHI(`Visit Reason: ${visitReason || "Not provided"}`)
      debugLog(`Transcript length: ${transcript.length} characters`)
      debugLog("=".repeat(80) + "\n")

      setNoteGenerationStatus("in-progress")
      setProcessingMetrics((prev) => ({
        ...prev,
        transcriptionEndedAt: prev.transcriptionEndedAt ?? Date.now(),
        noteGenerationStartedAt: prev.noteGenerationStartedAt ?? Date.now(),
      }))
      try {
        const note = await generateClinicalNote({
          transcript,
          patient_name: patientName,
          visit_reason: visitReason,
        })
        await updateEncounterRef.current(encounterId, {
          note_text: note,
          status: "completed",
        })
        await refreshRef.current()
        setNoteGenerationStatus("done")
        setWorkflowError(null)
        setProcessingMetrics((prev) => ({
          ...prev,
          noteGenerationEndedAt: Date.now(),
          processingEndedAt: Date.now(),
        }))
        debugLog("✅ Clinical note saved to encounter")
        debugLog("\n" + "=".repeat(80))
        debugLog("ENCOUNTER PROCESSING COMPLETE")
        debugLog("=".repeat(80) + "\n")
        setView({ type: "viewing", encounterId })

        // Best-effort: archive the completed consultation (audio + transcript +
        // raw transcript + note + metadata) to Box. Runs detached so it never
        // blocks the UI, and a Box outage or missing config never fails the
        // encounter — it only updates box_status.
        void (async () => {
          const enc = encountersRef.current.find((e: Encounter) => e.id === encounterId)
          if (!enc?.session_id) return
          try {
            const data = await requestBoxArchive(apiBaseUrlRef.current, {
              session_id: enc.session_id,
              encounter: {
                id: enc.id,
                patient_name: enc.patient_name,
                patient_id: enc.patient_id,
                visit_reason: enc.visit_reason,
                language: enc.language,
                created_at: enc.created_at,
                recording_duration: enc.recording_duration,
              },
              note,
              transcript,
            })
            if (data.skipped) {
              await updateEncounterRef.current(encounterId, { box_status: "skipped" })
            } else {
              await updateEncounterRef.current(encounterId, {
                box_status: "archived",
                box_folder_id: data.folderId,
                box_archived_at: new Date().toISOString(),
              })
              debugLog(`✅ Consultation archived to Box (folder ${data.folderId})`)
            }
          } catch (archiveError) {
            debugError("Box archive failed", archiveError)
            await updateEncounterRef.current(encounterId, { box_status: "failed" })
          }
        })()
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
        setProcessingMetrics((prev) => ({
          ...prev,
          noteGenerationEndedAt: Date.now(),
          processingEndedAt: Date.now(),
        }))
        await updateEncounterRef.current(encounterId, { status: "note_generation_failed" })
        await refreshRef.current()
      }
    },
    [], // No dependencies - uses refs instead
  )

  const handleFinalEvent = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { final_transcript?: string }
        const transcript = data.final_transcript || ""
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
        setProcessingMetrics((prev) => ({
          ...prev,
          transcriptionEndedAt: prev.transcriptionEndedAt ?? Date.now(),
        }))
        const encounterId = currentEncounterIdRef.current
        if (encounterId) {
          void (async () => {
            await updateEncounterRef.current(encounterId, { transcript_text: transcript })
            await refreshRef.current()
            await processEncounterForNoteGeneration(encounterId, transcript)
          })()
        }
        cleanupSession()
      } catch (error) {
        debugError("Failed to parse final transcript event", error)
      }
    },
    [cleanupSession, isBlankTranscriptText, processEncounterForNoteGeneration], // Minimal stable dependencies
  )

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
    setWorkflowError(
      createPipelineError("network_error", streamMessage, true, {
        readyState,
      }),
    )
    setTranscriptionStatus("failed")
    setProcessingMetrics((prev) => ({
      ...prev,
      transcriptionEndedAt: prev.transcriptionEndedAt ?? Date.now(),
      processingEndedAt: Date.now(),
    }))
  }, [])

  useEffect(() => {
    if (!sessionId) return

    debugLog('[EventSource] Connecting to session:', sessionId)
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
      debugLog('[EventSource] Cleanup: closing connection for session:', sessionId)
      source.removeEventListener("segment", segmentListener)
      source.removeEventListener("final", finalListener)
      source.removeEventListener("error", errorListener)
      source.close()
      if (eventSourceRef.current === source) {
        eventSourceRef.current = null
      }
    }
  }, [handleFinalEvent, handleSegmentEvent, handleStreamError, sessionId])

  // Cleanup EventSource on page unload/refresh
  useEffect(() => {
    const handleBeforeUnload = () => {
      debugLog('[BeforeUnload] Cleaning up EventSource')
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }

    const handleVisibilityChange = () => {
      // If page becomes hidden and we're not actively recording, cleanup
      if (document.hidden && view.type !== 'recording') {
        debugLog('[VisibilityChange] Page hidden, cleaning up EventSource')
        if (eventSourceRef.current) {
          eventSourceRef.current.close()
          eventSourceRef.current = null
        }
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [view.type])

  const startNewSession = useCallback((id: string) => {
    sessionIdRef.current = id
    setSessionId(id)
    resetQueue()
  }, [resetQueue])

  const handleStartNew = () => {
    setView({ type: "new-form" })
  }

  const handleCancelNew = () => {
    setView({ type: "idle" })
  }

  const handleStartRecording = async (data: {
    patient_name: string
    patient_id: string
    visit_reason: string
  }) => {
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
      setProcessingMetrics({})

      const session = crypto.randomUUID()
      startNewSession(session)

      const encounter = await addEncounter({
        ...data,
        status: "recording",
        transcript_text: "",
        session_id: session,
      })

      currentEncounterIdRef.current = encounter.id
      // Optimistically flip to recording immediately for responsive UI.
      setView({ type: "recording", encounterId: encounter.id })
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
      setView({ type: "idle" })
    }
  }

  const uploadFinalRecording = useCallback(
    async (
      activeSessionId: string,
      blob: Blob,
      encounterId: string,
      createdAt: string,
      attempt = 1,
    ): Promise<void> => {
    try {
      const formData = new FormData()
      formData.append("session_id", activeSessionId)
      formData.append("file", blob, `${activeSessionId}-full.wav`)
      // Sent so the server can file the Box phase-1 artifacts (audio + raw
      // transcript) under the same per-consult folder the note upload uses.
      if (encounterId) formData.append("encounter_id", encounterId)
      if (createdAt) formData.append("created_at", createdAt)
      const baseUrl = apiBaseUrlRef.current
      const url = baseUrl
        ? `${baseUrl.replace(/\/+$/, "")}/api/transcription/final`
        : "/api/transcription/final"
      const response = await fetch(url, {
        method: "POST",
        body: formData,
      })
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500
        if (retryable && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
          return uploadFinalRecording(activeSessionId, blob, encounterId, createdAt, attempt + 1)
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
    } catch (error) {
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
        return uploadFinalRecording(activeSessionId, blob, encounterId, createdAt, attempt + 1)
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
  }, [])

  const uploadAudioFile = useCallback(
    async (activeSessionId: string, file: File, encounterId: string, createdAt: string): Promise<void> => {
    const baseUrl = apiBaseUrlRef.current
    const url = baseUrl
      ? `${baseUrl.replace(/\/+$/, "")}/api/transcription/upload`
      : "/api/transcription/upload"
    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response
      try {
        const formData = new FormData()
        formData.append("session_id", activeSessionId)
        formData.append("file", file, file.name || `${activeSessionId}-upload`)
        if (encounterId) formData.append("encounter_id", encounterId)
        if (createdAt) formData.append("created_at", createdAt)
        response = await fetch(url, { method: "POST", body: formData })
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

      if (response.ok) return

      const retryable = response.status === 429 || response.status >= 500
      if (retryable && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
        continue
      }

      if (response.status === 413) {
        const message =
          "This recording is too long to upload on the hosted demo (request limit ~4.5 MB even after compression). Try a shorter file."
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
  }, [])

  const handleUploadRecording = async (
    data: { patient_name: string; patient_id: string; visit_reason: string },
    file: File,
  ) => {
    try {
      cleanupSession()
      finalTranscriptRef.current = ""
      finalRecordingRef.current = null
      setTranscriptionErrorMessage("")
      setWorkflowError(null)
      setTranscriptionStatus("in-progress")
      setNoteGenerationStatus("pending")
      setProcessingMetrics({ processingStartedAt: Date.now(), transcriptionStartedAt: Date.now() })

      const session = crypto.randomUUID()
      // Subscribes the SSE stream (via sessionId) before the upload POST begins,
      // so the server-pushed `final` event is received.
      startNewSession(session)

      const encounter = await addEncounter({
        ...data,
        status: "processing",
        transcript_text: "",
        session_id: session,
      })
      currentEncounterIdRef.current = encounter.id
      setView({ type: "processing", encounterId: encounter.id })

      // Compress in the browser (16 kHz mono MP3) so the upload stays under the
      // hosted serverless request-size limit. Fall back to the original on failure.
      let uploadFile: File = file
      try {
        const compressed = await compressAudioFileToMp3(file)
        uploadFile = new File([compressed.blob], compressed.filename, { type: "audio/mpeg" })
        debugLog(
          `[upload] compressed ${file.name}: ${(file.size / 1e6).toFixed(1)}MB -> ` +
            `${(uploadFile.size / 1e6).toFixed(2)}MB @ ${compressed.bitrateKbps}kbps`,
        )
      } catch (compressionError) {
        debugWarn("Audio compression failed; uploading original file", compressionError)
      }

      await uploadAudioFile(session, uploadFile, encounter.id, encounter.created_at)
    } catch (err) {
      debugError("Failed to upload recording:", err)
      setTranscriptionErrorMessage((previous) => previous || "Failed to transcribe the uploaded file.")
      setTranscriptionStatus("failed")
    }
  }

  const handleStopRecording = async () => {
    const encounter = currentEncounter
    if (!encounter) return

    await updateEncounter(encounter.id, {
      status: "processing",
      recording_duration: duration,
    })

    setView({ type: "processing", encounterId: encounter.id })
    setProcessingMetrics({
      processingStartedAt: Date.now(),
      transcriptionStartedAt: Date.now(),
    })

    const audioBlob = await stopRecording()
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

  const handlePauseRecording = async () => {
    await pauseRecording()
  }

  const handleResumeRecording = async () => {
    await resumeRecording()
  }

  const handleRetryTranscription = async () => {
    const blob = finalRecordingRef.current
    const activeSessionId = sessionIdRef.current
    if (!blob || !activeSessionId) return
    setTranscriptionErrorMessage("")
    setTranscriptionStatus("in-progress")
    setWorkflowError(null)
    try {
      await uploadFinalRecording(activeSessionId, blob, currentEncounter?.id ?? "", currentEncounter?.created_at ?? "")
    } catch {
      // handled in uploadFinalRecording
    }
  }

  const handleRetryNoteGeneration = async () => {
    const transcript = finalTranscriptRef.current
    const encounterId = currentEncounter?.id
    if (!encounterId || !transcript) return
    setWorkflowError(null)
    setProcessingMetrics((prev) => ({
      ...prev,
      noteGenerationStartedAt: Date.now(),
      noteGenerationEndedAt: undefined,
      processingEndedAt: undefined,
    }))
    await processEncounterForNoteGeneration(encounterId, transcript)
  }

  const currentEncounter = encounters.find((e: Encounter) => "encounterId" in view && e.id === view.encounterId)
  const selectedEncounter = view.type === "viewing" ? encounters.find((e: Encounter) => e.id === view.encounterId) : null

  const handleSelectEncounter = (encounter: Encounter) => {
    if (view.type === "recording") return
    setView({ type: "viewing", encounterId: encounter.id })
  }

  const handleSaveNote = async (noteText: string) => {
    if (!selectedEncounter) return
    await updateEncounter(selectedEncounter.id, { note_text: noteText })
  }

  const handleDeleteEncounter = async (encounterId: string) => {
    await removeEncounter(encounterId)
    if (currentEncounterIdRef.current === encounterId) {
      currentEncounterIdRef.current = null
    }
    setView((prev) => {
      if (
        (prev.type === "recording" || prev.type === "processing" || prev.type === "viewing") &&
        prev.encounterId === encounterId
      ) {
        return { type: "idle" }
      }
      return prev
    })
  }

  const renderMainContent = () => {
    switch (view.type) {
      case "idle":
        return <IdleView onStartNew={handleStartNew} />
      case "new-form":
        return (
          <div className="flex h-full items-center justify-center p-8">
            <NewEncounterForm
              onStart={handleStartRecording}
              onCancel={handleCancelNew}
              onUpload={handleUploadRecording}
            />
          </div>
        )
      case "recording":
        return (
          <div className="flex h-full items-center justify-center p-8">
            <RecordingView
              patientName={currentEncounter?.patient_name || ""}
              patientId={currentEncounter?.patient_id || ""}
              duration={duration}
              isPaused={isPaused}
              onStop={handleStopRecording}
              onPause={handlePauseRecording}
              onResume={handleResumeRecording}
            />
          </div>
        )
      case "processing": {
        const retryAction = noteGenerationStatus === "failed" ? handleRetryNoteGeneration : handleRetryTranscription
        return (
          <div className="flex h-full items-center justify-center p-8">
            <div className="flex w-full flex-col items-center">
              {workflowError && <WorkflowErrorDisplay error={workflowError} onRetry={workflowError.recoverable ? retryAction : undefined} />}
              <ProcessingView
                patientName={currentEncounter?.patient_name || ""}
                transcriptionStatus={transcriptionStatus}
                noteGenerationStatus={noteGenerationStatus}
                transcriptionErrorMessage={transcriptionErrorMessage}
                onRetryTranscription={handleRetryTranscription}
                onRetryNoteGeneration={handleRetryNoteGeneration}
              />
            </div>
          </div>
        )
      }
      case "viewing":
        return selectedEncounter ? (
          <NoteEditor encounter={selectedEncounter} onSave={handleSaveNote} />
        ) : (
          <IdleView onStartNew={handleStartNew} />
        )
      default:
        return <IdleView onStartNew={handleStartNew} />
    }
  }

  return (
    <>
      {showPermissionsDialog && (
        <PermissionsDialog onComplete={handlePermissionsComplete} preferredInputDeviceId={preferredInputDeviceId} />
      )}
      <SettingsDialog
        isOpen={showSettingsDialog}
        onClose={handleCloseSettings}
        audioInputDevices={audioInputDevices}
        preferredInputDeviceId={preferredInputDeviceId}
        onPreferredInputDeviceChange={handlePreferredInputDeviceChange}
        micPermissionStatus={micPermissionStatus}
        lastMicReadinessMessage={lastMicReadiness?.userMessage || (lastMicReadiness?.success ? "Ready" : "")}
        lastMicReadinessMetrics={lastMicReadiness?.metrics || null}
        lastFailureCode={lastFailureCode}
        onRunMicrophoneCheck={async () => {
          await runMicReadinessCheck(true)
        }}
      />
      {httpsWarning && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-destructive px-4 py-2 text-center text-sm font-semibold text-destructive-foreground">
          {httpsWarning}
        </div>
      )}
      <div className="flex h-screen w-screen overflow-hidden bg-background">
        <div className="relative z-10 flex h-full w-72 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar shadow-soft">
          <EncounterList
            encounters={encounters}
            selectedId={view.type === "viewing" ? view.encounterId : null}
            onSelect={handleSelectEncounter}
            onNewEncounter={handleStartNew}
            onDeleteEncounter={handleDeleteEncounter}
            disabled={view.type === "recording"}
          />
          <ModelIndicator />
          <SettingsBar onOpenSettings={handleOpenSettings} />
        </div>
        <main className="flex flex-1 flex-col overflow-hidden bg-background">
          {renderMainContent()}
        </main>
      </div>
    </>
  )
}

export default function HomePage() {
  return (
    <ErrorBoundary>
      <HomePageContent />
    </ErrorBoundary>
  )
}
