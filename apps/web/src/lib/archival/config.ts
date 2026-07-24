/**
 * Resolve the consultation-archival storage configuration from the environment.
 *
 * Box is the storage backend. Archiving is opt-in and fail-safe: when Box is
 * not fully configured the result is `{ enabled: false, reason }` and callers
 * treat it as a graceful no-op (the consultation flow never breaks on missing
 * archival credentials).
 */

import type { SessionRole } from "@/lib/auth"
import { getBoxConfig } from "@/lib/box"
import { BoxStorageClient } from "./box-adapter"
import type { StorageClient } from "./types"

export type ArchivalConfigResult =
  | { enabled: true; backend: "box"; client: StorageClient }
  | { enabled: false; reason: string }

/**
 * BYOK sessions archive into their own Box folder (BOX_FOLDER_ID_BYOK) so
 * tester consultations stay separate from the study's. Falls back to the main
 * folder when the BYOK folder is unconfigured — a misfiled container can be
 * moved later, an unarchived one is gone.
 */
export function getArchivalConfig(
  role: SessionRole = "full",
  env: Record<string, string | undefined> = process.env,
): ArchivalConfigResult {
  const box = getBoxConfig(env)
  if (!box.enabled) {
    return { enabled: false, reason: box.reason }
  }
  const byokFolderId = (env.BOX_FOLDER_ID_BYOK ?? "").trim()
  const folderId = role === "byok" && byokFolderId ? byokFolderId : box.config.folderId
  return {
    enabled: true,
    backend: "box",
    client: new BoxStorageClient(box.config, folderId),
  }
}

/** Cheap check used by the transcription routes to decide whether to archive. */
export function isArchivingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getArchivalConfig("full", env).enabled
}
