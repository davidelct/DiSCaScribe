"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@ui/lib/ui/button"
import { Label } from "@ui/lib/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/lib/ui/select"
import { getAuditRetentionDays, setAuditRetentionDays, purgeAllAuditLogs } from "@storage/audit-log"
import { loadByokApiKeys, saveByokApiKeys } from "@storage/api-keys-client"
import type { EncounterMode } from "@storage/types"
import { AuditLogViewer } from "./audit-log-viewer"
import { KeytermEditor } from "./keyterm-editor"

/**
 * The settings page body: one card per concern, laid out in a grid. Device,
 * capture mode and vocabulary apply as soon as they change; API keys and
 * the audit retention period are written by Save.
 */

export interface SettingsPanelProps {
  audioInputDevices: Array<{ id: string; label: string }>
  preferredInputDeviceId?: string
  onPreferredInputDeviceChange: (value: string) => void
  encounterMode: EncounterMode
  onEncounterModeChange: (value: EncounterMode) => void
  /** Keyterm override; absent means the committed default list is in use. */
  keytermsOverride?: string[]
  onKeytermsOverrideChange: (terms: string[] | undefined) => void
  micPermissionStatus?: string
  lastMicReadinessMessage?: string
  lastMicReadinessMetrics?: { rms: number; peak: number } | null
  lastFailureCode?: string
  onRunMicrophoneCheck: () => Promise<void>
}

const CARD = "flex flex-col gap-4 rounded-md border border-border bg-card p-5 shadow-soft"
const INPUT =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"

function CardHeading({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

export function SettingsPanel({
  audioInputDevices,
  preferredInputDeviceId,
  onPreferredInputDeviceChange,
  encounterMode,
  onEncounterModeChange,
  keytermsOverride,
  onKeytermsOverrideChange,
  micPermissionStatus,
  lastMicReadinessMessage,
  lastMicReadinessMetrics,
  lastFailureCode,
  onRunMicrophoneCheck,
}: SettingsPanelProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState("")
  const [retentionDays, setRetentionDays] = useState(90)
  const [showAuditViewer, setShowAuditViewer] = useState(false)
  const [confirmingPurge, setConfirmingPurge] = useState(false)
  const [deepgramApiKey, setDeepgramApiKey] = useState("")
  const [anthropicApiKey, setAnthropicApiKey] = useState("")
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setRetentionDays(getAuditRetentionDays())
    void loadByokApiKeys().then((keys) => {
      setDeepgramApiKey(keys.deepgramApiKey ?? "")
      setAnthropicApiKey(keys.anthropicApiKey ?? "")
    })
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current)
    }
  }, [])

  const flash = (message: string) => {
    setSaveMessage(message)
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current)
    messageTimerRef.current = setTimeout(() => setSaveMessage(""), 2500)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      setAuditRetentionDays(retentionDays)
      // BYOK provider keys: encrypted, this browser only.
      await saveByokApiKeys({ deepgramApiKey, anthropicApiKey })
      flash("Settings saved")
    } catch (error) {
      console.error("Failed to save settings:", error)
      flash("Failed to save settings")
    } finally {
      setIsSaving(false)
    }
  }

  const handlePurgeAuditLogs = async () => {
    setConfirmingPurge(false)
    try {
      await purgeAllAuditLogs()
      flash("Audit logs purged")
    } catch (error) {
      console.error("Failed to purge audit logs:", error)
      flash("Failed to purge audit logs")
    }
  }

  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium tracking-tight text-foreground">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Microphone, capture mode, vocabulary, keys and audit logs for this device.</p>
        </div>
        <div className="flex items-center gap-3">
          {saveMessage && (
            <span className={`text-sm ${saveMessage.startsWith("Failed") ? "text-destructive" : "text-success"}`}>{saveMessage}</span>
          )}
          <Button onClick={handleSave} disabled={isSaving} className="h-9 rounded-md px-4">
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Audio input */}
        <section className={CARD}>
          <CardHeading title="Audio input">Pick the microphone used for consultation capture and run a readiness check.</CardHeading>
          <div className="space-y-2">
            <Label htmlFor="preferred-input-device" className="text-sm font-medium text-foreground">
              Microphone
            </Label>
            {/* Radix Select forbids empty item values, so system default uses a sentinel. */}
            <Select
              value={preferredInputDeviceId || "__default__"}
              onValueChange={(value) => onPreferredInputDeviceChange(value === "__default__" ? "" : value)}
            >
              <SelectTrigger id="preferred-input-device">
                <SelectValue placeholder="System default microphone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">System default microphone</SelectItem>
                {audioInputDevices
                  .filter((device) => device.id)
                  .map((device) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Button variant="outline" onClick={() => void onRunMicrophoneCheck()} className="h-9 rounded-md">
              Run microphone check
            </Button>
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>OS permission status: {micPermissionStatus || "unknown"}</p>
            {lastMicReadinessMessage && <p>Last check: {lastMicReadinessMessage}</p>}
            {lastMicReadinessMetrics && (
              <p>
                Last levels: RMS {lastMicReadinessMetrics.rms.toFixed(4)}, peak {lastMicReadinessMetrics.peak.toFixed(4)}
              </p>
            )}
            {lastFailureCode && <p>Last failure code: {lastFailureCode}</p>}
          </div>
        </section>

        {/* Consultation capture */}
        <section className={CARD}>
          <CardHeading title="Consultation capture">
            Whether new consultations generate a clinical note, or are recorded and transcribed only (the study&apos;s
            control arm, where no AI note is produced or shown).
          </CardHeading>
          <div className="space-y-2">
            <Label htmlFor="encounter-mode" className="text-sm font-medium text-foreground">
              Capture mode
            </Label>
            <Select value={encounterMode} onValueChange={(value) => onEncounterModeChange(value as EncounterMode)}>
              <SelectTrigger id="encounter-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="scribed">Scribed: transcribe and generate a clinical note</SelectItem>
                <SelectItem value="recording_only">Recording only: transcribe and archive, no note</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Applies to new consultations straight away. In recording-only mode the interface turns green.
            </p>
          </div>
        </section>

        {/* Vocabulary */}
        <section className={CARD}>
          <KeytermEditor value={keytermsOverride} onChange={onKeytermsOverrideChange} />
        </section>

        {/* API keys (bring your own) */}
        <section className={CARD}>
          <CardHeading title="API keys">
            Bring-your-own-key accounts must provide a Deepgram key (transcription) and an Anthropic key (note
            generation). Keys are stored encrypted in this browser only and sent with each request; the server never
            saves them. Leave blank to use the server&apos;s keys, if your account allows it.
          </CardHeading>
          <div className="space-y-2">
            <Label htmlFor="byok-deepgram-key" className="text-sm font-medium text-foreground">
              Deepgram API key
            </Label>
            <input
              id="byok-deepgram-key"
              type="password"
              autoComplete="off"
              value={deepgramApiKey}
              onChange={(e) => setDeepgramApiKey(e.target.value)}
              placeholder="Deepgram key from console.deepgram.com"
              className={INPUT}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="byok-anthropic-key" className="text-sm font-medium text-foreground">
              Anthropic API key
            </Label>
            <input
              id="byok-anthropic-key"
              type="password"
              autoComplete="off"
              value={anthropicApiKey}
              onChange={(e) => setAnthropicApiKey(e.target.value)}
              placeholder="sk-ant-… from console.anthropic.com"
              className={INPUT}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {deepgramApiKey.trim() || anthropicApiKey.trim()
              ? "Using your keys for the fields provided; anything left blank falls back to the server's keys (if allowed). Saved by Save."
              : "No personal keys set: requests use the server's keys (not available on bring-your-own-key accounts)."}
          </p>
        </section>

        {/* Audit logs */}
        <section className={CARD}>
          <CardHeading title="Audit logs">View and export the audit log of every operation on this device.</CardHeading>
          <div className="space-y-2">
            <Label htmlFor="retention-days" className="text-sm font-medium text-foreground">
              Retention period
            </Label>
            <Select value={String(retentionDays)} onValueChange={(value) => setRetentionDays(Number(value))}>
              <SelectTrigger id="retention-days">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="90">90 days (recommended)</SelectItem>
                <SelectItem value="365">1 year</SelectItem>
                <SelectItem value="2555">7 years (HIPAA maximum)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Entries older than this are deleted automatically. Saved by Save.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setShowAuditViewer(true)} className="h-9 rounded-md">
              View audit log
            </Button>
            {confirmingPurge ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Delete every entry? This cannot be undone.</span>
                <Button size="sm" onClick={() => void handlePurgeAuditLogs()} className="h-8 rounded-md bg-destructive px-3 text-destructive-foreground hover:bg-destructive/90">
                  Purge
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmingPurge(false)} className="h-8 rounded-md px-2">
                  Keep
                </Button>
              </span>
            ) : (
              <Button
                variant="outline"
                onClick={() => setConfirmingPurge(true)}
                className="h-9 rounded-md text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                Purge all logs
              </Button>
            )}
          </div>
        </section>
      </div>

      {showAuditViewer && <AuditLogViewer onClose={() => setShowAuditViewer(false)} />}
    </>
  )
}
