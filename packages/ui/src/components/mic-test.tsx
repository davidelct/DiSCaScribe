"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Mic, RotateCcw } from "lucide-react"
import { Button } from "@ui/lib/ui/button"
import { cn } from "@ui/lib/utils"
import { WaveformVisualizer } from "./waveform-visualizer"

type MicTestState = "starting" | "live" | "error"

interface MicTestProps {
  /** Preferred input device id from settings; empty means system default. */
  preferredDeviceId?: string
  className?: string
}

/** RMS above this counts as speech (normalized time-domain signal). */
const HEARD_RMS_THRESHOLD = 0.04

/**
 * Live microphone check: opens the configured input device, renders the live
 * waveform, and confirms out loud the moment actual speech is detected — so a
 * clinician can verify the setup is ready before opening a consultation.
 * Starts automatically on mount and releases the device on unmount.
 */
export function MicTest({ preferredDeviceId, className }: MicTestProps) {
  const [state, setState] = useState<MicTestState>("starting")
  const [heard, setHeard] = useState(false)
  const [usingFallback, setUsingFallback] = useState(false)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const rafRef = useRef(0)

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    void contextRef.current?.close().catch(() => undefined)
    contextRef.current = null
    setAnalyser(null)
  }, [])

  const start = useCallback(async () => {
    stop()
    setState("starting")
    setHeard(false)
    setUsingFallback(false)

    let stream: MediaStream
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: preferredDeviceId ? { deviceId: { exact: preferredDeviceId } } : true,
        })
      } catch (error) {
        if (!preferredDeviceId) throw error
        // Preferred device gone (unplugged, renamed) — fall back to default.
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        setUsingFallback(true)
      }
    } catch {
      setState("error")
      return
    }

    streamRef.current = stream
    const context = new AudioContext()
    contextRef.current = context
    void context.resume().catch(() => undefined)
    const source = context.createMediaStreamSource(stream)
    const node = context.createAnalyser()
    node.fftSize = 2048
    source.connect(node)
    setAnalyser(node)
    setState("live")

    // Watch the signal until speech is detected once; the waveform keeps
    // animating on its own after that.
    const data = new Uint8Array(node.fftSize)
    const tick = () => {
      node.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i] - 128) / 128
        sum += v * v
      }
      if (Math.sqrt(sum / data.length) > HEARD_RMS_THRESHOLD) {
        setHeard(true)
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [preferredDeviceId, stop])

  useEffect(() => {
    void start()
    return stop
  }, [start, stop])

  return (
    <div className={cn("rounded-2xl border border-border bg-background p-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Mic className="h-3.5 w-3.5" />
          Microphone check
        </p>
        {state === "live" && (
          <span
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[0.65rem] font-semibold transition-colors",
              heard
                ? "border-success/30 bg-success/10 text-success"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            {heard ? "We can hear you" : "Say something…"}
          </span>
        )}
      </div>

      {state === "error" ? (
        <div className="mt-3 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-destructive">
            Microphone unavailable. Check the browser permission and the device selected in Settings.
          </p>
          <Button variant="outline" size="sm" onClick={() => void start()} className="h-8 shrink-0 rounded-full px-3">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            <span className="text-xs">Retry</span>
          </Button>
        </div>
      ) : (
        <WaveformVisualizer analyser={analyser} isPaused={false} className="mt-3 h-10 w-full" />
      )}

      {usingFallback && (
        <p className="mt-2 text-xs text-muted-foreground">
          Preferred microphone unavailable — using the system default.
        </p>
      )}
    </div>
  )
}
