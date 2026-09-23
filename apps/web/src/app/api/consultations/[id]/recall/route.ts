import type { NextRequest } from "next/server"
import { getRecallSession, putRecallSession } from "@/lib/shared-store/consultations"
import { jsonError, jsonResponse, resolveScope, storeFailure } from "@/lib/shared-store/route-helpers"

export const runtime = "nodejs"

type Context = { params: Promise<{ id: string }> }

/** The consultation's stimulated-recall session; `session` is null when there is none yet. */
export async function GET(req: NextRequest, context: Context) {
  const resolved = await resolveScope(req)
  if ("response" in resolved) return resolved.response
  const { id } = await context.params
  try {
    return jsonResponse({ session: await getRecallSession(resolved.scope, id) })
  } catch (error) {
    return storeFailure(error)
  }
}

export async function PUT(req: NextRequest, context: Context) {
  const resolved = await resolveScope(req)
  if ("response" in resolved) return resolved.response
  const { id } = await context.params
  let session: unknown
  try {
    session = await req.json()
  } catch {
    return jsonError(400, "validation_error", "Request body must be JSON")
  }
  if (!session || typeof session !== "object") {
    return jsonError(400, "validation_error", "Body must be a recall session")
  }
  try {
    await putRecallSession(resolved.scope, id, session)
    return jsonResponse({ ok: true })
  } catch (error) {
    return storeFailure(error)
  }
}
