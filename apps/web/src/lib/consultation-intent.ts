/**
 * Hand-off between the chart's start-consultation dialog and the consultation
 * workspace: the dialog chooses how the consultation launches (record now, or
 * transcribe an uploaded file) and the workspace dispatches it on mount.
 *
 * Module memory carries the intent across a client-side navigation, but that
 * is not the only path between the two pages. When a deployment lands between
 * them, Next falls back to a full page load and module state is gone; the
 * workspace then showed its ready panel and the clinician had to upload again.
 * So the intent is also written to sessionStorage (this tab, survives a full
 * load) and an upload's file to the encounter's audio store, where the
 * workspace keeps the local playback copy anyway. Every store is read-and-
 * clear, so an intent never fires twice.
 */

import { debugWarn, getEncounterAudio, saveEncounterAudio } from "@storage"

export type ConsultationIntent = { action: "record" } | { action: "upload"; file: File }

/** What sessionStorage holds: the file itself lives in the audio store. */
type StoredIntent = { action: "record" } | { action: "upload"; fileName: string; fileType: string }

const intents = new Map<string, ConsultationIntent>()

function storageKey(encounterId: string): string {
  return `openscribe_intent_${encounterId}`
}

function readStored(encounterId: string): StoredIntent | undefined {
  try {
    const raw = window.sessionStorage.getItem(storageKey(encounterId))
    return raw ? (JSON.parse(raw) as StoredIntent) : undefined
  } catch {
    return undefined
  }
}

function writeStored(encounterId: string, intent: StoredIntent): void {
  try {
    window.sessionStorage.setItem(storageKey(encounterId), JSON.stringify(intent))
  } catch (error) {
    debugWarn("Could not persist the consultation intent for this tab", error)
  }
}

function clearStored(encounterId: string): void {
  try {
    window.sessionStorage.removeItem(storageKey(encounterId))
  } catch {
    // Nothing to clear.
  }
}

/**
 * Stash the intent for the workspace. An upload's file is persisted first,
 * so the intent is only written down once the file it points at exists; if
 * that fails, module memory still carries it across a client-side navigation.
 */
export async function setConsultationIntent(encounterId: string, intent: ConsultationIntent): Promise<void> {
  intents.set(encounterId, intent)
  if (intent.action === "record") {
    writeStored(encounterId, { action: "record" })
    return
  }
  try {
    await saveEncounterAudio(encounterId, intent.file)
  } catch (error) {
    debugWarn("Could not persist the uploaded file for the workspace", error)
    return
  }
  writeStored(encounterId, { action: "upload", fileName: intent.file.name, fileType: intent.file.type })
}

/**
 * Whether an intent is waiting for this encounter, and which. Synchronous,
 * so the workspace can hold its ready panel back while the file loads.
 */
export function peekConsultationIntent(encounterId: string): ConsultationIntent["action"] | undefined {
  return intents.get(encounterId)?.action ?? readStored(encounterId)?.action
}

/**
 * Read-and-clear, so an intent can never fire twice. Module memory wins when
 * it has the intent (it holds the File as picked); after a full page load
 * the persisted copy is used and the file comes back from the audio store.
 */
export async function takeConsultationIntent(encounterId: string): Promise<ConsultationIntent | undefined> {
  const inMemory = intents.get(encounterId)
  intents.delete(encounterId)
  const stored = readStored(encounterId)
  clearStored(encounterId)

  if (inMemory) return inMemory
  if (!stored) return undefined
  if (stored.action === "record") return stored

  const blob = await getEncounterAudio(encounterId)
  if (!blob) return undefined
  return {
    action: "upload",
    file: new File([blob], stored.fileName || "recording", { type: stored.fileType || blob.type }),
  }
}
