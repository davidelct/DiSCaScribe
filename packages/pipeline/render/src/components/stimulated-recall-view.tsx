"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Encounter } from "@storage/types"
import { getEncounterAudio, saveEncounterAudio } from "@storage/audio-store"
import { useAudioRecorder, compressAudioFileToMp3 } from "@audio"
import { Button } from "@ui/lib/ui/button"
import { cn } from "@ui/lib/utils"
import { RECALL_TEMPLATE, guessClinicianSpeaker } from "@pipeline-errors"
import { Check, ChevronRight, Download, Loader2, Lock, Mic, Pause, Play, RotateCcw, Square } from "lucide-react"
import { AudioPlayer } from "./audio-player"
import { RecallTranscript } from "./recall-transcript"
import { FinalDiagnosisCard, RecallEntryCard } from "./recall-entry"
import {
  buildRecallPayload,
  emptyRecallSession,
  loadRecallSession,
  orderedEntries,
  recallAudioKey,
  rememberRecallScale,
  saveRecallSession,
  sessionAnchors,
  sessionAnchorsAfterEdit,
  sessionHasRatings,
  toUtterances,
  type RatingScale,
  type RecallEntry,
  type RecallSession,
} from "./recall-session"

/**
 * Stimulated Recall (WT3.1), on SR_TemplateV6 as Olga revised it.
 *
 * A slim toolbar (the scales folded behind a toggle, the scale switch,
 * recording and export), then two columns. Left, the consultation
 * transcript in larger type than the consultation view, with one line of
 * instruction: please highlight important information. The clinician
 * leads: ticking a turn highlights it (yellow, for the rest of the
 * interview) and opens its questions on the right; further ticks join the
 * open highlight, so one can span several turns. Right, the template's
 * three questions once per highlight, in transcript order: the hypotheses
 * the information was important to, and for each how much it supported
 * it and how likely it became, plus notes. The ratings are given on the
 * numeric scales or on the session's verbal anchors, chosen per session
 * until the first rating fixes it. The recall interview can be recorded
 * alongside, with every turn click timed against the recording. The
 * speaker labels come from the recall analysis made beside note generation
 * (which speaker is the clinician), or a guess until then.
 */

type RecallRecordingStatus = "idle" | "recording" | "saving" | "archived" | "skipped" | "failed"

/** How long after the last edit the archive's copy of the session is refreshed. */
const ARCHIVE_DELAY_MS = 30_000

const CARD = "rounded-2xl border border-border bg-card shadow-soft"
/** The row above each column: its name on the left, its controls on the right; the same height on both sides. */
const COLUMN_HEADING = "flex min-h-7 shrink-0 items-center gap-3 px-1"

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  return `${String(minutes).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`
}

const SCALE_NAMES: Record<RatingScale, string> = { numeric: "Numerical scales", verbal: "Verbal scales" }

/** One of the numeric rating scales, drawn as the paper form draws it. */
function Scale({ title, labels, minorEvery, ends }: { title: string; labels: string[]; minorEvery: number; ends: string[] }) {
  const count = labels.length
  const step = 100 / (count - 1)
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-foreground">{title}</span>
      <div className="relative h-6">
        <span aria-hidden className="absolute inset-x-0 top-[5px] h-px bg-foreground/40" />
        {labels.map((label, index) => {
          const x = index * step
          return (
            <Fragment key={index}>
              <span aria-hidden className="absolute top-px h-[9px] w-px bg-foreground/40" style={{ left: `${x}%` }} />
              <span className="absolute top-3 -translate-x-1/2 font-mono text-[10.5px] text-muted-foreground" style={{ left: `${x}%` }}>
                {label}
              </span>
              {index < count - 1 &&
                Array.from({ length: minorEvery - 1 }, (_, k) => (
                  <span
                    key={k}
                    aria-hidden
                    className="absolute top-[3px] h-[5px] w-px bg-foreground/25"
                    style={{ left: `${x + (step * (k + 1)) / minorEvery}%` }}
                  />
                ))}
            </Fragment>
          )
        })}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        {ends.map((end) => (
          <span key={end}>{end}</span>
        ))}
      </div>
    </div>
  )
}

/**
 * One of the verbal scales: its anchors in order along a line, as the
 * template draws them. One row per scale, the title beside the line rather
 * than above it, so the three together take no more of the page than the
 * two numeric drawings do.
 */
function VerbalScale({ title, anchors }: { title: string; anchors: readonly string[] }) {
  const inset = `${50 / anchors.length}%`
  return (
    <div className="flex items-start gap-3">
      <span className="w-[168px] shrink-0 text-xs font-semibold leading-4 text-foreground">{title}</span>
      <div className="relative flex min-w-0 flex-1">
        <span aria-hidden className="absolute top-[5px] h-px bg-foreground/40" style={{ left: inset, right: inset }} />
        {anchors.map((anchor) => (
          <div key={anchor} className="flex flex-1 flex-col items-center">
            <span aria-hidden className="mt-px h-[9px] w-px bg-foreground/40" />
            <span className="mt-1 px-1 text-center text-[10.5px] leading-[13px] text-muted-foreground">{anchor}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The choice of scales, numeric or verbal, for the session. Once a rating
 * has been given the choice is fixed: a session is wholly on one set, so
 * the two can be compared; the ratings would have to be removed to change.
 */
function ScaleChoice({ value, locked, onChange }: { value: RatingScale; locked: boolean; onChange: (scale: RatingScale) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Rating scales"
      title={
        locked
          ? "Ratings have been given on these scales; remove them to change the scales"
          : "The scales this recall's ratings are given on"
      }
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5"
    >
      {(Object.keys(SCALE_NAMES) as RatingScale[]).map((scale) => {
        const checked = scale === value
        return (
          <button
            key={scale}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={locked && !checked}
            onClick={() => onChange(scale)}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              checked ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted-foreground",
            )}
          >
            {SCALE_NAMES[scale]}
          </button>
        )
      })}
      {locked && <Lock aria-hidden className="mx-1 h-3 w-3 text-muted-foreground" />}
    </div>
  )
}

export interface StimulatedRecallViewProps {
  encounter: Encounter
  /**
   * Detects the transcript's question–answer exchanges and saves them to the
   * encounter, when it has none (or a stale set). Called once per open; the
   * view brackets the exchanges as soon as the encounter updates. Without it,
   * or if it fails, a question-mark heuristic stands in.
   */
  detectExchanges?: (transcript: string) => Promise<void>
}

export function StimulatedRecallView({ encounter, detectExchanges }: StimulatedRecallViewProps) {
  const turns = useMemo(() => toUtterances(encounter.transcript_text), [encounter.transcript_text])
  const analysis = encounter.recall_analysis
  const analysisFresh = Boolean(analysis && turns.length > 0 && analysis.turn_count === turns.length)
  const clinicianSpeaker = useMemo(
    () => (analysisFresh ? analysis?.clinician_speaker : guessClinicianSpeaker(turns)),
    [analysis, analysisFresh, turns],
  )
  const speakerCount = useMemo(() => new Set(turns.map((turn) => turn.speaker)).size, [turns])
  const speakerLabel = useCallback(
    (speaker: number) =>
      clinicianSpeaker !== undefined && speakerCount === 2
        ? speaker === clinicianSpeaker
          ? "GP"
          : "Patient"
        : `Speaker ${speaker + 1}`,
    [clinicianSpeaker, speakerCount],
  )
  const accentSpeaker = clinicianSpeaker ?? turns[0]?.speaker ?? 0

  // ── Session: loaded per encounter, saved a beat after each change ──────────
  const [session, setSession] = useState<RecallSession>(emptyRecallSession)
  const [loaded, setLoaded] = useState(false)
  const sessionRef = useRef(session)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The archive's copy (recall_session.json in Box, what recovery rebuilds
  // from) follows the edits too, a while after the last one rather than
  // only when a recording stops. Set up below, once the payload exists.
  const archiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const archiveSessionRef = useRef<(options: { keepalive: boolean }) => void>(() => undefined)
  const scheduleArchive = useCallback(() => {
    if (archiveTimer.current) clearTimeout(archiveTimer.current)
    archiveTimer.current = setTimeout(() => {
      archiveTimer.current = null
      archiveSessionRef.current({ keepalive: false })
    }, ARCHIVE_DELAY_MS)
  }, [])
  const update = useCallback(
    (updater: (current: RecallSession) => RecallSession) => {
      const next = sessionAnchorsAfterEdit(updater(sessionRef.current))
      sessionRef.current = next
      setSession(next)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null
        void saveRecallSession(encounter.id, next)
      }, 300)
      scheduleArchive()
    },
    [encounter.id, scheduleArchive],
  )
  // Pending saves are flushed when the view leaves or switches encounter,
  // and the archive's copy when the page is closed.
  useEffect(() => {
    const id = encounter.id
    const flushArchive = () => {
      if (!archiveTimer.current) return
      clearTimeout(archiveTimer.current)
      archiveTimer.current = null
      archiveSessionRef.current({ keepalive: true })
    }
    window.addEventListener("pagehide", flushArchive)
    return () => {
      window.removeEventListener("pagehide", flushArchive)
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
        void saveRecallSession(id, sessionRef.current)
      }
      flushArchive()
    }
  }, [encounter.id])

  const [activeId, setActiveId] = useState<string | null>(null)
  // The scale drawings are folded away; the anchors are on every question.
  const [promptOpen, setPromptOpen] = useState(false)
  const [recallStatus, setRecallStatus] = useState<RecallRecordingStatus>("idle")
  const [hasRecallAudio, setHasRecallAudio] = useState(false)
  const [recallAudioVersion, setRecallAudioVersion] = useState(0)
  const turnRefs = useRef<Array<HTMLElement | null>>([])
  const entryRefs = useRef(new Map<string, HTMLElement>())
  const recallBlobRef = useRef<Blob | null>(null)

  // Recall-recording clock: recorded time only — accumulated ms up to the
  // last pause, plus the running stretch since the last start/resume.
  const recordedMsRef = useRef(0)
  const runningSinceRef = useRef<number | null>(null)
  const recordedOffsetSeconds = () => {
    const running = runningSinceRef.current === null ? 0 : performance.now() - runningSinceRef.current
    return Math.round(recordedMsRef.current + running) / 1000
  }

  const recorder = useAudioRecorder({ emitSegments: false })
  const recallKey = recallAudioKey(encounter.id)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setActiveId(null)
    setRecallStatus("idle")
    setHasRecallAudio(false)
    recallBlobRef.current = null
    recordedMsRef.current = 0
    runningSinceRef.current = null
    void getEncounterAudio(recallAudioKey(encounter.id)).then((blob) => {
      if (!cancelled) setHasRecallAudio(Boolean(blob))
    })
    void loadRecallSession(encounter.id).then((saved) => {
      if (cancelled) return
      sessionRef.current = saved
      setSession(saved)
      if (saved.recallArchivedAt) setRecallStatus("archived")
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [encounter.id])

  // Analysis missing or stale (which speaker is the clinician): run it
  // once per open, quietly; the labels follow when the encounter updates.
  const detectRef = useRef(detectExchanges)
  useEffect(() => {
    detectRef.current = detectExchanges
  }, [detectExchanges])
  const attemptedRef = useRef<string | null>(null)
  useEffect(() => {
    const detect = detectRef.current
    if (analysisFresh || turns.length < 2 || !detect || attemptedRef.current === encounter.id) return
    attemptedRef.current = encounter.id
    void detect(encounter.transcript_text).catch(() => undefined)
  }, [analysisFresh, encounter.id, encounter.transcript_text, turns.length])

  // ── Derived views ──────────────────────────────────────────────────────────
  const ordered = useMemo(() => orderedEntries(session), [session])
  const entryViews = useMemo(
    () =>
      ordered.map((entry, position) => ({
        entry,
        number: position + 1,
        excerpt: entry.turns.map((index) => ({
          label: speakerLabel(turns[index]?.speaker ?? 0),
          text: turns[index]?.text ?? "",
        })),
      })),
    [ordered, speakerLabel, turns],
  )
  // Every hypothesis named so far, once each, for the hypothesis box to offer.
  const hypothesisNames = useMemo(
    () => [...new Set(session.entries.flatMap((entry) => entry.rows.map((row) => row.hypothesis.trim())).filter(Boolean))],
    [session.entries],
  )
  const entryByTurn = useMemo(() => {
    const map = new Map<number, RecallEntry>()
    for (const entry of session.entries) for (const index of entry.turns) map.set(index, entry)
    return map
  }, [session.entries])
  const openEntry = activeId ? session.entries.find((entry) => entry.id === activeId) ?? null : null
  const checkedTurns = openEntry ? openEntry.turns : []
  const transcriptEntries = useMemo(
    () => entryViews.map((view) => ({ id: view.entry.id, number: view.number, turns: view.entry.turns })),
    [entryViews],
  )

  // ── Highlights ─────────────────────────────────────────────────────────────
  const activateEntry = (id: string, scrollTranscript: boolean) => {
    setActiveId(id)
    requestAnimationFrame(() => entryRefs.current.get(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" }))
    if (scrollTranscript) {
      const first = sessionRef.current.entries.find((entry) => entry.id === id)?.turns[0]
      if (first !== undefined) turnRefs.current[first]?.scrollIntoView({ block: "center", behavior: "smooth" })
    }
  }

  // While the recall interview is being recorded, every turn click is logged
  // against the recording's timeline so the audio can later be segmented.
  const logTurnClick = (index: number) => {
    if (recallStatus !== "recording") return
    const click = { utterance: index, audioOffsetSeconds: recordedOffsetSeconds(), at: new Date().toISOString() }
    update((current) =>
      current.timeline
        ? { ...current, timeline: { ...current.timeline, utteranceClicks: [...current.timeline.utteranceClicks, click] } }
        : current,
    )
  }

  // Ticking a turn with nothing open highlights it: a new entry, opened at
  // once so its questions appear. With an entry open, ticks edit that
  // entry's turns, so a highlight can span several. Unticking its last turn
  // removes it while it is still blank (an accidental highlight); once it
  // holds answers the click only closes it, and the card's X, which asks
  // first, is the way to remove it. A turn already in another entry stays
  // with it.
  const toggleTurn = (index: number, checked: boolean) => {
    logTurnClick(index)
    if (openEntry) {
      const owner = entryByTurn.get(index)
      if (checked && owner && owner.id !== openEntry.id) return
      const turns = checked
        ? [...new Set([...openEntry.turns, index])].sort((a, b) => a - b)
        : openEntry.turns.filter((i) => i !== index)
      if (turns.length > 0) patchEntry(openEntry.id, { turns })
      else if (openEntry.rows.length === 0 && !openEntry.notes.trim()) removeEntry(openEntry.id)
      else setActiveId(null)
      return
    }
    if (!checked || entryByTurn.has(index)) return
    const entry: RecallEntry = { id: crypto.randomUUID(), turns: [index], rows: [], notes: "", createdAt: new Date().toISOString() }
    update((current) => ({ ...current, entries: [...current.entries, entry] }))
    activateEntry(entry.id, false)
  }

  // A turn of another entry opens that entry.
  const openEntryFromTurn = (id: string) => {
    const first = sessionRef.current.entries.find((entry) => entry.id === id)?.turns[0]
    if (first !== undefined) logTurnClick(first)
    activateEntry(id, false)
  }

  // The scales are chosen before the first rating and remembered for the
  // next session; the choice is saved with the session like any edit.
  const scaleLocked = sessionHasRatings(session)
  const chooseScale = (scale: RatingScale) => {
    if (scale === session.scale || scaleLocked) return
    rememberRecallScale(scale)
    update((current) => ({ ...current, scale }))
  }

  // Escape leaves a box, then closes the open highlight.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        target.blur()
        return
      }
      setActiveId(null)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  const removeEntry = (id: string) => {
    update((current) => ({ ...current, entries: current.entries.filter((entry) => entry.id !== id) }))
    setActiveId((current) => (current === id ? null : current))
  }

  const patchEntry = (id: string, patch: Partial<RecallEntry>) =>
    update((current) => ({
      ...current,
      entries: current.entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    }))


  // ── Recording, archival, export ───────────────────────────────────────────
  const sessionPayload = useCallback(
    () =>
      buildRecallPayload({
        encounterId: encounter.id,
        session: sessionRef.current,
        turns,
        clinicianSpeaker,
        speakerLabel,
      }),
    [clinicianSpeaker, encounter.id, speakerLabel, turns],
  )

  // Refreshes the archive's copy of the session alone; the recording goes
  // up when it stops (uploadRecall). Quiet: a failed refresh is retried
  // with the next edit, and the stop's archive carries the latest session.
  const recordingRef = useRef(false)
  const archiveConfiguredRef = useRef(true)
  useEffect(() => {
    archiveSessionRef.current = ({ keepalive }) => {
      // While recording, the stop archives the session with the recording.
      if (recordingRef.current || !archiveConfiguredRef.current) return
      const current = sessionRef.current
      if (current.entries.length === 0 && current.finalDiagnosis.length === 0) return
      const formData = new FormData()
      formData.append("encounter_id", encounter.id)
      formData.append("created_at", encounter.created_at)
      formData.append("session", JSON.stringify(sessionPayload()))
      // keepalive lets the request outlive a closing page, but browsers cap
      // its body at 64 KB; a larger session is sent without it.
      void fetch("/api/archive/recall", { method: "POST", body: formData, keepalive })
        .catch(() => (keepalive ? fetch("/api/archive/recall", { method: "POST", body: formData }) : null))
        .then(async (res) => {
          if (!res?.ok) return
          const data = (await res.json().catch(() => null)) as { skipped?: boolean } | null
          if (data?.skipped) archiveConfiguredRef.current = false
        })
        .catch(() => undefined)
    }
  }, [encounter.created_at, encounter.id, sessionPayload])

  const startRecall = async () => {
    recordingRef.current = true
    try {
      await recorder.startRecording()
      // Fresh timeline per take: a re-record replaces the audio, so it
      // replaces the click timings too.
      update((current) => ({ ...current, timeline: { startedAt: new Date().toISOString(), utteranceClicks: [] } }))
      recordedMsRef.current = 0
      runningSinceRef.current = performance.now()
      setRecallStatus("recording")
    } catch {
      recordingRef.current = false
      setRecallStatus("failed")
    }
  }

  const pauseRecall = () => {
    if (runningSinceRef.current !== null) {
      recordedMsRef.current += performance.now() - runningSinceRef.current
      runningSinceRef.current = null
    }
    void recorder.pauseRecording()
  }

  const resumeRecall = () => {
    if (runningSinceRef.current === null) runningSinceRef.current = performance.now()
    void recorder.resumeRecording()
  }

  const uploadRecall = useCallback(
    async (audioBlob: Blob | null) => {
      // This upload carries the session; a refresh already queued is redundant.
      if (archiveTimer.current) {
        clearTimeout(archiveTimer.current)
        archiveTimer.current = null
      }
      setRecallStatus("saving")
      try {
        const formData = new FormData()
        formData.append("encounter_id", encounter.id)
        formData.append("created_at", encounter.created_at)
        formData.append("session", JSON.stringify(sessionPayload()))
        if (audioBlob) {
          let file = new File([audioBlob], "recall_audio.wav", { type: audioBlob.type || "audio/wav" })
          try {
            const compressed = await compressAudioFileToMp3(file)
            file = new File([compressed.blob], "recall_audio.mp3", { type: "audio/mpeg" })
          } catch {
            // fall back to the raw WAV
          }
          formData.append("file", file, file.name)
        }
        const res = await fetch("/api/archive/recall", { method: "POST", body: formData })
        if (!res.ok) throw new Error(`Recall archive failed (${res.status})`)
        const data = (await res.json()) as { ok?: boolean; skipped?: boolean }
        if (data.skipped) {
          setRecallStatus("skipped")
          return
        }
        update((current) => ({ ...current, recallArchivedAt: new Date().toISOString() }))
        // That mark is not an edit: the archive already has this session.
        if (archiveTimer.current) {
          clearTimeout(archiveTimer.current)
          archiveTimer.current = null
        }
        recallBlobRef.current = null
        setRecallStatus("archived")
      } catch {
        setRecallStatus("failed")
      }
    },
    [encounter.created_at, encounter.id, sessionPayload, update],
  )

  const stopRecall = async () => {
    const durationSeconds = recordedOffsetSeconds()
    runningSinceRef.current = null
    update((current) =>
      current.timeline
        ? { ...current, timeline: { ...current.timeline, stoppedAt: new Date().toISOString(), durationSeconds } }
        : current,
    )
    const blob = await recorder.stopRecording()
    recallBlobRef.current = blob
    if (blob) {
      // Store locally right away so the player appears; the archived copy
      // uploads in the background.
      void saveEncounterAudio(recallKey, new File([blob], "recall_audio.wav", { type: blob.type || "audio/wav" })).catch(
        () => undefined,
      )
      setHasRecallAudio(true)
      setRecallAudioVersion((version) => version + 1)
    }
    await uploadRecall(blob)
    recordingRef.current = false
  }

  const exportSession = () => {
    const blob = new Blob([JSON.stringify(sessionPayload(), null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `stimulated_recall_${encounter.id}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (turns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No transcript available for this consultation — stimulated recall needs one.
        </p>
      </div>
    )
  }

  const nothingToExport = session.entries.length === 0

  return (
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      {/* One slim row: the template's instruction and scales folded behind a
          toggle, the scale switch, and the recording and export actions, so
          the transcript and the recall get the page. */}
      <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-3 px-1">
        <button
          type="button"
          onClick={() => setPromptOpen((open) => !open)}
          aria-expanded={promptOpen}
          className="inline-flex items-center gap-1 rounded text-sm font-semibold text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ChevronRight aria-hidden className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", promptOpen && "rotate-90")} />
          Scales
        </button>
        {loaded && <ScaleChoice value={session.scale} locked={scaleLocked} onChange={chooseScale} />}
          <div className="ml-auto flex items-center gap-2">
            {recallStatus === "recording" ? (
              <span className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-card pl-2.5 pr-1">
                <span className={cn("h-[7px] w-[7px] rounded-full bg-primary", !recorder.isPaused && "animate-pulse")} />
                <span className="font-mono text-xs text-foreground">{formatDuration(recorder.duration)}</span>
                <button
                  type="button"
                  onClick={recorder.isPaused ? resumeRecall : pauseRecall}
                  title={recorder.isPaused ? "Resume recording" : "Pause recording"}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  {recorder.isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  <span className="sr-only">{recorder.isPaused ? "Resume" : "Pause"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void stopRecall()}
                  title="Stop and archive the recording"
                  className="rounded p-1 text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <Square className="h-3.5 w-3.5" />
                  <span className="sr-only">Stop and archive</span>
                </button>
              </span>
            ) : (
              <>
                {recallStatus === "saving" && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Archiving
                  </span>
                )}
                {recallStatus === "archived" && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
                    <Check className="h-3.5 w-3.5" /> Archived
                  </span>
                )}
                {recallStatus === "skipped" && <span className="text-xs text-muted-foreground">Archiving not configured</span>}
                {recallStatus === "failed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void uploadRecall(recallBlobRef.current)}
                    className="h-8 rounded-md border-destructive/40 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    <span className="text-xs">Archive failed, retry</span>
                  </Button>
                )}
                {recallStatus !== "saving" && (
                  <Button size="sm" onClick={() => void startRecall()} className="h-8 rounded-md px-3">
                    <Mic className="mr-1.5 h-3.5 w-3.5" />
                    <span className="text-xs">{hasRecallAudio ? "Re-record" : "Record recall"}</span>
                  </Button>
                )}
              </>
            )}
            <Button variant="outline" size="sm" onClick={exportSession} disabled={nothingToExport} className="h-8 rounded-md px-3">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              <span className="text-xs">Export</span>
            </Button>
          </div>
      </div>
      {promptOpen && (
        <section className={cn(CARD, "shrink-0 px-5 py-4", session.scale === "verbal" ? "max-w-[680px]" : "max-w-[600px]")}>
            {session.scale === "verbal" ? (
              <div className="grid gap-2.5">
                <VerbalScale title="Information support" anchors={sessionAnchors(session).support} />
                <VerbalScale title="Likelihood" anchors={sessionAnchors(session).likelihood} />
                <VerbalScale title="How difficult was the case?" anchors={sessionAnchors(session).difficulty} />
                {session.anchors !== "2026-10" && (
                  <p className="text-[11px] text-muted-foreground">
                    This recall was rated on the September 2026 anchors, so it stays on them.
                  </p>
                )}
              </div>
            ) : (
              <div className="grid gap-8 sm:grid-cols-2">
                <Scale
                  title="Information support"
                  labels={["−10", "−5", "0", "+5", "+10"]}
                  minorEvery={5}
                  ends={["Rules out", "No effect", "Confirms"]}
                />
                <Scale
                  title="Likelihood"
                  labels={["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]}
                  minorEvery={1}
                  ends={["Highly unlikely", "Highly likely"]}
                />
              </div>
            )}
        </section>
      )}

      {hasRecallAudio && recallStatus !== "recording" && (
        <AudioPlayer key={`${recallKey}:${recallAudioVersion}`} audioKey={recallKey} className={cn(CARD, "shrink-0 px-5 py-3")} />
      )}

      {!loaded ? (
        <div className="flex flex-1 items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,11fr)_minmax(0,10fr)]">
          {/* Transcript: a heading row with the selection's controls, then
              the turns in a card that scrolls on its own. */}
          <section className="flex flex-col gap-3 lg:min-h-0">
            <div className={COLUMN_HEADING}>
              <h2 className="text-sm font-semibold text-foreground">Transcript</h2>
              <span className="text-xs text-muted-foreground">{RECALL_TEMPLATE.instruction}</span>
              {openEntry && (
                <div className="ml-auto flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    Highlight {entryViews.find((view) => view.entry.id === openEntry.id)?.number} · {openEntry.turns.length}{" "}
                    {openEntry.turns.length === 1 ? "turn" : "turns"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveId(null)}
                    className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
            <div className={cn(CARD, "px-5 py-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto")}>
              <RecallTranscript
                turns={turns}
                speakerLabel={speakerLabel}
                accentSpeaker={accentSpeaker}
                entries={transcriptEntries}
                openEntryId={activeId}
                checked={checkedTurns}
                onToggleTurn={toggleTurn}
                onOpenEntry={openEntryFromTurn}
                registerTurn={(index, element) => {
                  turnRefs.current[index] = element
                }}
              />
            </div>
          </section>

          {/* Recall: the same heading row, then one card per stop in
              transcript order and the final diagnosis, scrolling together. */}
          <section className="flex flex-col gap-3 lg:min-h-0">
            <div className={COLUMN_HEADING}>
              <h2 className="text-sm font-semibold text-foreground">Recall</h2>
            </div>
            <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
            {entryViews.length === 0 && (
              <p className="px-1 text-xs text-muted-foreground">
                Highlight an answer from the patient, or an examination or investigation result, that was important
                for your thinking: its questions appear here.
              </p>
            )}
            {entryViews.map((view) => (
              <RecallEntryCard
                key={view.entry.id}
                number={view.number}
                entry={view.entry}
                scale={session.scale}
                anchors={session.anchors}
                hypothesisSuggestions={hypothesisNames}
                excerpt={view.excerpt}
                open={view.entry.id === activeId}
                onOpen={() => activateEntry(view.entry.id, true)}
                onChangeRows={(rows) => patchEntry(view.entry.id, { rows })}
                onChangeNotes={(notes) => patchEntry(view.entry.id, { notes })}
                onRemove={() => removeEntry(view.entry.id)}
                cardRef={(element) => {
                  if (element) entryRefs.current.set(view.entry.id, element)
                  else entryRefs.current.delete(view.entry.id)
                }}
              />
            ))}
            <FinalDiagnosisCard
              rows={session.finalDiagnosis}
              scale={session.scale}
              anchors={session.anchors}
              onChange={(rows) => update((current) => ({ ...current, finalDiagnosis: rows }))}
            />
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
