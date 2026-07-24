/**
 * Per-request provider-key resolution, gated by session role.
 *
 * BYOK sessions (DEMO_PASSWORD_BYOK) must supply their own Deepgram/Anthropic
 * keys with each request — the server refuses to fall back to the env keys for
 * them, so a tester can never spend the study's quota. Full sessions use the
 * env keys as always, with a request-supplied key taking precedence if one is
 * sent. Keys arrive via headers (routes) or arguments (server actions), are
 * used for the one provider call, and are never persisted or logged.
 */

import { AUTH_COOKIE, sessionRole, type SessionRole } from "@/lib/auth"

export const DEEPGRAM_KEY_HEADER = "x-deepgram-key"
export const ANTHROPIC_KEY_HEADER = "x-anthropic-key"

export const BYOK_KEY_REQUIRED_MESSAGE =
  "This account requires your own API keys. Add them in Settings and try again."

export type RequestKeyResolution =
  | { ok: true; role: SessionRole; apiKey?: string }
  | { ok: false; status: 401 | 403; code: string; message: string }

/** Role of the session that issued `req`, or null for an invalid cookie. */
export async function requestSessionRole(req: Request): Promise<SessionRole | null> {
  const cookieHeader = req.headers.get("cookie") ?? ""
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${AUTH_COOKIE}=([^;]*)`))
  return sessionRole(match ? decodeURIComponent(match[1]) : undefined)
}

/**
 * Resolve the provider key policy for one request: which key to pass to the
 * provider call (undefined = let it fall back to the env key), or a structured
 * refusal for BYOK sessions that sent no key.
 */
export async function resolveRequestKey(req: Request, header: string): Promise<RequestKeyResolution> {
  const role = await requestSessionRole(req)
  if (!role) {
    return { ok: false, status: 401, code: "invalid_session", message: "Session expired. Log in again." }
  }
  const supplied = req.headers.get(header)?.trim() || undefined
  if (role === "byok" && !supplied) {
    return { ok: false, status: 403, code: "byok_key_required", message: BYOK_KEY_REQUIRED_MESSAGE }
  }
  return { ok: true, role, apiKey: supplied }
}
