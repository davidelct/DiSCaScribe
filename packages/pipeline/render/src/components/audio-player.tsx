"use client"

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react"
import { Play, Pause } from "lucide-react"
import { getEncounterAudio } from "@storage"
import { cn } from "@ui/lib/utils"

interface AudioPlayerProps {
  encounterId: string
  className?: string
}

// Match the live recording waveform's bar look: ~5px rounded bars, 3px gaps.
// Bar count is derived from width so the density matches regardless of the
// container. Peaks are decoded at a high fixed resolution and downsampled to
// however many bars fit.
const BAR_GAP = 3
const TARGET_BAR_WIDTH = 5
const PEAK_RESOLUTION = 400

function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const mins = Math.floor(s / 60)
  const secs = Math.floor(s % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

/** Downsample the decoded audio into per-bar peak amplitudes (0–1). */
function computePeaks(buffer: AudioBuffer, count: number): number[] {
  const data = buffer.getChannelData(0)
  const per = Math.max(1, Math.floor(data.length / count))
  const peaks = new Array<number>(count).fill(0)
  let max = 0
  for (let i = 0; i < count; i += 1) {
    let peak = 0
    const start = i * per
    for (let j = 0; j < per; j += 1) {
      const v = Math.abs(data[start + j] ?? 0)
      if (v > peak) peak = v
    }
    peaks[i] = peak
    if (peak > max) max = peak
  }
  if (max > 0) for (let i = 0; i < count; i += 1) peaks[i] /= max
  return peaks
}

function drawRoundedBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = Math.min(w / 2, h / 2)
  ctx.beginPath()
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r)
  } else {
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }
  ctx.fill()
}

/**
 * Listen back to a consultation recording. Loads the stored audio for an
 * encounter and renders a waveform scrubber that echoes the recording view:
 * played bars are solid, the rest are faded. Renders nothing when the encounter
 * has no stored recording (e.g. consultations from before this feature).
 */
export function AudioPlayer({ encounterId, className }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaksRef = useRef<number[] | null>(null)
  const durationRef = useRef(0)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const color = getComputedStyle(canvas).color || "#3d6fa6"
    const peaks = peaksRef.current
    const audio = audioRef.current
    const dur = audio && Number.isFinite(audio.duration) ? audio.duration : durationRef.current
    const frac = audio && dur > 0 ? Math.min(1, audio.currentTime / dur) : 0

    const barCount = Math.max(12, Math.floor((w + BAR_GAP) / (TARGET_BAR_WIDTH + BAR_GAP)))
    const barW = (w - (barCount - 1) * BAR_GAP) / barCount
    const centerY = h / 2
    const maxH = h * 0.9
    const minH = barW
    ctx.fillStyle = color
    for (let i = 0; i < barCount; i += 1) {
      let amp = 0.14
      if (peaks && peaks.length) {
        const start = Math.floor((i / barCount) * peaks.length)
        const end = Math.max(start + 1, Math.floor(((i + 1) / barCount) * peaks.length))
        let peak = 0
        for (let k = start; k < end; k += 1) if (peaks[k] > peak) peak = peaks[k]
        amp = peak
      }
      const barH = Math.max(minH, amp * maxH)
      const x = i * (barW + BAR_GAP)
      const played = (i + 0.5) / barCount <= frac
      ctx.globalAlpha = played ? 0.95 : 0.28
      drawRoundedBar(ctx, x, centerY - barH / 2, barW, barH)
    }
    ctx.globalAlpha = 1
    // Stable across renders (reads duration from a ref, not state) so the audio
    // load effect below doesn't re-run and thrash on every duration update.
  }, [])

  // Load + decode the recording whenever the encounter changes.
  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    setAvailable(null)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    durationRef.current = 0
    peaksRef.current = null

    void (async () => {
      const blob = await getEncounterAudio(encounterId)
      if (cancelled) return
      if (!blob) {
        setAvailable(false)
        return
      }
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
      setAvailable(true)
      try {
        const arrayBuffer = await blob.arrayBuffer()
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return
        const audioCtx = new Ctor()
        const decoded = await audioCtx.decodeAudioData(arrayBuffer)
        await audioCtx.close().catch(() => undefined)
        if (cancelled) return
        peaksRef.current = computePeaks(decoded, PEAK_RESOLUTION)
        draw()
      } catch {
        // Playback still works via the <audio> element; scrubber falls back to
        // a flat waveform.
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(null)
    }
  }, [encounterId, draw])

  // Redraw: a smooth playhead while playing, a single frame when idle.
  useEffect(() => {
    if (!isPlaying) {
      draw()
      return
    }
    let raf = 0
    const loop = () => {
      draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, draw])

  // Paint once the canvas has mounted (available flips to true), and keep it
  // crisp on resize.
  useEffect(() => {
    if (available !== true) return
    draw()
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => draw())
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [draw, available])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play()
    else audio.pause()
  }

  const handleSeek = (event: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current
    const time = Number(event.target.value)
    if (audio) audio.currentTime = time
    setCurrentTime(time)
    draw()
  }

  // Blob-backed MP3s can report Infinity duration until nudged; force a value.
  const handleLoadedMetadata = () => {
    const audio = audioRef.current
    if (!audio) return
    if (!Number.isFinite(audio.duration)) {
      audio.currentTime = 1e101
    } else {
      durationRef.current = audio.duration
      setDuration(audio.duration)
    }
  }
  const handleDurationChange = () => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(audio.duration)) return
    durationRef.current = audio.duration
    setDuration(audio.duration)
    if (audio.currentTime > 1e100) audio.currentTime = 0
    draw()
  }

  if (available !== true) return null

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <audio
        ref={audioRef}
        src={url ?? undefined}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleDurationChange}
        onTimeUpdate={() => {
          const audio = audioRef.current
          if (audio) setCurrentTime(audio.currentTime)
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          const audio = audioRef.current
          if (audio) audio.currentTime = 0
          setIsPlaying(false)
          setCurrentTime(0)
        }}
      />

      <button
        type="button"
        onClick={togglePlay}
        aria-label={isPlaying ? "Pause recording" : "Play recording"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
      </button>

      <div className="relative h-9 w-40 shrink-0 sm:w-48">
        <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full text-primary" />
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={Math.min(currentTime, duration || 0)}
          onChange={handleSeek}
          aria-label="Seek recording"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>

      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  )
}
