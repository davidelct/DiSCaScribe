import type { NextRequest } from "next/server"
import type { Encounter } from "@storage/types"
import { importConsultations, importRecallSessions, listConsultations } from "@/lib/shared-store/consultations"
import { jsonError, jsonResponse, resolveScope, storeFailure } from "@/lib/shared-store/route-helpers"

export const runtime = "nodejs"

/** Every consultation in the session's scope, newest first. */
export async function GET(req: NextRequest) {
  const resolved = await resolveScope(req)
  if ("response" in resolved) return resolved.response
  try {
    return jsonResponse({ encounters: await listConsultations(resolved.scope) })
  } catch (error) {
    return storeFailure(error)
  }
}

/**
 * Hand a browser's local consultations and recall sessions to the shared
 * store, once, when that browser first finds the store configured. Newer
 * work already in the store is kept (see importConsultations).
 */
export async function POST(req: NextRequest) {
  const resolved = await resolveScope(req)
  if ("response" in resolved) return resolved.response
  let body: { encounters?: unknown; recall_sessions?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return jsonError(400, "validation_error", "Request body must be JSON")
  }
  const encounters = Array.isArray(body.encounters) ? (body.encounters as Encounter[]) : []
  const recallSessions =
    body.recall_sessions && typeof body.recall_sessions === "object"
      ? (body.recall_sessions as Record<string, unknown>)
      : {}
  try {
    const consultations = await importConsultations(resolved.scope, encounters, "browser")
    const recall = await importRecallSessions(resolved.scope, recallSessions, "browser")
    return jsonResponse({ ok: true, consultations, recall_sessions: recall })
  } catch (error) {
    return storeFailure(error)
  }
}
