import { runLLMRequest, prompts } from "../../../llm/src/index"
import { toPipelineStageError } from "../../shared/src/error"
import { 
  extractMarkdownFromResponse, 
  normalizeMarkdownSections,
  createEmptyMarkdownNote 
} from "./clinical-models/markdown-note"
import { debugLog, debugLogPHI, debugError, debugWarn } from "../../../storage/src/index"

export interface ClinicalNoteRequest {
  transcript: string
  patient_name: string
  visit_reason: string
  apiKey?: string
}

interface SoapNoteSections {
  subjective: string
  objective: string
  assessment: string
  plan: string
}

/**
 * Assemble the canonical SOAP markdown from the structured sections. Section
 * bodies carry no headings (the schema forbids them), so the note's shape —
 * one `##` per section, no document title — is deterministic and safe for
 * downstream parsing (e.g. the per-section copy UI).
 */
function assembleSoapMarkdown(sections: SoapNoteSections): string {
  const section = (title: string, body: string) => {
    const trimmed = body.trim()
    return trimmed ? `## ${title}\n\n${trimmed}` : `## ${title}`
  }
  return [
    section("Subjective", sections.subjective),
    section("Objective", sections.objective),
    section("Assessment", sections.assessment),
    section("Plan", sections.plan),
  ].join("\n\n") + "\n"
}

function parseSoapNoteJson(text: string): SoapNoteSections | null {
  try {
    const parsed = JSON.parse(text) as Partial<SoapNoteSections>
    if (
      typeof parsed?.subjective === "string" &&
      typeof parsed?.objective === "string" &&
      typeof parsed?.assessment === "string" &&
      typeof parsed?.plan === "string"
    ) {
      return parsed as SoapNoteSections
    }
  } catch {
    // fall through — treated as a plain-markdown response below
  }
  return null
}

export async function createClinicalNoteText(params: ClinicalNoteRequest): Promise<string> {
  const { transcript, patient_name, visit_reason, apiKey } = params

  debugLog("=".repeat(80))
  debugLog("GENERATING CLINICAL NOTE (MARKDOWN)")
  debugLog("=".repeat(80))
  debugLogPHI(`Patient Name: ${patient_name || "Not provided"}`)
  debugLogPHI(`Visit Reason: ${visit_reason || "Not provided"}`)
  debugLog(`Transcript length: ${transcript.length} characters`)

  if (!transcript || transcript.trim().length === 0) {
    debugLog("⚠️  Transcript is empty - returning empty note structure")
    const emptyNote = createEmptyMarkdownNote()
    debugLog("=".repeat(80))
    debugLog("FINAL CLINICAL NOTE (EMPTY):")
    debugLog("-".repeat(80))
    debugLogPHI(emptyNote)
    debugLog("-".repeat(80))
    debugLog("=".repeat(80))
    return emptyNote
  }

  debugLog("📝 Transcript being used for note generation:")
  debugLog("-".repeat(80))
  debugLogPHI(transcript)
  debugLog("-".repeat(80))

  // Use versioned SOAP prompt
  const systemPrompt = prompts.clinicalNote.currentVersion.getSystemPrompt()
  const userPrompt = prompts.clinicalNote.currentVersion.getUserPrompt({
    transcript,
    patient_name,
    visit_reason,
  })

  try {
    debugLog("🤖 Calling LLM to generate markdown clinical note...")
    debugLog(`📌 Using prompt version: ${prompts.clinicalNote.currentVersion.PROMPT_VERSION}`)
    debugLog(`🤖 Model: ${prompts.clinicalNote.currentVersion.MODEL_OPTIMIZED_FOR}`)
    
    const text = await runLLMRequest({
      system: systemPrompt,
      prompt: userPrompt,
      model: prompts.clinicalNote.currentVersion.MODEL_OPTIMIZED_FOR,
      apiKey,
      // Structured outputs: the API guarantees JSON matching this schema,
      // giving a schema-enforced SOAP section split.
      jsonSchema: prompts.clinicalNote.currentVersion.SOAP_NOTE_SCHEMA,
    })

    // Assemble canonical markdown from the structured sections. The defensive
    // markdown path covers the (schema-guaranteed not to happen) case of a
    // non-JSON response, and keeps this function safe if the prompt version
    // is ever rolled back to plain-markdown generation.
    const sections = parseSoapNoteJson(text)
    const normalizedMarkdown = sections
      ? assembleSoapMarkdown(sections)
      : normalizeMarkdownSections(extractMarkdownFromResponse(text))

    debugLog("=".repeat(80))
    debugLog("FINAL CLINICAL NOTE:")
    debugLog("=".repeat(80))
    debugLogPHI(normalizedMarkdown)
    debugLog("=".repeat(80))

    return normalizedMarkdown
  } catch (error) {
    debugError("❌ Failed to generate clinical note:", error)
    debugWarn("⚠️  Propagating note generation error")
    throw toPipelineStageError(error, {
      code: "note_generation_error",
      message: "Failed to generate clinical note",
      recoverable: true,
    })
  }
}
