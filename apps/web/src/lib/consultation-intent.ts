/**
 * Hand-off between the chart's start-consultation dialog and the consultation
 * workspace: the dialog chooses how the consultation launches (record now, or
 * transcribe an uploaded file) and the workspace dispatches it on mount.
 *
 * Module memory only — it survives client-side navigation, which is the only
 * path between the two. After a hard refresh there is no intent and the
 * workspace falls back to its ready panel.
 */

export type ConsultationIntent = { action: "record" } | { action: "upload"; file: File }

const intents = new Map<string, ConsultationIntent>()

export function setConsultationIntent(encounterId: string, intent: ConsultationIntent): void {
  intents.set(encounterId, intent)
}

/** Read-and-clear, so an intent can never fire twice. */
export function takeConsultationIntent(encounterId: string): ConsultationIntent | undefined {
  const intent = intents.get(encounterId)
  intents.delete(encounterId)
  return intent
}
