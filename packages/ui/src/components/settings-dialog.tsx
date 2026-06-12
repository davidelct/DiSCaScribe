"use client"

import { useState, useEffect, useRef } from "react"
import { X } from "lucide-react"
import { Button } from "@ui/lib/ui/button"
import { Label } from "@ui/lib/ui/label"
import { getAuditRetentionDays, setAuditRetentionDays, purgeAllAuditLogs } from "@storage/audit-log"
import { AuditLogViewer } from "./audit-log-viewer"

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  audioInputDevices: Array<{ id: string; label: string }>
  preferredInputDeviceId?: string
  onPreferredInputDeviceChange: (value: string) => void
  micPermissionStatus?: string
  lastMicReadinessMessage?: string
  lastMicReadinessMetrics?: { rms: number; peak: number } | null
  lastFailureCode?: string
  onRunMicrophoneCheck: () => Promise<void>
}

export function SettingsDialog({
  isOpen,
  onClose,
  audioInputDevices,
  preferredInputDeviceId,
  onPreferredInputDeviceChange,
  micPermissionStatus,
  lastMicReadinessMessage,
  lastMicReadinessMetrics,
  lastFailureCode,
  onRunMicrophoneCheck,
}: SettingsDialogProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState("")
  const [retentionDays, setRetentionDays] = useState(90)
  const [showAuditViewer, setShowAuditViewer] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const purgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isOpen) {
      setRetentionDays(getAuditRetentionDays())
    }
  }, [isOpen])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (purgeTimerRef.current) clearTimeout(purgeTimerRef.current)
    }
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    setSaveMessage("")

    try {
      // Save retention policy
      setAuditRetentionDays(retentionDays)

      setSaveMessage("Settings saved successfully")
      saveTimerRef.current = setTimeout(() => {
        setSaveMessage("")
        onClose()
      }, 1500)
    } catch (error) {
      console.error("Failed to save settings:", error)
      setSaveMessage("Failed to save settings")
    } finally {
      setIsSaving(false)
    }
  }

  const handlePurgeAuditLogs = async () => {
    if (!confirm("Are you sure you want to delete ALL audit logs? This action cannot be undone.")) {
      return
    }

    try {
      await purgeAllAuditLogs()
      setSaveMessage("Audit logs purged successfully")
      purgeTimerRef.current = setTimeout(() => setSaveMessage(""), 2000)
    } catch (error) {
      console.error("Failed to purge audit logs:", error)
      setSaveMessage("Failed to purge audit logs")
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4 backdrop-blur-sm">
      <div className="animate-scale-in max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-border bg-card p-8 shadow-lifted surface">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-2xl font-medium tracking-tight text-foreground">Settings</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-9 w-9 rounded-full p-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </Button>
        </div>

        {/* Settings Content */}
        <div className="space-y-6">
          {/* Audio Input */}
          <div className="space-y-3">
            <Label className="text-base font-medium text-foreground">Audio Input</Label>
            <p className="text-sm text-muted-foreground">
              Pick the microphone used for encounter capture and run a readiness check.
            </p>
            <div className="space-y-2">
              <Label htmlFor="preferred-input-device" className="text-sm font-medium text-foreground">
                Microphone Device
              </Label>
              <select
                id="preferred-input-device"
                value={preferredInputDeviceId || ""}
                onChange={(e) => onPreferredInputDeviceChange(e.target.value)}
                className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <option value="">System default microphone</option>
                {audioInputDevices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void onRunMicrophoneCheck()}>
                Run Microphone Check
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">OS permission status: {micPermissionStatus || "unknown"}</p>
            {lastMicReadinessMessage && (
              <p className="text-xs text-muted-foreground">Last mic check: {lastMicReadinessMessage}</p>
            )}
            {lastMicReadinessMetrics && (
              <p className="text-xs text-muted-foreground">
                Last levels: RMS {lastMicReadinessMetrics.rms.toFixed(4)}, Peak {lastMicReadinessMetrics.peak.toFixed(4)}
              </p>
            )}
            {lastFailureCode && <p className="text-xs text-muted-foreground">Last failure code: {lastFailureCode}</p>}
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Audit Logs Section */}
          <div className="space-y-3">
            <Label className="text-base font-medium text-foreground">Audit Logs</Label>
            <p className="text-sm text-muted-foreground">
              View and export HIPAA-compliant audit logs for all system operations
            </p>

            {/* Retention Policy */}
            <div className="space-y-2">
              <Label htmlFor="retention-days" className="text-sm font-medium text-foreground">
                Log Retention Period
              </Label>
              <select
                id="retention-days"
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <option value="30">30 days</option>
                <option value="90">90 days (recommended)</option>
                <option value="365">1 year</option>
                <option value="2555">7 years (HIPAA maximum)</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Logs older than this period will be automatically deleted
              </p>
            </div>

            {/* View/Export Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowAuditViewer(true)}
                className="flex-1"
              >
                View Audit Log
              </Button>
              <Button
                variant="outline"
                onClick={handlePurgeAuditLogs}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                Purge All Logs
              </Button>
            </div>
          </div>
        </div>

        {/* Save Message */}
        {saveMessage && (
          <div className={`mt-4 text-center text-sm ${saveMessage.includes("success") ? "text-success" : "text-destructive"}`}>
            {saveMessage}
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            className="rounded-full"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-full bg-primary text-primary-foreground shadow-soft hover:bg-brand-strong"
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Audit Log Viewer Modal */}
      {showAuditViewer && <AuditLogViewer onClose={() => setShowAuditViewer(false)} />}
    </div>
  )
}
