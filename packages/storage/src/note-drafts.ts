/**
 * The unfiled note in the recording-only arm, kept as the clinician types.
 * That arm's note is a form, as in any EHR: there is no Save, only Approve &
 * file, so until filing the text lives here, in this browser (encrypted like
 * the rest of the local store), and survives a reload mid-consultation.
 * Filing records it in the note trail; the draft is then cleared.
 */

import { loadSecureItem, saveSecureItem } from "./secure-storage"
import { debugWarn } from "./debug-logger"

const NOTE_DRAFT_PREFIX = "openscribe_note_draft_"

export interface NoteDraft {
  /** SOAP markdown, in the shape the note trail stores. */
  note_text: string
  /** ISO 8601 timestamp of the save. */
  saved_at: string
}

export async function loadNoteDraft(encounterId: string): Promise<NoteDraft | null> {
  try {
    return await loadSecureItem<NoteDraft>(NOTE_DRAFT_PREFIX + encounterId)
  } catch (error) {
    debugWarn("Could not read the note draft", error)
    return null
  }
}

/** Store the draft; resolves to it, or null when it could not be written. */
export async function saveNoteDraft(encounterId: string, noteText: string): Promise<NoteDraft | null> {
  const draft: NoteDraft = { note_text: noteText, saved_at: new Date().toISOString() }
  try {
    await saveSecureItem(NOTE_DRAFT_PREFIX + encounterId, draft)
    return draft
  } catch (error) {
    debugWarn("Could not save the note draft", error)
    return null
  }
}

export function clearNoteDraft(encounterId: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(NOTE_DRAFT_PREFIX + encounterId)
  } catch {
    // Nothing to clear.
  }
}
