/**
 * Box archival configuration.
 *
 * Reads Box settings from the server environment. Archiving is opt-in: when it
 * is not fully configured the app behaves exactly as before (consultations are
 * simply not pushed to Box), so the absence of Box credentials is never an
 * error — callers treat a disabled config as a graceful no-op.
 *
 * Three auth modes are supported, resolved in this order:
 *  - Developer token: a short-lived (~60 min) token, handy for local testing.
 *  - JWT (Server Authentication with JWT): the mode of the Imperial-approved
 *    app. `BOX_JWT_CONFIG` holds the dev-console keypair config JSON, either
 *    raw or base64-encoded (base64 keeps it on one .env line).
 *  - Client Credentials Grant (CCG): a service account via client id/secret.
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
  | {
      type: "jwt"
      clientId: string
      clientSecret: string
      publicKeyId: string
      privateKey: string
      passphrase: string
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

/** Shape of the config JSON downloaded from the Box dev console keypair generator. */
interface BoxJwtConfigFile {
  boxAppSettings?: {
    clientID?: string
    clientSecret?: string
    appAuth?: { publicKeyID?: string; privateKey?: string; passphrase?: string }
  }
  enterpriseID?: string
}

type JwtAuth = Extract<BoxAuth, { type: "jwt" }>

/**
 * Parse `BOX_JWT_CONFIG` (raw JSON or base64-encoded JSON). Returns the auth on
 * success, `null` when the variable is unset, and a reason string when it is
 * set but unusable — a present-but-broken JWT config must surface its error,
 * not silently fall through to CCG.
 */
function parseJwtConfig(env: Record<string, string | undefined>): JwtAuth | string | null {
  const rawValue = trimmed(env.BOX_JWT_CONFIG)
  if (!rawValue) return null

  let json = rawValue
  if (!rawValue.startsWith("{")) {
    try {
      json = Buffer.from(rawValue, "base64").toString("utf8")
    } catch {
      return "BOX_JWT_CONFIG is neither JSON nor valid base64"
    }
  }

  let parsed: BoxJwtConfigFile
  try {
    parsed = JSON.parse(json) as BoxJwtConfigFile
  } catch {
    return "BOX_JWT_CONFIG does not decode to valid JSON"
  }

  const settings = parsed.boxAppSettings
  const appAuth = settings?.appAuth
  const clientId = trimmed(settings?.clientID)
  const clientSecret = trimmed(settings?.clientSecret)
  const publicKeyId = trimmed(appAuth?.publicKeyID)
  const privateKey = appAuth?.privateKey?.trim() || ""
  const passphrase = appAuth?.passphrase ?? ""
  if (!clientId || !clientSecret || !publicKeyId || !privateKey) {
    return "BOX_JWT_CONFIG is missing boxAppSettings.clientID/clientSecret/appAuth.publicKeyID/privateKey"
  }

  const subjectType = trimmed(env.BOX_SUBJECT_TYPE).toLowerCase() === "user" ? "user" : "enterprise"
  const subjectId = trimmed(env.BOX_SUBJECT_ID) || trimmed(parsed.enterpriseID)
  if (!subjectId) {
    return "BOX_JWT_CONFIG has no enterpriseID and BOX_SUBJECT_ID is not set"
  }
  if (subjectType === "user" && !trimmed(env.BOX_SUBJECT_ID)) {
    return "BOX_SUBJECT_TYPE=user requires an explicit BOX_SUBJECT_ID"
  }

  return { type: "jwt", clientId, clientSecret, publicKeyId, privateKey, passphrase, subjectId, subjectType }
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

  const jwt = parseJwtConfig(env)
  if (typeof jwt === "string") {
    return { enabled: false, reason: jwt }
  }
  if (jwt) {
    return { enabled: true, config: { folderId, auth: jwt } }
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
      "Box auth is incomplete — set BOX_DEVELOPER_TOKEN, BOX_JWT_CONFIG, or BOX_CLIENT_ID + BOX_CLIENT_SECRET + BOX_SUBJECT_ID",
  }
}

/** Cheap check used by the transcription routes to decide whether to stash archive artifacts. */
export function isBoxArchivingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return getBoxConfig(env).enabled
}
