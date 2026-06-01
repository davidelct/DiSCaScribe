/**
 * Lightweight shared-password gate for the hosted demo.
 *
 * Zero dependencies, no session store: a single password (DEMO_PASSWORD) is
 * checked server-side and, on success, the browser is given an httpOnly cookie
 * whose value is a salted SHA-256 of the password. Middleware re-derives that
 * token from the env var and compares — so the raw password is never stored in
 * the cookie and never reaches client JS.
 *
 * Uses Web Crypto (crypto.subtle) so the exact same code runs in both the Edge
 * middleware and the Node route handlers.
 *
 * The gate is ACTIVE only when DEMO_PASSWORD is set. If it is unset (e.g. local
 * development) the site is open — this avoids accidentally locking everyone out.
 */

export const AUTH_COOKIE = "disca_demo"
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12 // 12 hours

const TOKEN_SALT = "disca-demo-v1"

/** The gate only engages when a demo password is configured. */
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

/** The token we expect a valid cookie to carry, or null if the gate is off. */
export async function expectedToken(): Promise<string | null> {
  const password = process.env.DEMO_PASSWORD?.trim()
  if (!password) return null
  return sessionToken(password)
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

/** True when the cookie value matches the configured password's token. */
export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false
  const expected = await expectedToken()
  if (!expected) return false
  return safeEqual(cookieValue, expected)
}

/** Restrict post-login redirects to same-origin paths to avoid open redirects. */
export function sanitizeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/"
  return raw
}
