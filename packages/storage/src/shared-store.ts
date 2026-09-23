/**
 * Browser side of the shared consultation store (/api/consultations).
 *
 * Consultations, recall sessions and recordings used to live only in the
 * browser that made them. When the server has a shared store configured,
 * they are read from and written to it instead, so every browser logged in
 * with the same password sees the same consultations. When it has none (local
 * development), every call here reports that, and callers keep the local store.
 *
 * The encrypted local copy stays as a mirror: it is what the app shows when
 * the server cannot be reached, and a write the server did not take is queued
 * in it and handed over on the next load.
 */

import type { Encounter } from "./types"
import { loadSecureItem } from "./secure-storage"

const API = "/api/consultations"

/** Set once this browser's pre-existing local consultations were handed to the store. */
const MIGRATED_FLAG = "openscribe_shared_store_migrated"
/** Consultation ids whose latest local write the store has not taken yet. */
const DIRTY_KEY = "openscribe_shared_store_dirty"
/** Consultation ids deleted locally whose delete the store has not taken yet. */
const DELETED_KEY = "openscribe_shared_store_deleted"
/** Encounter ids whose recall session the store has not taken yet. */
const DIRTY_RECALL_KEY = "openscribe_shared_store_dirty_recall"

export const RECALL_STORAGE_PREFIX = "openscribe_recall_"

export type SharedStoreResult<T> =
  | { status: "ok"; value: T }
  /** The server has no shared store: use the local one. */
  | { status: "unconfigured" }
  /** The store exists but this request failed (offline, server error). */
  | { status: "error"; error: string }

function inBrowser(): boolean {
  return typeof window !== "undefined" && typeof fetch !== "undefined"
}

async function request<T>(path: string, init?: RequestInit): Promise<SharedStoreResult<T>> {
  if (!inBrowser()) return { status: "unconfigured" }
  try {
    const res = await fetch(`${API}${path}`, {
      cache: "no-store",
      ...init,
      headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
      if (res.status === 503 && body?.error?.code === "store_unconfigured") return { status: "unconfigured" }
      return { status: "error", error: body?.error?.message || `${res.status} ${res.statusText}` }
    }
    return { status: "ok", value: (await res.json()) as T }
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) }
  }
}

// ── Small id sets kept in localStorage ────────────────────────────────────────

function readIdSet(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function writeIdSet(key: string, ids: Set<string>): void {
  try {
    if (ids.size === 0) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify([...ids]))
  } catch {
    // Storage full or blocked: the next successful write catches up anyway.
  }
}

function markId(key: string, id: string, pending: boolean): void {
  if (!inBrowser()) return
  const ids = readIdSet(key)
  if (pending) ids.add(id)
  else ids.delete(id)
  writeIdSet(key, ids)
}

// ── Consultations ─────────────────────────────────────────────────────────────

export function fetchSharedEncounters(): Promise<SharedStoreResult<{ encounters: Encounter[] }>> {
  return request(``)
}

/** Save one consultation; a failure is queued and retried on the next load. */
export async function putSharedEncounter(encounter: Encounter): Promise<SharedStoreResult<unknown>> {
  const { audio_blob: _audio, ...body } = encounter
  const result = await request(`/${encodeURIComponent(encounter.id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  })
  if (result.status !== "unconfigured") markId(DIRTY_KEY, encounter.id, result.status === "error")
  return result
}

export async function deleteSharedEncounter(id: string): Promise<SharedStoreResult<unknown>> {
  const result = await request(`/${encodeURIComponent(id)}`, { method: "DELETE" })
  if (result.status !== "unconfigured") markId(DELETED_KEY, id, result.status === "error")
  markId(DIRTY_KEY, id, false)
  return result
}

function localRecallKeys(): string[] {
  const keys: string[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key?.startsWith(RECALL_STORAGE_PREFIX)) keys.push(key)
  }
  return keys
}

async function importToStore(
  encounters: Encounter[],
  recallSessions: Record<string, unknown>,
): Promise<boolean> {
  if (encounters.length === 0 && Object.keys(recallSessions).length === 0) return true
  const result = await request(``, {
    method: "POST",
    body: JSON.stringify({
      encounters: encounters.map(({ audio_blob: _audio, ...rest }) => rest),
      recall_sessions: recallSessions,
    }),
  })
  return result.status === "ok"
}

/**
 * Hand over what only this browser holds: on its first load against the
 * store, every local consultation and recall session; afterwards, writes and
 * deletes the store missed. Returns whether anything was sent, so the caller
 * knows to re-read. Leaves the local copy untouched when a hand-over fails.
 */
export async function reconcileWithStore(localEncounters: Encounter[]): Promise<{ sent: boolean; ok: boolean }> {
  let sent = false

  if (window.localStorage.getItem(MIGRATED_FLAG) !== "1") {
    const recallSessions: Record<string, unknown> = {}
    for (const key of localRecallKeys()) {
      const session = await loadSecureItem<unknown>(key).catch(() => null)
      if (session) recallSessions[key.slice(RECALL_STORAGE_PREFIX.length)] = session
    }
    if (!(await importToStore(localEncounters, recallSessions))) return { sent, ok: false }
    window.localStorage.setItem(MIGRATED_FLAG, "1")
    sent = localEncounters.length > 0 || Object.keys(recallSessions).length > 0
  }

  const dirty = readIdSet(DIRTY_KEY)
  if (dirty.size > 0) {
    const pending = localEncounters.filter((encounter) => dirty.has(encounter.id))
    if (!(await importToStore(pending, {}))) return { sent, ok: false }
    writeIdSet(DIRTY_KEY, new Set())
    sent = sent || pending.length > 0
  }

  for (const id of readIdSet(DELETED_KEY)) {
    if ((await deleteSharedEncounter(id)).status === "error") return { sent, ok: false }
    sent = true
  }

  for (const encounterId of readIdSet(DIRTY_RECALL_KEY)) {
    const session = await loadSecureItem<unknown>(`${RECALL_STORAGE_PREFIX}${encounterId}`).catch(() => null)
    if (session && (await putSharedRecallSession(encounterId, session)).status === "error") {
      return { sent, ok: false }
    }
    markId(DIRTY_RECALL_KEY, encounterId, false)
  }

  return { sent, ok: true }
}

// ── Recall sessions ───────────────────────────────────────────────────────────

export function fetchSharedRecallSession(encounterId: string): Promise<SharedStoreResult<{ session: unknown }>> {
  return request(`/${encodeURIComponent(encounterId)}/recall`)
}

/** Save a recall session; `keepalive` lets the save outlive a closing page. */
export async function putSharedRecallSession(encounterId: string, session: unknown): Promise<SharedStoreResult<unknown>> {
  const result = await request(`/${encodeURIComponent(encounterId)}/recall`, {
    method: "PUT",
    body: JSON.stringify(session),
    keepalive: true,
  })
  if (result.status !== "unconfigured") markId(DIRTY_RECALL_KEY, encounterId, result.status === "error")
  return result
}

export function recallSessionUnsynced(encounterId: string): boolean {
  return inBrowser() && readIdSet(DIRTY_RECALL_KEY).has(encounterId)
}

// ── Recordings ────────────────────────────────────────────────────────────────

const remoteAudio = new Map<string, Promise<Blob | null>>()

/**
 * A recording from the archive, for a browser that did not record it. Keys
 * are the audio store's: `<encounterId>` or `recall:<encounterId>`. Each key
 * is fetched at most once per page (a miss included), so callers that poll
 * the local store do not hammer the archive.
 */
export function fetchArchivedAudio(key: string): Promise<Blob | null> {
  if (!inBrowser()) return Promise.resolve(null)
  let pending = remoteAudio.get(key)
  if (!pending) {
    const recall = key.startsWith("recall:")
    const encounterId = recall ? key.slice("recall:".length) : key
    pending = fetch(`${API}/${encodeURIComponent(encounterId)}/audio${recall ? "?kind=recall" : ""}`)
      .then((res) => (res.ok ? res.blob() : null))
      .catch(() => null)
    remoteAudio.set(key, pending)
  }
  return pending
}

// ── Recovery ──────────────────────────────────────────────────────────────────

export interface ArchiveRecoverySummary {
  consultations: { inserted: number; updated: number; skipped: number }
  recall_sessions: { inserted: number; updated: number; skipped: number }
  failed: Array<{ folder: string; error: string }>
}

/** Rebuild consultations the store does not have yet from the Box archive. */
export function recoverConsultationsFromArchive(): Promise<SharedStoreResult<ArchiveRecoverySummary>> {
  return request(`/recover`, { method: "POST" })
}
