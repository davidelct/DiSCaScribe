/**
 * Request plumbing shared by the /api/consultations routes: the session's
 * scope, and the responses every route gives for an expired session or an
 * unconfigured store.
 */

import type { SessionRole } from "@/lib/auth"
import { requestSessionRole } from "@/lib/request-keys"
import { scopeForRole, type StoreScope } from "./consultations"
import { isSharedStoreConfigured } from "./db"

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

export function jsonError(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status)
}

/**
 * The scope this request may read and write, or the response to send instead.
 * 503 `store_unconfigured` tells the browser to keep using its local store.
 */
export async function resolveScope(req: Request): Promise<{ scope: StoreScope; role: SessionRole } | { response: Response }> {
  if (!isSharedStoreConfigured()) {
    return { response: jsonError(503, "store_unconfigured", "The shared consultation store is not configured") }
  }
  const role = await requestSessionRole(req)
  if (!role) return { response: jsonError(401, "invalid_session", "Session expired. Log in again.") }
  return { scope: scopeForRole(role), role }
}

export function storeFailure(error: unknown): Response {
  console.error("Shared store request failed", error)
  return jsonError(502, "store_error", error instanceof Error ? error.message : "Shared store request failed")
}
