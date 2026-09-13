import { runLLMRequest, prompts } from "../../../llm/src/index"
import { parseDiarizedTranscript, sanitizeRecallExchanges } from "../../shared/src/index"
import type { RecallAnalysis } from "../../../storage/src/types"
import { debugLog, debugError } from "../../../storage/src/index"

export interface RecallAnalysisRequest {
  transcript: string
  apiKey?: string
}

/**
 * Mark the question–answer exchanges in a diarised transcript and name the
 * clinician's speaker, for stimulated recall. A small structured-output call;
 * the result is validated against the transcript so a stray index from the
 * model can never bracket the wrong turns. A transcript that is not diarised
 * (or has a single turn) yields no exchanges rather than an error.
 */
export async function analyseTranscriptForRecall(params: RecallAnalysisRequest): Promise<RecallAnalysis> {
  const { transcript, apiKey } = params
  const detectedAt = new Date().toISOString()
  const turns = parseDiarizedTranscript(transcript.trim()) ?? []
  if (turns.length < 2) {
    return { exchanges: [], turn_count: turns.length, detected_at: detectedAt }
  }

  const prompt = prompts.recallExchanges.currentVersion
  debugLog(`🔎 Detecting recall exchanges over ${turns.length} turns (prompt ${prompt.PROMPT_VERSION})`)

  let text: string
  try {
    text = await runLLMRequest({
      system: prompt.getSystemPrompt(),
      prompt: prompt.getUserPrompt({
        turns: turns.map((turn, index) => ({ index, speaker: turn.speaker, text: turn.text })),
      }),
      model: prompt.MODEL_OPTIMIZED_FOR,
      apiKey,
      jsonSchema: prompt.RECALL_EXCHANGES_SCHEMA,
    })
  } catch (error) {
    debugError("Recall exchange detection failed", error)
    throw error
  }

  let parsed: { clinician_speaker?: unknown; exchanges?: unknown } = {}
  try {
    parsed = JSON.parse(text) as typeof parsed
  } catch {
    throw new Error("Recall exchange detection returned malformed JSON")
  }

  const speakers = new Set(turns.map((turn) => turn.speaker))
  const clinician = parsed.clinician_speaker
  const exchanges = sanitizeRecallExchanges(parsed.exchanges, turns.length)
  debugLog(`✅ ${exchanges.length} exchanges detected`)
  return {
    exchanges,
    clinician_speaker:
      typeof clinician === "number" && Number.isInteger(clinician) && speakers.has(clinician) ? clinician : undefined,
    turn_count: turns.length,
    detected_at: detectedAt,
  }
}
