/**
 * Consultation and stimulated-recall rows in the shared store.
 *
 * Each row holds the client's Encounter (or RecallSession) as JSON, so the
 * browser keeps its existing data model and the store needs no change when a
 * field is added. Rows are partitioned by scope, the same split Box archival
 * makes: the study's sessions never see BYOK testers' consultations and vice
 * versa.
 */

import type { Encounter } from "@storage/types"
import type { SessionRole } from "@/lib/auth"
import { getSql } from "./db"

export type StoreScope = "study" | "byok"
export type RowSource = "browser" | "box"

export function scopeForRole(role: SessionRole): StoreScope {
  return role === "byok" ? "byok" : "study"
}

/** Blobs cannot be stored as JSON; audio lives in Box (see the audio route). */
function storable(encounter: Encounter): Encounter {
  const { audio_blob: _audio, ...rest } = encounter
  return rest as Encounter
}

function timestamp(value: string | undefined, fallback: Date): Date {
  const parsed = value ? new Date(value) : null
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback
}

export async function listConsultations(scope: StoreScope): Promise<Encounter[]> {
  const sql = await getSql()
  const rows = await sql<{ data: Encounter }[]>`
    select data from consultations
    where scope = ${scope} and deleted_at is null
    order by created_at desc
  `
  return rows.map((row) => row.data)
}

export async function getConsultation(scope: StoreScope, id: string): Promise<Encounter | null> {
  const sql = await getSql()
  const rows = await sql<{ data: Encounter }[]>`
    select data from consultations where scope = ${scope} and id = ${id} and deleted_at is null
  `
  return rows[0]?.data ?? null
}

/** Write the app's current copy of a consultation (create or replace). */
export async function putConsultation(scope: StoreScope, encounter: Encounter): Promise<void> {
  const sql = await getSql()
  const now = new Date()
  const data = storable(encounter)
  await sql`
    insert into consultations (id, scope, data, created_at, updated_at, deleted_at, source)
    values (${encounter.id}, ${scope}, ${sql.json(data as never)}, ${timestamp(encounter.created_at, now)},
            ${timestamp(encounter.updated_at, now)}, null, 'browser')
    on conflict (scope, id) do update
      set data = excluded.data, updated_at = excluded.updated_at, deleted_at = null, source = 'browser'
  `
}

export async function deleteConsultation(scope: StoreScope, id: string): Promise<void> {
  const sql = await getSql()
  await sql`update consultations set deleted_at = now() where scope = ${scope} and id = ${id}`
}

export interface ImportCounts {
  inserted: number
  updated: number
  skipped: number
}

/**
 * Bring in consultations from elsewhere without clobbering newer work:
 * - from a browser: insert when absent; replace a Box reconstruction, or an
 *   older browser copy (by updated_at);
 * - from Box: insert only when absent.
 * A consultation deleted in the shared store stays deleted either way.
 */
export async function importConsultations(
  scope: StoreScope,
  encounters: Encounter[],
  source: RowSource,
): Promise<ImportCounts> {
  const sql = await getSql()
  const counts: ImportCounts = { inserted: 0, updated: 0, skipped: 0 }
  const now = new Date()
  for (const encounter of encounters) {
    if (!encounter?.id) {
      counts.skipped += 1
      continue
    }
    const data = storable(encounter)
    const updatedAt = timestamp(encounter.updated_at, now)
    const rows = await sql<{ inserted: boolean }[]>`
      insert into consultations (id, scope, data, created_at, updated_at, source)
      values (${encounter.id}, ${scope}, ${sql.json(data as never)}, ${timestamp(encounter.created_at, now)},
              ${updatedAt}, ${source})
      on conflict (scope, id) do update
        set data = excluded.data, updated_at = excluded.updated_at, source = excluded.source
        where ${source} = 'browser'
          and consultations.deleted_at is null
          and (consultations.source = 'box' or consultations.updated_at < excluded.updated_at)
      returning (xmax = 0) as inserted
    `
    if (rows.length === 0) counts.skipped += 1
    else if (rows[0].inserted) counts.inserted += 1
    else counts.updated += 1
  }
  return counts
}

export async function getRecallSession(scope: StoreScope, encounterId: string): Promise<unknown | null> {
  const sql = await getSql()
  const rows = await sql<{ data: unknown }[]>`
    select data from recall_sessions where scope = ${scope} and encounter_id = ${encounterId}
  `
  return rows[0]?.data ?? null
}

export async function putRecallSession(scope: StoreScope, encounterId: string, session: unknown): Promise<void> {
  const sql = await getSql()
  await sql`
    insert into recall_sessions (encounter_id, scope, data, updated_at, source)
    values (${encounterId}, ${scope}, ${sql.json(session as never)}, now(), 'browser')
    on conflict (scope, encounter_id) do update
      set data = excluded.data, updated_at = now(), source = 'browser'
  `
}

/**
 * Import recall sessions; the same precedence as importConsultations, except
 * that sessions carry no timestamp, so an existing browser copy always wins.
 */
export async function importRecallSessions(
  scope: StoreScope,
  sessions: Record<string, unknown>,
  source: RowSource,
): Promise<ImportCounts> {
  const sql = await getSql()
  const counts: ImportCounts = { inserted: 0, updated: 0, skipped: 0 }
  for (const [encounterId, session] of Object.entries(sessions)) {
    if (!encounterId || session === null || typeof session !== "object") {
      counts.skipped += 1
      continue
    }
    const rows = await sql<{ inserted: boolean }[]>`
      insert into recall_sessions (encounter_id, scope, data, updated_at, source)
      values (${encounterId}, ${scope}, ${sql.json(session as never)}, now(), ${source})
      on conflict (scope, encounter_id) do update
        set data = excluded.data, updated_at = now(), source = excluded.source
        where ${source} = 'browser' and recall_sessions.source = 'box'
      returning (xmax = 0) as inserted
    `
    if (rows.length === 0) counts.skipped += 1
    else if (rows[0].inserted) counts.inserted += 1
    else counts.updated += 1
  }
  return counts
}

/** Every consultation id the store knows in this scope, deleted ones included. */
export async function knownConsultationIds(scope: StoreScope): Promise<Set<string>> {
  const sql = await getSql()
  const rows = await sql<{ id: string }[]>`select id from consultations where scope = ${scope}`
  return new Set(rows.map((row) => row.id))
}
