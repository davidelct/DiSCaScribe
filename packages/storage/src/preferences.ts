/**
 * User preferences storage
 * Uses localStorage for simple key-value preferences
 */

import { writeAuditEntry } from "./audit-log"
import type { EncounterMode } from "./types"

export interface UserPreferences {
  preferredInputDeviceId?: string
  /** Capture mode applied to new encounters (study arm selector). */
  encounterMode?: EncounterMode
  /**
   * Keyterm vocabulary override. Absent means "use the committed default list"
   * — the shared baseline every consultation gets — so the two are
   * distinguishable from an explicit empty list, which means "send none".
   * Kept global rather than per-consultation for the same reason encounterMode
   * is: the vocabulary must not vary between recordings being compared.
   */
  keytermsOverride?: string[]
  /**
   * Record the microphone as-is, without the browser's echo cancellation,
   * noise suppression and automatic gain. Off by default: that processing is
   * what every earlier recording had. Global for the same reason as the
   * others: recordings being compared must not differ in capture settings
   * without it being deliberate, and metadata.json records which was used.
   */
  rawMicrophone?: boolean
}

const PREFERENCES_KEY = "openscribe_preferences"

const DEFAULT_PREFERENCES: UserPreferences = {
  preferredInputDeviceId: "",
  encounterMode: "scribed",
}

export function getPreferences(): UserPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_PREFERENCES
  }

  try {
    const stored = window.localStorage.getItem(PREFERENCES_KEY)
    if (!stored) {
      return DEFAULT_PREFERENCES
    }
    const parsed = JSON.parse(stored) as Partial<UserPreferences>
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export async function setPreferences(preferences: Partial<UserPreferences>): Promise<void> {
  if (typeof window === "undefined") {
    return
  }

  try {
    const current = getPreferences()
    const updated = {
      ...current,
      ...preferences,
    }
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(updated))

    // Audit log: preferences updated
    await writeAuditEntry({
      event_type: "settings.preferences_updated",
      success: true,
      metadata: {
        fields_updated: Object.keys(preferences),
      },
    })
  } catch (error) {
    console.error("Failed to save preferences:", error)

    // Audit log: preferences update failed
    await writeAuditEntry({
      event_type: "settings.preferences_updated",
      success: false,
      error_message: error instanceof Error ? error.message : String(error),
    })

    throw error
  }
}
