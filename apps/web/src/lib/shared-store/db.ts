/**
 * Postgres connection for the shared consultation store (server-side only).
 *
 * Consultations used to live only in each browser's encrypted localStorage,
 * so a clinician who logged in from a second laptop saw none of them. They now
 * live here, shared by every browser that logs in with the same password.
 *
 * The store is opt-in like Box archival: without DATABASE_URL (or the
 * POSTGRES_URL a Vercel/Neon integration sets) it is "unconfigured", the API
 * says so, and the browser keeps using its local store. The schema is created
 * on first use, so a fresh database needs no migration step.
 *
 * `source` records where a row came from: "browser" (written by the app) or
 * "box" (rebuilt from the Box archive). A browser's own copy always beats a
 * Box reconstruction, which lacks the recall exchanges and note provenance.
 */

import postgres from "postgres"

export type Sql = postgres.Sql

let client: Sql | null = null
let schemaReady: Promise<void> | null = null

export function databaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.DATABASE_URL ?? env.POSTGRES_URL ?? "").trim()
}

export function isSharedStoreConfigured(): boolean {
  return databaseUrl().length > 0
}

async function ensureSchema(sql: Sql): Promise<void> {
  await sql`
    create table if not exists consultations (
      id text not null,
      scope text not null,
      data jsonb not null,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      deleted_at timestamptz,
      source text not null default 'browser',
      primary key (scope, id)
    )
  `
  await sql`
    create table if not exists recall_sessions (
      encounter_id text not null,
      scope text not null,
      data jsonb not null,
      updated_at timestamptz not null default now(),
      source text not null default 'browser',
      primary key (scope, encounter_id)
    )
  `
}

/** The connection, with the schema in place. Throws when unconfigured. */
export async function getSql(): Promise<Sql> {
  if (!client) {
    const url = databaseUrl()
    if (!url) throw new Error("DATABASE_URL is not set")
    // prepare: false keeps the connection usable through a transaction-mode
    // pooler (Neon's pooled URL); max 1 suits one serverless invocation.
    client = postgres(url, { prepare: false, max: 1, idle_timeout: 20, onnotice: () => undefined })
  }
  if (!schemaReady) {
    schemaReady = ensureSchema(client).catch((error) => {
      schemaReady = null
      throw error
    })
  }
  await schemaReady
  return client
}
