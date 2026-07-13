"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Encounter } from "@storage/types"
import { loadSecureItem, saveSecureItem } from "@storage/secure-storage"
import { getEncounterAudio, saveEncounterAudio } from "@storage/audio-store"
import { useAudioRecorder, compressAudioFileToMp3 } from "@audio"
import { Button } from "@ui/lib/ui/button"
import { cn } from "@ui/lib/utils"
import { Check, Download, Loader2, Mic, Plus, RotateCcw } from "lucide-react"
import { parseDiarizedTranscript, type TranscriptTurn } from "./transcript-view"
import { AudioPlayer } from "./audio-player"
import { RecordingBar } from "./recording-bar"

/**
 * Stimulated Recall (WT3.1) — in-app v1, ported from the design mock.
 *
 * The clinician steps back through the consultation transcript and, per
 * utterance, rates how much that cue supported or spoke against each
 * diagnostic hypothesis they were holding at the time (the PID measure).
 * Hypotheses and ratings are persisted per encounter in the same encrypted
 * store as the encounters themselves.
 */

interface Hypothesis {
  id: string
  name: string
  /** Current subjective likelihood, 0–100. */
  pct: number
  /** Likelihood after each saved rating, for the mini history bars. */
  history: number[]
}

interface CueRating {
  /** Index into the utterance list. */
  utterance: number
  /** −3 (strongly against) … +3 (strongly supports). */
  value: number
  hypothesisId: string
  /** Likelihood of the rated hypothesis after this cue, 0–100. */
  updatedPct: number
}

/** One utterance click made while the recall interview was being recorded. */
interface UtteranceClick {
  /** Index into the utterance list. */
  utterance: number
  /** Position in the recall recording at click time, seconds (pauses excluded). */
  audioOffsetSeconds: number
  /** Wall-clock time of the click. */
  at: string
}

/**
 * Timing of the recall recording, for segmenting the audio per utterance:
 * the stretch between two consecutive clicks is the clinician talking about
 * the first click's utterance.
 */
interface RecallTimeline {
  /** Wall-clock time the recording started. */
  startedAt: string
  /** Wall-clock time the recording stopped. */
  stoppedAt?: string
  /** Recorded length in seconds (pauses excluded). */
  durationSeconds?: number
  /** Every utterance click while recording, in order. */
  utteranceClicks: UtteranceClick[]
}

interface RecallSession {
  hypotheses: Hypothesis[]
  /** Keyed by utterance index. */
  ratings: Record<number, CueRating>
  /** Timing of the recall recording (replaced on re-record). */
  timeline?: RecallTimeline
  /** Set once the recall recording + session data have been archived. */
  recallArchivedAt?: string
}

type RecallRecordingStatus = "idle" | "recording" | "saving" | "archived" | "skipped" | "failed"

const SCALE_VALUES = [-3, -2, -1, 0, 1, 2, 3] as const

/** Diverging support scale: amber (against) → neutral → teal (supports). */
const SCALE_CLASS: Record<number, string> = {
  [-3]: "bg-amber-800",
  [-2]: "bg-amber-600",
  [-1]: "bg-amber-400",
  [0]: "bg-slate-400",
  [1]: "bg-teal-400",
  [2]: "bg-teal-600",
  [3]: "bg-teal-700",
}

function storageKey(encounterId: string): string {
  return `openscribe_recall_${encounterId}`
}

/** Audio-store key for the recall-interview recording of an encounter. */
export function recallAudioKey(encounterId: string): string {
  return `recall:${encounterId}`
}

/**
 * Utterances to step through. Diarised transcripts give real speaker turns;
 * plain transcripts fall back to sentence-ish chunks so the flow still works.
 */
function toUtterances(transcript: string): TranscriptTurn[] {
  const turns = parseDiarizedTranscript(transcript?.trim() ?? "")
  if (turns && turns.length > 0) return turns
  const plain = (transcript ?? "").trim()
  if (!plain) return []
  return plain
    .split(/(?<=[.?!])\s+/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ speaker: 0, text }))
}

export function StimulatedRecallView({ encounter }: { encounter: Encounter }) {
  const utterances = useMemo(() => toUtterances(encounter.transcript_text), [encounter.transcript_text])
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([])
  const [ratings, setRatings] = useState<Record<number, CueRating>>({})
  const [active, setActive] = useState<number | null>(null)
  const [selectedHyp, setSelectedHyp] = useState<string | null>(null)
  const [pendingValue, setPendingValue] = useState<number | null>(null)
  const [pendingPct, setPendingPct] = useState<number | null>(null)
  const [newHypName, setNewHypName] = useState("")
  const [loaded, setLoaded] = useState(false)
  const [recallStatus, setRecallStatus] = useState<RecallRecordingStatus>("idle")
  const [hasRecallAudio, setHasRecallAudio] = useState(false)
  const [recallAudioVersion, setRecallAudioVersion] = useState(0)
  const utteranceRefs = useRef<Array<HTMLButtonElement | null>>([])
  const recallBlobRef = useRef<Blob | null>(null)

  // Recall-recording timeline. The offset clock counts recorded time only:
  // accumulated ms up to the last pause, plus the running stretch since the
  // last start/resume when not paused.
  const timelineRef = useRef<RecallTimeline | null>(null)
  const recordedMsRef = useRef(0)
  const runningSinceRef = useRef<number | null>(null)

  const recordedOffsetSeconds = () => {
    const running = runningSinceRef.current === null ? 0 : performance.now() - runningSinceRef.current
    return Math.round(recordedMsRef.current + running) / 1000
  }

  const recorder = useAudioRecorder({ emitSegments: false })
  const recallKey = recallAudioKey(encounter.id)

  // Load the saved session for this encounter; reset transient state on switch.
  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setActive(null)
    setPendingValue(null)
    setPendingPct(null)
    setRecallStatus("idle")
    setHasRecallAudio(false)
    recallBlobRef.current = null
    timelineRef.current = null
    recordedMsRef.current = 0
    runningSinceRef.current = null
    void getEncounterAudio(recallAudioKey(encounter.id)).then((blob) => {
      if (!cancelled) setHasRecallAudio(Boolean(blob))
    })
    void loadSecureItem<RecallSession>(storageKey(encounter.id)).then((saved) => {
      if (cancelled) return
      setHypotheses(saved?.hypotheses ?? [])
      setRatings(saved?.ratings ?? {})
      setSelectedHyp(saved?.hypotheses?.[0]?.id ?? null)
      archivedAtRef.current = saved?.recallArchivedAt
      timelineRef.current = saved?.timeline ?? null
      if (saved?.recallArchivedAt) setRecallStatus("archived")
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [encounter.id])

  const archivedAtRef = useRef<string | undefined>(undefined)

  const persist = useCallback(
    (nextHypotheses: Hypothesis[], nextRatings: Record<number, CueRating>) => {
      void saveSecureItem<RecallSession>(storageKey(encounter.id), {
        hypotheses: nextHypotheses,
        ratings: nextRatings,
        timeline: timelineRef.current ?? undefined,
        recallArchivedAt: archivedAtRef.current,
      })
    },
    [encounter.id],
  )

  const leadingId = useMemo(() => {
    if (hypotheses.length === 0) return null
    return hypotheses.reduce((best, h) => (h.pct > best.pct ? h : best), hypotheses[0]).id
  }, [hypotheses])

  const selectUtterance = (index: number) => {
    // While the recall interview is being recorded, log the click against the
    // recording's timeline so the audio can later be segmented per utterance.
    if (recallStatus === "recording" && timelineRef.current) {
      timelineRef.current.utteranceClicks.push({
        utterance: index,
        audioOffsetSeconds: recordedOffsetSeconds(),
        at: new Date().toISOString(),
      })
    }
    setActive(index)
    setPendingValue(ratings[index]?.value ?? null)
    setPendingPct(null)
    if (ratings[index]) setSelectedHyp(ratings[index].hypothesisId)
  }

  const addHypothesis = () => {
    const name = newHypName.trim()
    if (!name) return
    const hyp: Hypothesis = { id: crypto.randomUUID(), name, pct: 50, history: [50] }
    const next = [...hypotheses, hyp]
    setHypotheses(next)
    setSelectedHyp(hyp.id)
    setNewHypName("")
    persist(next, ratings)
  }

  const saveRating = () => {
    if (active === null || !selectedHyp || pendingValue === null) return
    const hyp = hypotheses.find((h) => h.id === selectedHyp)
    if (!hyp) return
    const updatedPct = pendingPct ?? hyp.pct
    const nextHypotheses = hypotheses.map((h) =>
      h.id === selectedHyp ? { ...h, pct: updatedPct, history: [...h.history, updatedPct].slice(-12) } : h,
    )
    const nextRatings: Record<number, CueRating> = {
      ...ratings,
      [active]: { utterance: active, value: pendingValue, hypothesisId: selectedHyp, updatedPct },
    }
    setHypotheses(nextHypotheses)
    setRatings(nextRatings)
    persist(nextHypotheses, nextRatings)
    // Advance to the next unrated utterance.
    for (let i = active + 1; i < utterances.length; i++) {
      if (!nextRatings[i]) {
        selectUtterance(i)
        utteranceRefs.current[i]?.scrollIntoView({ block: "center", behavior: "smooth" })
        return
      }
    }
    setActive(null)
  }

  const sessionPayload = useCallback(() => {
    const timeline = timelineRef.current
    return {
      encounter_id: encounter.id,
      exported_at: new Date().toISOString(),
      hypotheses,
      ratings: Object.values(ratings)
        .sort((a, b) => a.utterance - b.utterance)
        .map((r) => ({
          ...r,
          utterance_text: utterances[r.utterance]?.text ?? "",
          speaker: utterances[r.utterance]?.speaker ?? null,
        })),
      // Timing of the recall recording: segment the audio per utterance by
      // cutting between consecutive clicks (offsets are recorded time, so
      // they map directly onto the audio file even across pauses).
      recording: timeline
        ? {
            started_at: timeline.startedAt,
            stopped_at: timeline.stoppedAt ?? null,
            duration_seconds: timeline.durationSeconds ?? null,
            utterance_clicks: timeline.utteranceClicks.map((c) => ({
              utterance: c.utterance,
              audio_offset_seconds: c.audioOffsetSeconds,
              at: c.at,
            })),
          }
        : null,
    }
  }, [encounter.id, hypotheses, ratings, utterances])

  const startRecall = async () => {
    try {
      await recorder.startRecording()
      // Fresh timeline per take: a re-record replaces the audio, so it
      // replaces the click timings too.
      timelineRef.current = { startedAt: new Date().toISOString(), utteranceClicks: [] }
      recordedMsRef.current = 0
      runningSinceRef.current = performance.now()
      setRecallStatus("recording")
    } catch {
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
        archivedAtRef.current = new Date().toISOString()
        persist(hypotheses, ratings)
        recallBlobRef.current = null
        setRecallStatus("archived")
      } catch {
        setRecallStatus("failed")
      }
    },
    [encounter.created_at, encounter.id, hypotheses, persist, ratings, sessionPayload],
  )

  const stopRecall = async () => {
    if (timelineRef.current) {
      timelineRef.current.stoppedAt = new Date().toISOString()
      timelineRef.current.durationSeconds = recordedOffsetSeconds()
    }
    runningSinceRef.current = null
    const blob = await recorder.stopRecording()
    recallBlobRef.current = blob
    // Keep the timeline even if archival fails or is not configured.
    persist(hypotheses, ratings)
    if (blob) {
      // Store locally right away so the strip morphs into a playable player;
      // the archived copy uploads in the background.
      void saveEncounterAudio(
        recallKey,
        new File([blob], "recall_audio.wav", { type: blob.type || "audio/wav" }),
      ).catch(() => undefined)
      setHasRecallAudio(true)
      setRecallAudioVersion((v) => v + 1)
    }
    await uploadRecall(blob)
  }

  const exportSession = () => {
    const blob = new Blob([JSON.stringify(sessionPayload(), null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `stimulated_recall_${encounter.id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (utterances.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No transcript available for this consultation — stimulated recall needs one.
        </p>
      </div>
    )
  }

  const activeUtterance = active !== null ? utterances[active] : null
  const selectedHypothesis = hypotheses.find((h) => h.id === selectedHyp) ?? null
  const ratedCount = Object.keys(ratings).length

  return (
    <div>
      {/* Recall-interview audio strip: the same recording control as the
          consultation capture, morphing into a player once recorded. */}
      <div className="mb-6 rounded-2xl border border-border bg-card p-4 shadow-soft">
        {recallStatus === "recording" ? (
          <RecordingBar
            duration={recorder.duration}
            isPaused={recorder.isPaused}
            analyser={recorder.analyser}
            onStop={() => void stopRecall()}
            onPause={pauseRecall}
            onResume={resumeRecall}
            stopLabel="Stop & archive"
          />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {hasRecallAudio ? (
              <AudioPlayer
                key={`${recallKey}:${recallAudioVersion}`}
                audioKey={recallKey}
                className="min-w-0 flex-1"
              />
            ) : (
              <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                Record the recall interview alongside your ratings.
              </p>
            )}
            {recallStatus === "saving" && (
              <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Archiving…
              </span>
            )}
            {recallStatus === "archived" && (
              <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-success">
                <Check className="h-3.5 w-3.5" /> Archived
              </span>
            )}
            {recallStatus === "skipped" && (
              <span className="shrink-0 text-xs text-muted-foreground">Archiving not configured</span>
            )}
            {recallStatus === "failed" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void uploadRecall(recallBlobRef.current)}
                className="h-8 shrink-0 rounded-full border-destructive/40 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                <span className="text-xs">Archive failed — retry</span>
              </Button>
            )}
            {recallStatus !== "saving" && (
              <Button
                size="sm"
                onClick={() => void startRecall()}
                className="h-9 shrink-0 rounded-full bg-primary px-4 text-primary-foreground shadow-soft hover:bg-brand-strong"
              >
                <Mic className="mr-1.5 h-3.5 w-3.5" />
                <span className="text-xs">{hasRecallAudio ? "Re-record" : "Record recall"}</span>
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        {/* Transcript thread */}
        <section>
          <div className="mb-3 flex items-baseline justify-between px-1">
            <h2 className="text-sm font-semibold text-foreground">Consultation transcript</h2>
            <span className="text-xs text-muted-foreground">
              {active !== null ? `Utterance ${active + 1} of ${utterances.length}` : `${utterances.length} utterances`}
              {" · "}
              {ratedCount} rated
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {utterances.map((utterance, i) => {
              const isActive = active === i
              const isRated = Boolean(ratings[i])
              return (
                <button
                  key={i}
                  ref={(el) => {
                    utteranceRefs.current[i] = el
                  }}
                  onClick={() => selectUtterance(i)}
                  className={cn(
                    "relative grid grid-cols-[72px_1fr] gap-3 overflow-hidden rounded-xl border p-3.5 text-left transition-all",
                    isActive
                      ? "border-primary bg-brand-soft/50 shadow-soft ring-1 ring-primary/30"
                      : "border-border bg-card hover:border-input",
                  )}
                >
                  {isActive && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />}
                  <div>
                    <span
                      className={cn(
                        "text-[11px] font-semibold tracking-wide",
                        utterance.speaker % 2 === 0 ? "text-primary" : "text-warning-foreground/70",
                      )}
                    >
                      Speaker {utterance.speaker + 1}
                    </span>
                    <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">#{i + 1}</span>
                  </div>
                  <div>
                    <p className="text-[0.92rem] leading-6 text-foreground/90">{utterance.text}</p>
                    {isRated && (
                      <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-success">
                        <Check className="h-3.5 w-3.5" /> rated {ratings[i].value > 0 ? `+${ratings[i].value}` : ratings[i].value}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        {/* Rail */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          {/* Hypotheses */}
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">Your hypotheses</h3>
              <span className="text-xs text-muted-foreground">
                {active !== null ? `at utterance ${active + 1}` : "current"}
              </span>
            </div>
            <div className="flex flex-col gap-3 p-4">
              {hypotheses.length === 0 && loaded && (
                <p className="px-1 text-center text-xs text-muted-foreground">
                  Name the diagnoses you were considering during this consultation.
                </p>
              )}
              {hypotheses.map((h) => (
                <div
                  key={h.id}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border p-3",
                    h.id === leadingId ? "border-primary/40 bg-brand-soft/40" : "border-border bg-background",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{h.name}</span>
                    {h.id === leadingId && (
                      <span className="rounded-full border border-primary/40 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-primary">
                        leading
                      </span>
                    )}
                    <span className="ml-auto font-mono text-sm font-semibold text-foreground">{h.pct}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${h.pct}%` }} />
                  </div>
                  {h.history.length > 1 && (
                    <div className="flex h-5 items-end gap-[3px]" title="Likelihood after each rated cue">
                      {h.history.map((v, j) => (
                        <span
                          key={j}
                          className="w-1.5 rounded-sm bg-primary/50"
                          style={{ height: `${Math.max(12, v)}%` }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  value={newHypName}
                  onChange={(e) => setNewHypName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addHypothesis()
                  }}
                  placeholder="Name a hypothesis you had…"
                  aria-label="New hypothesis"
                  className="min-w-0 flex-1 rounded-lg border border-dashed border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
                <Button variant="outline" size="sm" onClick={addHypothesis} className="h-9 shrink-0 rounded-lg px-3">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Cue rating */}
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">Rate this cue</h3>
              {active !== null && <span className="text-xs text-muted-foreground">utterance #{active + 1}</span>}
            </div>
            <div className="flex flex-col gap-3.5 p-4">
              {!activeUtterance && (
                <p className="px-1 py-2 text-center text-xs text-muted-foreground">
                  Select an utterance to rate how it shaped your thinking.
                </p>
              )}
              {activeUtterance && hypotheses.length === 0 && (
                <p className="px-1 py-2 text-center text-xs text-muted-foreground">Add a hypothesis first.</p>
              )}
              {activeUtterance && hypotheses.length > 0 && (
                <>
                  <div className="text-xs text-foreground/75">
                    How much does this cue support your hypothesis of{" "}
                    <select
                      value={selectedHyp ?? ""}
                      onChange={(e) => setSelectedHyp(e.target.value)}
                      aria-label="Hypothesis being rated"
                      className="inline-block max-w-full rounded-md border border-input bg-background px-1.5 py-0.5 font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      {hypotheses.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                    </select>
                    ?
                  </div>
                  <div>
                    <div className="grid grid-cols-7 gap-1.5">
                      {SCALE_VALUES.map((v) => (
                        <button
                          key={v}
                          onClick={() => setPendingValue(v)}
                          aria-label={`Rate ${v}`}
                          className={cn(
                            "aspect-square rounded-lg font-mono text-sm font-bold text-white transition-all",
                            SCALE_CLASS[v],
                            pendingValue === v
                              ? "-translate-y-0.5 opacity-100 shadow-soft ring-2 ring-foreground/70 ring-offset-1"
                              : "opacity-40 hover:opacity-80",
                          )}
                        >
                          {v > 0 ? `+${v}` : v}
                        </button>
                      ))}
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                      <span>strongly against</span>
                      <span>neutral</span>
                      <span>strongly supports</span>
                    </div>
                  </div>
                  {selectedHypothesis && (
                    <div className="flex items-center gap-2.5 pt-1">
                      <label htmlFor="sr-updated-pct" className="flex-1 text-xs text-foreground/75">
                        Updated likelihood of <b className="font-semibold text-foreground">{selectedHypothesis.name}</b>
                      </label>
                      <input
                        id="sr-updated-pct"
                        type="range"
                        min={0}
                        max={100}
                        value={pendingPct ?? selectedHypothesis.pct}
                        onChange={(e) => setPendingPct(Number(e.target.value))}
                        className="flex-1 accent-[var(--primary,#45719e)]"
                      />
                      <span className="min-w-[42px] text-right font-mono text-sm font-semibold text-foreground">
                        {pendingPct ?? selectedHypothesis.pct}%
                      </span>
                    </div>
                  )}
                  <Button
                    onClick={saveRating}
                    disabled={pendingValue === null}
                    className="w-full rounded-xl bg-primary text-primary-foreground shadow-soft hover:bg-brand-strong"
                  >
                    Save rating &amp; continue
                  </Button>
                </>
              )}
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={exportSession}
            disabled={ratedCount === 0 && hypotheses.length === 0}
            className="rounded-full"
          >
            <Download className="mr-1.5 h-4 w-4" />
            <span className="text-xs">Export session data</span>
          </Button>
        </aside>
      </div>
    </div>
  )
}
