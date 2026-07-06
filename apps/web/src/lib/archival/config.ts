/**
 * Resolve the consultation-archival storage backend from the environment.
 *
 * `STORAGE_BACKEND` selects the backend ("r2" or "box"); it defaults to "box"
 * so existing Box-only deployments behave exactly as before. Archiving is
 * opt-in and fail-safe: when the selected backend is not fully configured the
 * result is `{ enabled: false, reason }` and callers treat it as a graceful
 * no-op (the consultation flow never breaks on missing archival credentials).
 */

import { getBoxConfig } from "@/lib/box"
import { BoxStorageClient } from "./box-adapter"
import { R2Client } from "./r2/client"
import type { StorageClient } from "./types"

export type StorageBackend = "r2" | "box"

export type ArchivalConfigResult =
  | { enabled: true; backend: StorageBackend; client: StorageClient }
  | { enabled: false; reason: string }

function trimmed(value: string | undefined): string {
  return value?.trim() || ""
}

function resolveR2(env: Record<string, string | undefined>): ArchivalConfigResult {
  const accountId = trimmed(env.R2_ACCOUNT_ID)
  const accessKeyId = trimmed(env.R2_ACCESS_KEY_ID)
  const secretAccessKey = trimmed(env.R2_SECRET_ACCESS_KEY)
  const bucket = trimmed(env.R2_BUCKET)

  const missing = [
    ["R2_ACCOUNT_ID", accountId],
    ["R2_ACCESS_KEY_ID", accessKeyId],
    ["R2_SECRET_ACCESS_KEY", secretAccessKey],
    ["R2_BUCKET", bucket],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k)

  if (missing.length > 0) {
    return { enabled: false, reason: `R2 config incomplete — missing ${missing.join(", ")}` }
  }

  return {
    enabled: true,
    backend: "r2",
    client: new R2Client({ accountId, accessKeyId, secretAccessKey, bucket }),
  }
}

function resolveBox(env: Record<string, string | undefined>): ArchivalConfigResult {
  const box = getBoxConfig(env)
  if (!box.enabled) {
    return { enabled: false, reason: box.reason }
  }
  return {
    enabled: true,
    backend: "box",
    client: new BoxStorageClient(box.config, box.config.folderId),
  }
}

export function getArchivalConfig(
  env: Record<string, string | undefined> = process.env,
): ArchivalConfigResult {
  const backend = (trimmed(env.STORAGE_BACKEND) || "box").toLowerCase()
  switch (backend) {
    case "r2":
      return resolveR2(env)
    case "box":
      return resolveBox(env)
    default:
      return { enabled: false, reason: `Unknown STORAGE_BACKEND "${backend}" (expected "r2" or "box")` }
  }
}

/** Cheap check used by the transcription routes to decide whether to archive. */
export function isArchivingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getArchivalConfig(env).enabled
}
