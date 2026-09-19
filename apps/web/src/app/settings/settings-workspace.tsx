"use client"

/**
 * The settings page: microphone and device plumbing, capture mode,
 * vocabulary, BYOK keys and audit logs. The controls themselves are the ui
 * package's SettingsPanel; this page owns the preferences and the
 * microphone state they read and write.
 */

import { useCallback, useEffect, useState } from "react"
import { ErrorBoundary, SettingsPanel, useHttpsWarning } from "@ui"
import { warmupMicrophonePermission } from "@audio"
import { getPreferences, setPreferences, debugWarn } from "@storage"
import type { EncounterMode, MicrophoneProcessing } from "@storage/types"
import { TopBar } from "../top-bar"

function SettingsContent() {
  const httpsWarning = useHttpsWarning()
  const [audioInputDevices, setAudioInputDevices] = useState<Array<{ id: string; label: string }>>([])
  const [preferredInputDeviceId, setPreferredInputDeviceId] = useState("")
  const [microphoneProcessing, setMicrophoneProcessing] = useState<MicrophoneProcessing>("browser")
  const [defaultMode, setDefaultMode] = useState<EncounterMode>("scribed")
  // undefined = the committed default vocabulary is in use.
  const [keytermsOverride, setKeytermsOverride] = useState<string[] | undefined>(undefined)
  const [micPermissionStatus, setMicPermissionStatus] = useState("unknown")
  const [micReadinessMessage, setMicReadinessMessage] = useState("")
  const [lastFailureCode, setLastFailureCode] = useState("")

  useEffect(() => {
    const prefs = getPreferences()
    setPreferredInputDeviceId(prefs.preferredInputDeviceId || "")
    setMicrophoneProcessing(prefs.rawMicrophone ? "raw" : "browser")
    setDefaultMode(prefs.encounterMode || "scribed")
    setKeytermsOverride(prefs.keytermsOverride)
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

  const handleMicrophoneProcessingChange = useCallback((value: MicrophoneProcessing) => {
    setMicrophoneProcessing(value)
    void setPreferences({ rawMicrophone: value === "raw" })
  }, [])

  const handleDefaultModeChange = useCallback((value: EncounterMode) => {
    setDefaultMode(value)
    void setPreferences({ encounterMode: value })
  }, [])

  const handleKeytermsOverrideChange = useCallback((terms: string[] | undefined) => {
    setKeytermsOverride(terms)
    // undefined clears the stored key, so the committed default applies again.
    void setPreferences({ keytermsOverride: terms })
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {httpsWarning && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-destructive px-4 py-2 text-center text-sm font-semibold text-destructive-foreground">
          {httpsWarning}
        </div>
      )}
      <TopBar />
      <main className="w-full flex-1 px-6 py-8">
        <SettingsPanel
          audioInputDevices={audioInputDevices}
          preferredInputDeviceId={preferredInputDeviceId}
          onPreferredInputDeviceChange={handlePreferredInputDeviceChange}
          microphoneProcessing={microphoneProcessing}
          onMicrophoneProcessingChange={handleMicrophoneProcessingChange}
          encounterMode={defaultMode}
          onEncounterModeChange={handleDefaultModeChange}
          keytermsOverride={keytermsOverride}
          onKeytermsOverrideChange={handleKeytermsOverrideChange}
          micPermissionStatus={micPermissionStatus}
          lastMicReadinessMessage={micReadinessMessage}
          lastMicReadinessMetrics={null}
          lastFailureCode={lastFailureCode}
          onRunMicrophoneCheck={handleRunMicrophoneCheck}
        />
      </main>
    </div>
  )
}

export function SettingsWorkspace() {
  return (
    <ErrorBoundary>
      <SettingsContent />
    </ErrorBoundary>
  )
}
