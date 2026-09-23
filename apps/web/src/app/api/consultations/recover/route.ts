import type { NextRequest } from "next/server"
import { writeAuditEntry } from "@storage/audit-log"
import { getArchivalConfig } from "@/lib/archival"
import { recoverFromArchive } from "@/lib/shared-store/archive-recovery"
import { importConsultations, importRecallSessions, knownConsultationIds } from "@/lib/shared-store/consultations"
import { jsonError, jsonResponse, resolveScope, storeFailure } from "@/lib/shared-store/route-helpers"

export const runtime = "nodejs"
// Reading every archive folder takes a while the first time.
export const maxDuration = 300

/**
 * Rebuild consultations from the Box archive into the shared store: every
 * archive folder whose consultation the store does not know yet (so a re-run
 * only fetches what is new, and a deleted consultation stays deleted).
 */
export async function POST(req: NextRequest) {
  const resolved = await resolveScope(req)
  if ("response" in resolved) return resolved.response
  const archival = getArchivalConfig(resolved.role)
  if (!archival.enabled) return jsonError(409, "archive_unconfigured", archival.reason)

  try {
    const known = await knownConsultationIds(resolved.scope)
    const { recovered, failed } = await recoverFromArchive(archival.client, known)
    const consultations = await importConsultations(
      resolved.scope,
      recovered.map((item) => item.encounter),
      "box",
    )
    const recall = await importRecallSessions(
      resolved.scope,
      Object.fromEntries(
        recovered
          .filter((item) => item.recallSession !== undefined)
          .map((item) => [item.encounter.id, item.recallSession]),
      ),
      "box",
    )
    await writeAuditEntry({
      event_type: "encounter.recovered",
      success: failed.length === 0,
      metadata: { inserted: consultations.inserted, recall_sessions: recall.inserted, failed: failed.length },
    })
    return jsonResponse({ ok: true, consultations, recall_sessions: recall, failed })
  } catch (error) {
    return storeFailure(error)
  }
}
