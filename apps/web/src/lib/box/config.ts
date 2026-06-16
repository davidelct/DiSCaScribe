/**
 * Box archival configuration.
 *
 * Reads Box settings from the server environment. Archiving is opt-in: when it
 * is not fully configured the app behaves exactly as before (consultations are
 * simply not pushed to Box), so the absence of Box credentials is never an
 * error — callers treat a disabled config as a graceful no-op.
 *
 * Two auth modes are supported:
 *  - Client Credentials Grant (CCG): a service account, recommended for
 *    production. Acts as the App User when the subject is the enterprise.
 *  - Developer token: a short-lived (~60 min) token, handy for local testing.
 */

export type BoxAuth =
  | { type: "token"; token: string }
  | {
      type: "ccg"
      clientId: string
      clientSecret: string
      subjectId: string
      subjectType: "enterprise" | "user"
    }

export interface BoxConfig {
  /** Destination folder ID (the number in the Box folder URL). */
  folderId: string
  auth: BoxAuth
}

export type BoxConfigResult =
  | { enabled: true; config: BoxConfig }
  | { enabled: false; reason: string }

function isTruthy(value: string | undefined): boolean {
  if (!value) return false
  const v = value.trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes" || v === "on"
}

function trimmed(value: string | undefined): string {
  return value?.trim() || ""
}

/**
 * Resolve Box archival configuration from the environment. Returns a disabled
 * result with a human-readable reason when archiving is off or incompletely
 * configured.
 */
export function getBoxConfig(env: Record<string, string | undefined> = process.env): BoxConfigResult {
  if (!isTruthy(env.BOX_ENABLED)) {
    return { enabled: false, reason: "BOX_ENABLED is not set to true" }
  }

  const folderId = trimmed(env.BOX_FOLDER_ID)
  if (!folderId) {
    return { enabled: false, reason: "BOX_FOLDER_ID is missing" }
  }

  const token = trimmed(env.BOX_DEVELOPER_TOKEN)
  if (token) {
    return { enabled: true, config: { folderId, auth: { type: "token", token } } }
  }

  const clientId = trimmed(env.BOX_CLIENT_ID)
  const clientSecret = trimmed(env.BOX_CLIENT_SECRET)
  const subjectId = trimmed(env.BOX_SUBJECT_ID)
  const subjectType = trimmed(env.BOX_SUBJECT_TYPE).toLowerCase() === "user" ? "user" : "enterprise"

  if (clientId && clientSecret && subjectId) {
    return {
      enabled: true,
      config: { folderId, auth: { type: "ccg", clientId, clientSecret, subjectId, subjectType } },
    }
  }

  return {
    enabled: false,
    reason:
      "Box auth is incomplete — set BOX_DEVELOPER_TOKEN, or BOX_CLIENT_ID + BOX_CLIENT_SECRET + BOX_SUBJECT_ID",
  }
}

/** Cheap check used by the transcription routes to decide whether to stash archive artifacts. */
export function isBoxArchivingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return getBoxConfig(env).enabled
}
