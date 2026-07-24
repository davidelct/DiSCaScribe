"use server"

import { cookies } from "next/headers"
import type { ClinicalNoteRequest } from "@note-core"
import { createClinicalNoteText } from "@note-core"
import { getAnthropicApiKey } from "@storage/server-api-keys"
import { writeAuditEntry } from "@storage/audit-log"
import { AUTH_COOKIE, sessionRole } from "@/lib/auth"
import { BYOK_KEY_REQUIRED_MESSAGE } from "@/lib/request-keys"

export interface GenerateNoteOptions {
  /**
   * Caller-supplied Anthropic key (from the browser's Settings, sent per
   * request and never persisted server-side). Required for BYOK sessions;
   * optional override for full sessions.
   */
  anthropicApiKey?: string
}

export async function generateClinicalNote(
  params: ClinicalNoteRequest,
  options: GenerateNoteOptions = {},
): Promise<string> {
  const role = await sessionRole((await cookies()).get(AUTH_COOKIE)?.value)
  if (!role) {
    throw new Error("Session expired. Log in again.")
  }
  const suppliedKey = options.anthropicApiKey?.trim()
  if (role === "byok" && !suppliedKey) {
    throw new Error(BYOK_KEY_REQUIRED_MESSAGE)
  }
  const apiKey = suppliedKey || getAnthropicApiKey()

  try {
    // Audit log: note generation started
    await writeAuditEntry({
      event_type: "note.generation_started",
      success: true,
      metadata: {
        transcript_length: params.transcript?.length || 0,
      },
    })

    const result = await createClinicalNoteText({ ...params, apiKey })

    // Audit log: note generated successfully
    await writeAuditEntry({
      event_type: "note.generated",
      success: true,
      metadata: {
        note_length: result.length,
      },
    })

    return result
  } catch (error) {
    // Audit log: note generation failed
    await writeAuditEntry({
      event_type: "note.generation_failed",
      success: false,
      error_message: error instanceof Error ? error.message : String(error),
    })

    throw error
  }
}
