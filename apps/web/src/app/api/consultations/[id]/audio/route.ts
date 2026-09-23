import type { NextRequest } from "next/server"
import { getArchivalConfig } from "@/lib/archival"
import { encounterIdOfContainer } from "@/lib/shared-store/archive-recovery"
import { getConsultation } from "@/lib/shared-store/consultations"
import { jsonError, resolveScope } from "@/lib/shared-store/route-helpers"

export const runtime = "nodejs"

type Context = { params: Promise<{ id: string }> }

const PASSED_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]

/**
 * Stream a consultation's recording (or, with `?kind=recall`, its recall
 * interview) from the Box archive. Browsers keep their own recordings in
 * IndexedDB; this is how every other browser plays them. A Range header is
 * passed through so the player can seek.
 */
export async function GET(req: NextRequest, context: Context) {
  const resolved = await resolveScope(req)
  if ("response" in resolved) return resolved.response
  const { id } = await context.params
  const prefix = req.nextUrl.searchParams.get("kind") === "recall" ? "recall_audio." : "audio."

  const archival = getArchivalConfig(resolved.role)
  if (!archival.enabled) return jsonError(404, "not_archived", archival.reason)

  try {
    const encounter = await getConsultation(resolved.scope, id)
    let folderId = encounter?.archive_location
    if (!folderId) {
      const containers = await archival.client.listContainers()
      folderId = containers.find((container) => encounterIdOfContainer(container.name) === id)?.id
    }
    if (!folderId) return jsonError(404, "not_archived", "This consultation has no archive folder")

    const files = await archival.client.listFiles(folderId)
    const audio = [...files.values()].find((file) => file.name.startsWith(prefix))
    if (!audio) return jsonError(404, "no_audio", "No recording in the archive for this consultation")

    const upstream = await archival.client.downloadFile(audio.id, req.headers.get("range") ?? undefined)
    const headers = new Headers({ "Cache-Control": "private, max-age=3600" })
    for (const name of PASSED_HEADERS) {
      const value = upstream.headers.get(name)
      if (value) headers.set(name, value)
    }
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch (error) {
    console.error("Archived audio fetch failed", error)
    return jsonError(502, "archive_error", error instanceof Error ? error.message : "Archived audio fetch failed")
  }
}
