"use client"

import { useEffect, useState } from "react"
import { Mic, Check } from "lucide-react"
import { Button } from "@ui/lib/ui/button"

interface PermissionsDialogProps {
  onComplete: () => void
  preferredInputDeviceId?: string
}

export function PermissionsDialog({ onComplete, preferredInputDeviceId }: PermissionsDialogProps) {
  const [microphoneGranted, setMicrophoneGranted] = useState(false)
  const [microphoneStatusMessage, setMicrophoneStatusMessage] = useState("")
  const [initialCheckDone, setInitialCheckDone] = useState(false)

  useEffect(() => {
    let active = true
    const check = async () => {
      try {
        if (typeof navigator !== "undefined" && navigator.permissions?.query) {
          const status = await navigator.permissions.query({ name: "microphone" as PermissionName })
          if (active) setMicrophoneGranted(status.state === "granted")
        }
      } catch {
        // The Permissions API doesn't support "microphone" in every browser;
        // rely on the Enable button in that case.
      } finally {
        if (active) setInitialCheckDone(true)
      }
    }
    void check()
    return () => {
      active = false
    }
  }, [])

  const handleEnableMicrophone = async () => {
    try {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: preferredInputDeviceId ? { deviceId: { exact: preferredInputDeviceId } } : true,
        })
      } catch (firstError) {
        const errorName = firstError instanceof Error ? firstError.name : ""
        if ((errorName === "NotFoundError" || errorName === "OverconstrainedError") && preferredInputDeviceId) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        } else {
          throw firstError
        }
      }
      stream.getTracks().forEach((track) => track.stop())
      setMicrophoneGranted(true)
      setMicrophoneStatusMessage("")
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to access the microphone. Check permission and the selected input device."
      setMicrophoneGranted(false)
      setMicrophoneStatusMessage(message)
      console.error("Failed to enable microphone", error)
    }
  }

  const canContinue = microphoneGranted

  if (!initialCheckDone) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4 backdrop-blur-sm">
        <div className="animate-scale-in w-full max-w-xl rounded-3xl border border-border bg-card p-8 shadow-lifted surface">
          <div className="text-center">
            <p className="text-muted-foreground">Checking permissions...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4 backdrop-blur-sm">
      <div className="animate-scale-in w-full max-w-xl rounded-3xl border border-border bg-card p-8 shadow-lifted surface">
        <div className="mb-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Permissions</p>
          <h2 className="font-display text-2xl font-medium tracking-tight text-foreground text-balance">
            Allow DiSCaScribe to capture clinical encounters
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            The scribe records audio from your microphone. Recording only starts when you enable it.
          </p>
        </div>

        <div className="space-y-3 rounded-2xl border border-border bg-background p-4">
          {/* Microphone Permission */}
          <div className="flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-accent/50">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft">
                <Mic className="h-5 w-5 text-primary" />
              </div>
              <span className="font-medium text-foreground">Microphone access</span>
            </div>
            {microphoneGranted ? (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft">
                <Check className="h-5 w-5 text-primary" />
              </div>
            ) : (
              <Button
                onClick={handleEnableMicrophone}
                className="rounded-full bg-primary text-primary-foreground shadow-soft hover:bg-brand-strong"
                size="sm"
              >
                <Mic className="mr-2 h-4 w-4" />
                Enable microphone
              </Button>
            )}
          </div>
          {!microphoneGranted && microphoneStatusMessage && (
            <p className="px-3 text-xs text-muted-foreground">{microphoneStatusMessage}</p>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <Button
            onClick={onComplete}
            disabled={!canContinue}
            className="rounded-full bg-primary px-6 text-primary-foreground shadow-soft hover:bg-brand-strong disabled:opacity-40"
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  )
}
