/**
 * Lightweight shared-password gate for the hosted demo.
 *
 * Zero dependencies, no session store: a password is checked server-side and,
 * on success, the browser is given an httpOnly cookie whose value is a salted
 * SHA-256 of that password. Middleware re-derives the token(s) from the env
 * vars and compares — so the raw password is never stored in the cookie and
 * never reaches client JS.
 *
 * Two passwords, two roles. DEMO_PASSWORD grants the "full" role (server API
 * keys usable). DEMO_PASSWORD_BYOK grants the "byok" role: those sessions must
 * bring their own Deepgram/Anthropic keys — the server refuses to spend the
 * env keys on them — and their consultations archive to the BYOK Box folder.
 * Because the cookie is a hash of the specific password, the role is bound to
 * the session cryptographically: forging a role upgrade requires knowing the
 * other password itself.
 *
 * Uses Web Crypto (crypto.subtle) so the exact same code runs in both the Edge
 * middleware and the Node route handlers.
 *
 * The gate is ACTIVE only when DEMO_PASSWORD is set. If it is unset (e.g. local
 * development) the site is open and every session has the "full" role — this
 * avoids accidentally locking everyone out.
 */

export const AUTH_COOKIE = "disca_demo"
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12 // 12 hours

const TOKEN_SALT = "disca-demo-v1"

/** Session role: which password the cookie was derived from. */
export type SessionRole = "full" | "byok"

/** The gate only engages when the primary demo password is configured. */
export function gateEnabled(): boolean {
  return Boolean(process.env.DEMO_PASSWORD && process.env.DEMO_PASSWORD.trim())
}

/** Derive the opaque session token for a given password. */
export async function sessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`${TOKEN_SALT}:${password}`)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** Configured passwords by role. BYOK is optional and only valid with the gate on. */
function configuredPasswords(): Array<{ role: SessionRole; password: string }> {
  const entries: Array<{ role: SessionRole; password: string }> = []
  const full = process.env.DEMO_PASSWORD?.trim()
  if (full) entries.push({ role: "full", password: full })
  const byok = process.env.DEMO_PASSWORD_BYOK?.trim()
  if (byok) entries.push({ role: "byok", password: byok })
  return entries
}

/** Length-safe constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/**
 * The role a submitted password grants, or null when it matches neither.
 * Compares against every configured password (constant-time per candidate).
 */
export function roleForPassword(password: string): SessionRole | null {
  let matched: SessionRole | null = null
  for (const entry of configuredPasswords()) {
    if (safeEqual(password, entry.password)) matched = entry.role
  }
  return matched
}

/**
 * The role carried by a session cookie: "full" | "byok", or null for an
 * invalid/absent cookie. When the gate is off every request is "full".
 */
export async function sessionRole(cookieValue: string | undefined): Promise<SessionRole | null> {
  if (!gateEnabled()) return "full"
  if (!cookieValue) return null
  let matched: SessionRole | null = null
  for (const entry of configuredPasswords()) {
    const expected = await sessionToken(entry.password)
    if (safeEqual(cookieValue, expected)) matched = entry.role
  }
  return matched
}

/** True when the cookie value matches any configured password's token. */
export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  if (!gateEnabled()) return false
  return (await sessionRole(cookieValue)) !== null
}

/** Restrict post-login redirects to same-origin paths to avoid open redirects. */
export function sanitizeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/"
  return raw
}
