/**
 * Resolve the consultation-archival storage configuration from the environment.
 *
 * Box is the storage backend. Archiving is opt-in and fail-safe: when Box is
 * not fully configured the result is `{ enabled: false, reason }` and callers
 * treat it as a graceful no-op (the consultation flow never breaks on missing
 * archival credentials).
 */

import { getBoxConfig } from "@/lib/box"
import { BoxStorageClient } from "./box-adapter"
import type { StorageClient } from "./types"

export type ArchivalConfigResult =
  | { enabled: true; backend: "box"; client: StorageClient }
  | { enabled: false; reason: string }

export function getArchivalConfig(
  env: Record<string, string | undefined> = process.env,
): ArchivalConfigResult {
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

/** Cheap check used by the transcription routes to decide whether to archive. */
export function isArchivingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getArchivalConfig(env).enabled
}
