import type { Encounter, NoteVersion, NoteVersionSource } from "./types"
import { loadSecureItem, saveSecureItem } from "./secure-storage"
import { debugWarn } from "./debug-logger"
import {
  deleteSharedEncounter,
  fetchSharedEncounters,
  putSharedEncounter,
  reconcileWithStore,
} from "./shared-store"

/** The local copy: the whole store without a shared one, a mirror of it otherwise. */
const STORAGE_KEY = "openscribe_encounters"

export function generateId(): string {
  return crypto.randomUUID()
}

async function getLocalEncounters(): Promise<Encounter[]> {
  return (await loadSecureItem<Encounter[]>(STORAGE_KEY)) ?? []
}

/** Newest copy of each consultation across two lists, newest consultation first. */
function mergeNewest(primary: Encounter[], secondary: Encounter[]): Encounter[] {
  const byId = new Map(primary.map((encounter) => [encounter.id, encounter]))
  for (const encounter of secondary) {
    const current = byId.get(encounter.id)
    if (!current || current.updated_at < encounter.updated_at) byId.set(encounter.id, encounter)
  }
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/**
 * Every consultation: from the shared store when the server has one (after
 * handing it anything only this browser holds), else from the local store.
 * When the shared store cannot be reached, the local mirror stands in.
 */
export async function getEncounters(): Promise<Encounter[]> {
  if (typeof window === "undefined") return []
  const local = await getLocalEncounters()
  const shared = await fetchSharedEncounters()
  if (shared.status === "unconfigured") return local
  if (shared.status === "error") {
    debugWarn("Shared consultation store unreachable; showing this browser's copy", shared.error)
    return local
  }

  const reconciled = await reconcileWithStore(local)
  if (!reconciled.ok) {
    // Keep the local copy intact until the hand-over succeeds.
    return mergeNewest(shared.value.encounters, local)
  }
  let encounters = shared.value.encounters
  if (reconciled.sent) {
    const again = await fetchSharedEncounters()
    if (again.status === "ok") encounters = again.value.encounters
  }
  await saveEncounters(encounters)
  return encounters
}

/** Save one consultation: `all` is the full list with it already applied. */
export async function persistEncounter(all: Encounter[], encounter: Encounter): Promise<void> {
  await saveEncounters(all)
  await putSharedEncounter(encounter)
}

/** Delete one consultation: `all` is the full list without it. */
export async function removePersistedEncounter(all: Encounter[], id: string): Promise<void> {
  await saveEncounters(all)
  await deleteSharedEncounter(id)
}

export async function saveEncounters(encounters: Encounter[]): Promise<void> {
  if (typeof window === "undefined") return
  // Remove audio blobs before saving (can't serialize Blob to JSON)
  const sanitized = encounters.map((e) => ({ ...e, audio_blob: undefined }))
  await saveSecureItem(STORAGE_KEY, sanitized)
}

export function createEncounter(data: Partial<Encounter>): Encounter {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    patient_name: data.patient_name || "",
    patient_id: data.patient_id || "",
    visit_reason: data.visit_reason || "",
    session_id: data.session_id,
    created_at: now,
    updated_at: now,
    transcript_text: "",
    note_text: "",
    status: "idle",
    language: "en",
    ...data,
  }
}

export function updateEncounter(encounters: Encounter[], id: string, updates: Partial<Encounter>): Encounter[] {
  return encounters.map((e) => (e.id === id ? { ...e, ...updates, updated_at: new Date().toISOString() } : e))
}

export function deleteEncounter(encounters: Encounter[], id: string): Encounter[] {
  return encounters.filter((e) => e.id !== id)
}

/**
 * Whether the consultation's patient is on the register. An empty patient_id
 * is the one representation of "unregistered", so every consumer (lists, the
 * workspace's back link, the note header) agrees on it.
 */
export function isLinkedToPatient(encounter: Pick<Encounter, "patient_id">): boolean {
  return encounter.patient_id.trim().length > 0
}

/**
 * The encounter's note trail. Encounters saved before note_versions existed
 * carry only note_text/note_version; reconstruct a single-entry trail from
 * those so the first new save extends it rather than losing history.
 */
export function noteVersionsOf(encounter: Encounter): NoteVersion[] {
  if (encounter.note_versions?.length) return encounter.note_versions
  if (!encounter.note_text?.trim()) return []
  return [
    {
      version: encounter.note_version ?? 0,
      source: (encounter.note_version ?? 0) > 0 ? "edited" : "generated",
      note_text: encounter.note_text,
      created_at: encounter.updated_at,
    },
  ]
}

/**
 * Build the encounter updates that record `noteText` as the next version in
 * the trail. Keeps note_text/note_version pointing at the newest version so
 * every existing consumer (rendering, export, archival) is unaffected.
 */
export function appendNoteVersion(
  encounter: Encounter,
  source: NoteVersionSource,
  noteText: string,
): Partial<Encounter> {
  const versions = noteVersionsOf(encounter)
  const nextNumber = versions.length ? versions[versions.length - 1].version + 1 : 0
  const entry: NoteVersion = {
    version: nextNumber,
    source,
    note_text: noteText,
    created_at: new Date().toISOString(),
  }
  return {
    note_versions: [...versions, entry],
    note_text: noteText,
    note_version: nextNumber,
    note_archive_status: "pending",
  }
}
