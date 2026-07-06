/**
 * Per-encounter recording storage, backed by IndexedDB.
 *
 * The encounter list itself lives in encrypted localStorage and deliberately
 * strips audio before saving (Blobs can't be JSON-serialised, and we don't want
 * audio in that store). Recordings instead go here, in a separate IndexedDB
 * store that preserves Blobs via structured clone, keyed by encounter id — so a
 * clinician can reopen any past consultation and listen back.
 *
 * We persist the compressed MP3 (the same artifact produced for upload, ~a few
 * MB per consult) rather than the raw WAV. Every operation is a graceful no-op
 * when IndexedDB is unavailable (SSR, tests), mirroring saveEncounters().
 */

const DB_NAME = "discascribe-audio"
const STORE_NAME = "recordings"
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null)
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

/** Store (or replace) the recording for an encounter. Best-effort. */
export async function saveEncounterAudio(encounterId: string, blob: Blob): Promise<void> {
  if (!encounterId) return
  const db = await openDb()
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      tx.objectStore(STORE_NAME).put(blob, encounterId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } finally {
    db.close()
  }
}

/** Load an encounter's recording, or null if none is stored. */
export async function getEncounterAudio(encounterId: string): Promise<Blob | null> {
  if (!encounterId) return null
  const db = await openDb()
  if (!db) return null
  try {
    return await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly")
      const request = tx.objectStore(STORE_NAME).get(encounterId)
      request.onsuccess = () => {
        const result = request.result
        resolve(result instanceof Blob ? result : null)
      }
      request.onerror = () => resolve(null)
    })
  } finally {
    db.close()
  }
}

/** Delete an encounter's recording (call when the encounter is deleted). */
export async function deleteEncounterAudio(encounterId: string): Promise<void> {
  if (!encounterId) return
  const db = await openDb()
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      tx.objectStore(STORE_NAME).delete(encounterId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } finally {
    db.close()
  }
}
