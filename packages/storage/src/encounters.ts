import type { Encounter, NoteVersion, NoteVersionSource } from "./types"
import { loadSecureItem, saveSecureItem } from "./secure-storage"

const STORAGE_KEY = "openscribe_encounters"

export function generateId(): string {
  return crypto.randomUUID()
}

export async function getEncounters(): Promise<Encounter[]> {
  if (typeof window === "undefined") return []
  const encounters = await loadSecureItem<Encounter[]>(STORAGE_KEY)
  if (!encounters) return []
  return encounters
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
 * Whether the consultation is tied to a patient record. An empty patient_id
 * is the one representation of "no patient", so every consumer (lists, the
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
