import type { NextRequest } from "next/server"
import { writeAuditEntry } from "@storage/audit-log"
import { buildTestRequestsArchive, parseTestRequests } from "@pipeline-errors"
import { archiveTestRequests, getArchivalConfig } from "@/lib/archival"
import { requestSessionRole } from "@/lib/request-keys"

export const runtime = "nodejs"

function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

/**
 * Archive the tests requested in a consultation to its container as
 * test_requests.json. JSON body:
 * - encounter_id, created_at — locate the consultation's container
 * - tests — the current requests (an empty list records that none remain)
 * When archiving is not configured the route is a graceful no-op
 * (`{ skipped: true }`) so requesting tests never breaks.
 */
export async function POST(req: NextRequest) {
  let encounterId = ""
  try {
    let body: { encounter_id?: unknown; created_at?: unknown; tests?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return jsonError(400, "validation_error", "Request body must be JSON")
    }
    if (typeof body.encounter_id !== "string" || !body.encounter_id) {
      return jsonError(400, "validation_error", "Missing encounter_id")
    }
    encounterId = body.encounter_id
    const tests = parseTestRequests(body.tests)
    if (!tests) {
      return jsonError(400, "validation_error", "tests must be a list of requests")
    }

    const role = await requestSessionRole(req)
    if (!role) {
      return jsonError(401, "invalid_session", "Session expired. Log in again.")
    }
    const archival = getArchivalConfig(role)
    if (!archival.enabled) {
      return new Response(JSON.stringify({ skipped: true, reason: archival.reason }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    const result = await archiveTestRequests({
      client: archival.client,
      encounterId,
      createdAt: typeof body.created_at === "string" ? body.created_at : "",
      document: buildTestRequestsArchive(encounterId, tests, new Date().toISOString()),
    })

    await writeAuditEntry({
      event_type: "encounter.archived",
      resource_id: encounterId,
      success: true,
      metadata: {
        storage_backend: archival.backend,
        folder_id: result.folderId,
        files: result.uploaded,
        artifact_kind: "test_requests",
        test_count: tests.length,
      },
    })

    return new Response(JSON.stringify({ ok: true, folderId: result.folderId, files: result.uploaded }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("Test request archive failed", error)
    await writeAuditEntry({
      event_type: "encounter.archive_failed",
      resource_id: encounterId || undefined,
      success: false,
      error_message: error instanceof Error ? error.message : "Test request archive failed",
      metadata: { artifact_kind: "test_requests" },
    })
    return jsonError(502, "archive_error", error instanceof Error ? error.message : "Test request archive failed")
  }
}
