import type { NextRequest } from "next/server"
import type { Encounter } from "@storage/types"
import { deleteConsultation, putConsultation } from "@/lib/shared-store/consultations"
import { jsonError, jsonResponse, resolveScope, storeFailure } from "@/lib/shared-store/route-helpers"

export const runtime = "nodejs"

type Context = { params: Promise<{ id: string }> }

/** Save the app's current copy of one consultation. */
export async function PUT(req: NextRequest, context: Context) {
  const resolved = await resolveScope(req)
  if ("response" in resolved) return resolved.response
  const { id } = await context.params
  let encounter: Encounter
  try {
    encounter = (await req.json()) as Encounter
  } catch {
    return jsonError(400, "validation_error", "Request body must be JSON")
  }
  if (!encounter || typeof encounter !== "object" || encounter.id !== id) {
    return jsonError(400, "validation_error", "Body must be the consultation whose id is in the URL")
  }
  try {
    await putConsultation(resolved.scope, encounter)
    return jsonResponse({ ok: true })
  } catch (error) {
    return storeFailure(error)
  }
}

export async function DELETE(req: NextRequest, context: Context) {
  const resolved = await resolveScope(req)
  if ("response" in resolved) return resolved.response
  const { id } = await context.params
  try {
    await deleteConsultation(resolved.scope, id)
    return jsonResponse({ ok: true })
  } catch (error) {
    return storeFailure(error)
  }
}
