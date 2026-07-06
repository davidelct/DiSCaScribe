"use client"

import { useEffect, useRef } from "react"
import { cn } from "@ui/lib/utils"

interface WaveformVisualizerProps {
  /** Live analyser tapping the mic signal, or null before recording starts. */
  analyser: AnalyserNode | null
  isPaused: boolean
  className?: string
}

const BAR_COUNT = 44
const BAR_GAP = 3
// Fraction of the frequency spectrum to render — speech energy sits in the
// lower bins, so mapping the whole spectrum would leave most bars dead.
const VOICE_SPECTRUM_FRACTION = 0.6

function drawRoundedBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
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
 * Real-time microphone waveform. A symmetric row of rounded bars whose heights
 * follow the live mic signal, so a clinician can see their voice is being
 * captured. Silence settles into a gentle shimmer (never a frozen flat line);
 * pausing eases the bars down to a calm resting state.
 *
 * Purely decorative — recording state is announced by the adjacent status pill
 * and timer, so this is aria-hidden.
 */
export function WaveformVisualizer({ analyser, isPaused, className }: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Read the latest props inside the animation loop without restarting it.
  const analyserRef = useRef(analyser)
  const pausedRef = useRef(isPaused)
  analyserRef.current = analyser
  pausedRef.current = isPaused

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
    const color = getComputedStyle(canvas).color || "#3b6fb0"
    const displayed = new Array<number>(BAR_COUNT).fill(0)
    let frame = 0

    const sizeCanvas = (): { w: number; h: number } => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const bw = Math.round(w * dpr)
      const bh = Math.round(h * dpr)
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw
        canvas.height = bh
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      return { w, h }
    }

    const readTargets = (): number[] => {
      const targets = new Array<number>(BAR_COUNT).fill(0)
      const a = analyserRef.current
      if (!a || pausedRef.current) return targets
      const bins = new Uint8Array(a.frequencyBinCount)
      a.getByteFrequencyData(bins)
      const usable = Math.max(BAR_COUNT, Math.floor(bins.length * VOICE_SPECTRUM_FRACTION))
      const per = Math.floor(usable / BAR_COUNT)
      for (let i = 0; i < BAR_COUNT; i += 1) {
        let sum = 0
        for (let j = 0; j < per; j += 1) sum += bins[i * per + j]
        targets[i] = Math.min(1, sum / per / 255 * 1.5)
      }
      return targets
    }

    const render = (time: number) => {
      const { w, h } = sizeCanvas()
      ctx.clearRect(0, 0, w, h)

      const active = !!analyserRef.current && !pausedRef.current
      const targets = readTargets()
      const barW = Math.max(2, (w - (BAR_COUNT - 1) * BAR_GAP) / BAR_COUNT)
      const minH = barW // dot when silent
      const maxH = h * 0.9
      const centerY = h / 2
      ctx.fillStyle = color

      for (let i = 0; i < BAR_COUNT; i += 1) {
        // When idle, breathe a subtle sine wave so silence looks alive.
        const idle = active ? 0 : 0.05 + 0.035 * (Math.sin(time / 700 + i * 0.5) + 1) / 2
        const target = Math.max(targets[i], idle)
        displayed[i] += (target - displayed[i]) * (active ? 0.35 : 0.08)
        const amp = displayed[i]
        const barH = Math.max(minH, amp * maxH)
        const x = i * (barW + BAR_GAP)
        ctx.globalAlpha = active ? 0.4 + 0.6 * Math.min(1, amp * 1.4) : 0.3
        drawRoundedBar(ctx, x, centerY - barH / 2, barW, barH)
      }
      ctx.globalAlpha = 1
      frame = requestAnimationFrame(render)
    }

    if (prefersReducedMotion) {
      const { w, h } = sizeCanvas()
      ctx.clearRect(0, 0, w, h)
      const barW = Math.max(2, (w - (BAR_COUNT - 1) * BAR_GAP) / BAR_COUNT)
      ctx.fillStyle = color
      ctx.globalAlpha = 0.3
      for (let i = 0; i < BAR_COUNT; i += 1) {
        drawRoundedBar(ctx, i * (barW + BAR_GAP), h / 2 - barW / 2, barW, barW)
      }
      ctx.globalAlpha = 1
      return
    }

    frame = requestAnimationFrame(render)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn("block text-primary transition-opacity duration-500", isPaused && "opacity-60", className)}
    />
  )
}
