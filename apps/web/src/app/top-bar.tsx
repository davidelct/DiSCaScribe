"use client"

/**
 * Shared EPR chrome: brand, patient-register navigation, and the settings
 * entry point. Owns the settings dialog and its microphone/device plumbing so
 * every page (patient list, chart, consultation workspace) gets settings —
 * including BYOK key entry — without re-wiring audio state.
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Settings, Stethoscope } from "lucide-react"
import { Button } from "@ui/lib/ui/button"
import { SettingsDialog } from "@ui"
import { warmupMicrophonePermission } from "@audio"
import { getPreferences, setPreferences, debugWarn, initializeAuditLog } from "@storage"
import type { EncounterMode } from "@storage/types"

export function TopBar() {
  const [showSettings, setShowSettings] = useState(false)
  const [audioInputDevices, setAudioInputDevices] = useState<Array<{ id: string; label: string }>>([])
  const [preferredInputDeviceId, setPreferredInputDeviceId] = useState("")
  const [defaultMode, setDefaultMode] = useState<EncounterMode>("scribed")
  const [micPermissionStatus, setMicPermissionStatus] = useState("unknown")
  const [micReadinessMessage, setMicReadinessMessage] = useState("")
  const [lastFailureCode, setLastFailureCode] = useState("")

  useEffect(() => {
    const prefs = getPreferences()
    setPreferredInputDeviceId(prefs.preferredInputDeviceId || "")
    setDefaultMode(prefs.encounterMode || "scribed")
    // The top bar is on every page, so this runs once per page load:
    // cleans up expired audit entries and schedules periodic cleanup.
    void initializeAuditLog()
  }, [])

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return
    const refreshAudioDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        setAudioInputDevices(
          devices
            .filter((device) => device.kind === "audioinput")
            .map((device, index) => ({ id: device.deviceId, label: device.label || `Microphone ${index + 1}` })),
        )
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

  const handleRunMicrophoneCheck = useCallback(async () => {
    await refreshMicPermissionStatus()
    const warmed = await warmupMicrophonePermission()
    if (warmed) {
      setMicReadinessMessage("Ready")
      setLastFailureCode("")
    } else {
      setMicReadinessMessage("Unable to access microphone. Check permission and selected input device.")
      setLastFailureCode("MIC_STREAM_UNAVAILABLE")
    }
  }, [refreshMicPermissionStatus])

  const handlePreferredInputDeviceChange = useCallback((value: string) => {
    setPreferredInputDeviceId(value)
    void setPreferences({ preferredInputDeviceId: value })
  }, [])

  const handleDefaultModeChange = useCallback((value: EncounterMode) => {
    setDefaultMode(value)
    void setPreferences({ encounterMode: value })
  }, [])

  return (
    <>
      <header className="sticky top-0 z-30 shrink-0 border-b border-border bg-card/70 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-soft">
                <Stethoscope className="h-4 w-4" />
              </span>
              <span className="font-display text-lg font-medium tracking-tight text-foreground">DiSCaScribe</span>
              <span className="rounded-full border border-border px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                EPR
              </span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/"
                className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Patients
              </Link>
            </nav>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSettings(true)}
            className="group h-9 gap-2 rounded-full px-3 text-muted-foreground hover:text-foreground"
          >
            <Settings className="h-4 w-4 transition-transform duration-500 group-hover:rotate-45" />
            <span className="text-xs">Settings</span>
          </Button>
        </div>
      </header>
      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        audioInputDevices={audioInputDevices}
        preferredInputDeviceId={preferredInputDeviceId}
        onPreferredInputDeviceChange={handlePreferredInputDeviceChange}
        encounterMode={defaultMode}
        onEncounterModeChange={handleDefaultModeChange}
        micPermissionStatus={micPermissionStatus}
        lastMicReadinessMessage={micReadinessMessage}
        lastMicReadinessMetrics={null}
        lastFailureCode={lastFailureCode}
        onRunMicrophoneCheck={handleRunMicrophoneCheck}
      />
    </>
  )
}
