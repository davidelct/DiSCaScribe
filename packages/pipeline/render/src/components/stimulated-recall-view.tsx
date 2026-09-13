"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Encounter } from "@storage/types"
import { getEncounterAudio, saveEncounterAudio } from "@storage/audio-store"
import { useAudioRecorder, compressAudioFileToMp3 } from "@audio"
import { Button } from "@ui/lib/ui/button"
import { cn } from "@ui/lib/utils"
import { guessClinicianSpeaker, heuristicRecallExchanges } from "@pipeline-errors"
import { Check, Download, Loader2, Mic, Pause, Play, Plus, RotateCcw, Square } from "lucide-react"
import { AudioPlayer } from "./audio-player"
import { RecallTranscript } from "./recall-transcript"
import { FinalDiagnosisCard, RecallEntryCard, type EntryRow } from "./recall-entry"
import {
  buildRecallPayload,
  carriedLikelihood,
  emptyRecallSession,
  hypothesesAt,
  loadRecallSession,
  orderedEntries,
  recallAudioKey,
  saveRecallSession,
  toUtterances,
  type RecallEntry,
  type RecallRating,
  type RecallSession,
} from "./recall-session"

/**
 * Stimulated Recall (WT3.1).
 *
 * Two columns. Left, the consultation transcript as it reads in the
 * consultation view, every turn clickable and the question–answer exchanges
 * bracketed (detected by a small model beside note generation, or by a
 * question-mark heuristic until then). Right, one table per stop in
 * transcript order: what the clinician remembers thinking, and each
 * hypothesis they held with its likelihood and how much the answer supported
 * it. A new table starts from the previous one. The recall interview can be
 * recorded alongside, with every turn click timed against the recording.
 */

type RecallRecordingStatus = "idle" | "recording" | "saving" | "archived" | "skipped" | "failed"

const CARD = "rounded-2xl border border-border bg-card shadow-soft"

const PROMPT =
  "Go back over the consultation as it happened and report only the thoughts you remember having at the time: " +
  "tentative diagnoses, why you asked a question, what you made of the answer. Leave out what you know now and " +
  "anything you are unsure of. For each hypothesis, rate how likely it seemed then and how much the answer " +
  "supported it. You need not be exhaustive."

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  return `${String(minutes).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`
}

/** One of the two rating scales, drawn as the paper form draws it. */
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
  const exchanges = useMemo(
    () => (analysisFresh && analysis ? analysis.exchanges : heuristicRecallExchanges(turns, clinicianSpeaker)),
    [analysis, analysisFresh, clinicianSpeaker, turns],
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
  const update = useCallback(
    (updater: (current: RecallSession) => RecallSession) => {
      const next = updater(sessionRef.current)
      sessionRef.current = next
      setSession(next)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null
        void saveRecallSession(encounter.id, next)
      }, 300)
    },
    [encounter.id],
  )
  // A pending save is flushed when the view leaves or switches encounter.
  useEffect(() => {
    const id = encounter.id
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
        void saveRecallSession(id, sessionRef.current)
      }
    }
  }, [encounter.id])

  const [selected, setSelected] = useState<number[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [promptOpen, setPromptOpen] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [recallStatus, setRecallStatus] = useState<RecallRecordingStatus>("idle")
  const [hasRecallAudio, setHasRecallAudio] = useState(false)
  const [recallAudioVersion, setRecallAudioVersion] = useState(0)
  const turnRefs = useRef<Array<HTMLButtonElement | null>>([])
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
    setSelected([])
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

  // Exchanges missing or stale: detect them once per open, quietly.
  const detectRef = useRef(detectExchanges)
  useEffect(() => {
    detectRef.current = detectExchanges
  }, [detectExchanges])
  const attemptedRef = useRef<string | null>(null)
  useEffect(() => {
    const detect = detectRef.current
    if (analysisFresh || turns.length < 2 || !detect || attemptedRef.current === encounter.id) return
    attemptedRef.current = encounter.id
    setDetecting(true)
    detect(encounter.transcript_text)
      .catch(() => undefined)
      .finally(() => setDetecting(false))
  }, [analysisFresh, encounter.id, encounter.transcript_text, turns.length])

  // ── Derived views ──────────────────────────────────────────────────────────
  const ordered = useMemo(() => orderedEntries(session), [session])
  const questionTurns = useMemo(() => new Set(exchanges.map((exchange) => exchange.question)), [exchanges])
  const entryViews = useMemo(
    () =>
      ordered.map((entry, position) => {
        const rows: EntryRow[] = hypothesesAt(session, ordered, position).map((hypothesis) => {
          const rating = entry.ratings[hypothesis.id]
          return {
            hypothesis,
            isNew: hypothesis.entryId === entry.id,
            likelihood: rating?.likelihood ?? null,
            carried: carriedLikelihood(ordered, position, hypothesis.id),
            support: rating?.support ?? null,
          }
        })
        const first = entry.turns[0]
        return {
          entry,
          number: position + 1,
          rows,
          isQuestion: questionTurns.has(first) || /\?\s*$/.test(turns[first]?.text ?? ""),
          excerpt: entry.turns.map((index) => ({
            label: speakerLabel(turns[index]?.speaker ?? 0),
            text: turns[index]?.text ?? "",
          })),
        }
      }),
    [ordered, questionTurns, session, speakerLabel, turns],
  )
  const entryByTurn = useMemo(() => {
    const map = new Map<number, RecallEntry>()
    for (const entry of session.entries) for (const index of entry.turns) map.set(index, entry)
    return map
  }, [session.entries])
  const transcriptEntries = useMemo(
    () => entryViews.map((view) => ({ id: view.entry.id, number: view.number, turns: view.entry.turns })),
    [entryViews],
  )

  // ── Selection and entries ──────────────────────────────────────────────────
  const activateEntry = (id: string, scrollTranscript: boolean) => {
    setActiveId(id)
    requestAnimationFrame(() => entryRefs.current.get(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" }))
    if (scrollTranscript) {
      const first = sessionRef.current.entries.find((entry) => entry.id === id)?.turns[0]
      if (first !== undefined) turnRefs.current[first]?.scrollIntoView({ block: "center", behavior: "smooth" })
    }
  }

  const onTurnClick = (index: number) => {
    // While the recall interview is being recorded, log the click against the
    // recording's timeline so the audio can later be segmented per turn.
    if (recallStatus === "recording") {
      const click = { utterance: index, audioOffsetSeconds: recordedOffsetSeconds(), at: new Date().toISOString() }
      update((current) =>
        current.timeline
          ? { ...current, timeline: { ...current.timeline, utteranceClicks: [...current.timeline.utteranceClicks, click] } }
          : current,
      )
    }
    const owner = entryByTurn.get(index)
    if (owner) {
      activateEntry(owner.id, false)
      return
    }
    setSelected((current) => {
      if (current.includes(index)) return current.filter((i) => i !== index)
      // A turn in a question–answer exchange brings the whole exchange along,
      // unless part of it is already picked: then only this turn is added.
      const exchange = exchanges.find((candidate) => index >= candidate.question && index <= candidate.answer_end)
      const group = exchange
        ? Array.from({ length: exchange.answer_end - exchange.question + 1 }, (_, k) => exchange.question + k).filter(
            (i) => !entryByTurn.has(i),
          )
        : [index]
      const additions = group.some((i) => current.includes(i)) ? [index] : group
      return [...new Set([...current, ...additions])].sort((a, b) => a - b)
    })
  }

  const addEntry = () => {
    if (selected.length === 0) return
    const entry: RecallEntry = {
      id: crypto.randomUUID(),
      turns: [...selected].sort((a, b) => a - b),
      why: "",
      thinking: "",
      notes: "",
      ratings: {},
      createdAt: new Date().toISOString(),
    }
    update((current) => ({ ...current, entries: [...current.entries, entry] }))
    setSelected([])
    activateEntry(entry.id, false)
  }

  const removeEntry = (id: string) => {
    if (!window.confirm("Remove this entry and its ratings?")) return
    update((current) => {
      const entries = current.entries.filter((entry) => entry.id !== id)
      // A hypothesis first reported here moves to the earliest remaining
      // table, or goes with the entry when none is left.
      const earliest = orderedEntries({ ...current, entries })[0]
      const hypotheses = current.hypotheses.flatMap((hypothesis) =>
        hypothesis.entryId !== id ? [hypothesis] : earliest ? [{ ...hypothesis, entryId: earliest.id }] : [],
      )
      return { ...current, entries, hypotheses }
    })
    setActiveId((current) => (current === id ? null : current))
  }

  const patchEntry = (id: string, patch: Partial<RecallEntry>) =>
    update((current) => ({
      ...current,
      entries: current.entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    }))

  const rate = (entryId: string, hypothesisId: string, patch: Partial<RecallRating>) =>
    update((current) => ({
      ...current,
      entries: current.entries.map((entry) => {
        if (entry.id !== entryId) return entry
        const existing: RecallRating = entry.ratings[hypothesisId] ?? { likelihood: null, support: null }
        return { ...entry, ratings: { ...entry.ratings, [hypothesisId]: { ...existing, ...patch } } }
      }),
    }))

  const addHypothesis = (entryId: string, name: string) =>
    update((current) => ({
      ...current,
      hypotheses: [...current.hypotheses, { id: crypto.randomUUID(), name, entryId }],
    }))

  // Removing a hypothesis takes it off every table, ratings included.
  const removeHypothesis = (hypothesisId: string) =>
    update((current) => ({
      ...current,
      hypotheses: current.hypotheses.filter((hypothesis) => hypothesis.id !== hypothesisId),
      entries: current.entries.map((entry) => {
        if (!(hypothesisId in entry.ratings)) return entry
        const ratings = { ...entry.ratings }
        delete ratings[hypothesisId]
        return { ...entry, ratings }
      }),
    }))

  // ── Recording, archival, export ───────────────────────────────────────────
  const sessionPayload = useCallback(
    () =>
      buildRecallPayload({
        encounterId: encounter.id,
        session: sessionRef.current,
        turns,
        exchanges,
        exchangesDetected: analysisFresh,
        clinicianSpeaker,
        speakerLabel,
      }),
    [analysisFresh, clinicianSpeaker, encounter.id, exchanges, speakerLabel, turns],
  )

  const startRecall = async () => {
    try {
      await recorder.startRecording()
      // Fresh timeline per take: a re-record replaces the audio, so it
      // replaces the click timings too.
      update((current) => ({ ...current, timeline: { startedAt: new Date().toISOString(), utteranceClicks: [] } }))
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
        update((current) => ({ ...current, recallArchivedAt: new Date().toISOString() }))
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

  const nothingToExport = session.entries.length === 0 && session.hypotheses.length === 0

  return (
    <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1">
      {/* The interview's script and scales, with the recording and export
          actions: the row that stays when the prompt is folded away. */}
      <section className={cn(CARD, "shrink-0")}>
        <div className="flex min-h-8 flex-wrap items-center gap-3 px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">Recall prompt</h2>
          <button
            type="button"
            onClick={() => setPromptOpen((open) => !open)}
            aria-expanded={promptOpen}
            className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {promptOpen ? "Hide" : "Show"}
          </button>
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
          <div className="grid gap-x-10 gap-y-4 border-t border-border px-5 py-4 lg:grid-cols-[minmax(0,1fr)_520px] lg:items-center">
            <p className="text-[13.5px] leading-[21px] text-foreground/90">{PROMPT}</p>
            <div className="grid gap-8 sm:grid-cols-2">
              <Scale
                title="Likelihood"
                labels={["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]}
                minorEvery={1}
                ends={["Highly unlikely", "Highly likely"]}
              />
              <Scale
                title="Information support"
                labels={["−10", "−5", "0", "+5", "+10"]}
                minorEvery={5}
                ends={["Rules out", "No effect", "Confirms"]}
              />
            </div>
          </div>
        )}
      </section>

      {hasRecallAudio && recallStatus !== "recording" && (
        <AudioPlayer key={`${recallKey}:${recallAudioVersion}`} audioKey={recallKey} className={cn(CARD, "shrink-0 px-5 py-3")} />
      )}

      {!loaded ? (
        <div className="flex flex-1 items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[640px_minmax(0,1fr)]">
          {/* Transcript */}
          <section className={cn(CARD, "flex flex-col lg:min-h-0")}>
            <div className="flex min-h-8 items-center gap-3 px-5 py-3">
              <h2 className="text-sm font-semibold text-foreground">Transcript</h2>
              {detecting && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Finding questions
                </span>
              )}
              <div className="ml-auto flex items-center gap-3">
                {selected.length > 0 ? (
                  <>
                    <span className="text-xs text-muted-foreground">{selected.length} selected</span>
                    <Button size="sm" onClick={addEntry} className="h-7 rounded-md px-2.5">
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      <span className="text-xs">Add recall</span>
                    </Button>
                  </>
                ) : (
                  exchanges.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span aria-hidden className="inline-block h-3 w-0.5 rounded-full bg-primary/40" />
                      question and answer
                    </span>
                  )
                )}
              </div>
            </div>
            <div className="border-t border-border px-5 py-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <RecallTranscript
                turns={turns}
                speakerLabel={speakerLabel}
                accentSpeaker={accentSpeaker}
                exchanges={exchanges}
                entries={transcriptEntries}
                activeEntryId={activeId}
                selected={selected}
                onTurnClick={onTurnClick}
                registerTurn={(index, element) => {
                  turnRefs.current[index] = element
                }}
              />
            </div>
          </section>

          {/* Recall: one table per stop, in transcript order */}
          <section className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            <h2 className="shrink-0 px-1 text-sm font-semibold text-foreground">Recall</h2>
            {entryViews.length === 0 && (
              <p className="px-1 text-xs text-muted-foreground">
                Select the turns the clinician stopped at in the transcript, then add a recall.
              </p>
            )}
            {entryViews.map((view) => (
              <RecallEntryCard
                key={view.entry.id}
                number={view.number}
                entry={view.entry}
                excerpt={view.excerpt}
                isQuestion={view.isQuestion}
                rows={view.rows}
                active={view.entry.id === activeId}
                onActivate={() => activateEntry(view.entry.id, true)}
                onChange={(patch) => patchEntry(view.entry.id, patch)}
                onRate={(hypothesisId, patch) => rate(view.entry.id, hypothesisId, patch)}
                onAddHypothesis={(name) => addHypothesis(view.entry.id, name)}
                onRemoveHypothesis={removeHypothesis}
                onRemove={() => removeEntry(view.entry.id)}
                cardRef={(element) => {
                  if (element) entryRefs.current.set(view.entry.id, element)
                  else entryRefs.current.delete(view.entry.id)
                }}
              />
            ))}
            <FinalDiagnosisCard
              rows={session.finalDiagnosis}
              onChange={(rows) => update((current) => ({ ...current, finalDiagnosis: rows }))}
            />
          </section>
        </div>
      )}
    </div>
  )
}
