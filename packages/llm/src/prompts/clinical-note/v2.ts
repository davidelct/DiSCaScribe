/**
 * Clinical Note Generation Prompt — structured output
 * The model returns JSON with one field per SOAP section (enforced by the
 * API's structured outputs); the caller assembles the canonical markdown.
 */

export interface ClinicalNotePromptParams {
  transcript: string
  patient_name?: string
  visit_reason?: string
}

export const PROMPT_VERSION = "v4-soap-structured"
export const MODEL_OPTIMIZED_FOR = "claude-sonnet-5"

/**
 * JSON schema for the structured SOAP note response. Every property is
 * required and additionalProperties is false, as structured outputs demand.
 */
export const SOAP_NOTE_SCHEMA = {
  name: "SoapNote",
  schema: {
    type: "object",
    properties: {
      subjective: {
        type: "string",
        description:
          "The patient's reported experience: chief complaint, history of present illness as a narrative paragraph, plus pertinent review of systems, histories, medications, and allergies as bullet lists. Markdown without headings. Empty string if the transcript contains nothing relevant.",
      },
      objective: {
        type: "string",
        description:
          "Measurable, observable data reported by the clinician: vital signs, examination findings, results of labs/imaging/point-of-care tests. Markdown without headings. Empty string if nothing relevant.",
      },
      assessment: {
        type: "string",
        description:
          "The clinician's clinical impression: diagnosis, differential, or problem list as discussed; numbered when more than one problem. Markdown without headings. Empty string if nothing relevant.",
      },
      plan: {
        type: "string",
        description:
          "The management plan as discussed: workup ordered, treatments and medications with dose/route/frequency when stated, referrals, patient education, follow-up. Bullet points, organized by problem when multiple. Markdown without headings. Empty string if nothing relevant.",
      },
    },
    required: ["subjective", "objective", "assessment", "plan"],
    additionalProperties: false,
  } as Record<string, unknown>,
}

/**
 * System prompt for SOAP-format clinical note generation with structured
 * output: one JSON field per section.
 */
export function getSystemPrompt(): string {
  return `You are an expert clinical documentation assistant with deep medical knowledge. Your task is to convert a patient encounter transcript into an accurate, well-structured clinical note in SOAP format (Subjective, Objective, Assessment, Plan), returned as JSON with one field per section.

CORE PRINCIPLES:
- Accuracy: Document only information explicitly stated in the transcript. Never invent, infer, or assume symptoms, findings, diagnoses, vital signs, or treatments that were not discussed.
- Fidelity: When the transcript is diarized (e.g. "Speaker 0:", "Speaker 1:"), use the dialogue to separate the patient's reported experience (subjective) from the clinician's observations, exam findings, and decisions (objective / assessment / plan).
- Precision: Use standard medical terminology while keeping the note clear and readable.
- Conservatism: If a section has no supporting information in the transcript, return an empty string for that field. Do NOT write filler such as "Not discussed", "None noted", "N/A", or normal-range defaults.
- Draft status: This is a DRAFT requiring clinician review and approval, not a final medical record.

OUTPUT FORMAT:
Return JSON with exactly four string fields: "subjective", "objective", "assessment", "plan". Each field holds that section's content as markdown (paragraphs, bullet lists, bold) WITHOUT any headings — the application adds the section headings itself.

SECTION GUIDANCE:
- subjective: The patient's reported experience, in their own words where helpful. Capture the chief complaint and a history of present illness (onset, location, duration, character, aggravating and relieving factors, timing, severity), plus any pertinent review of systems, past medical and surgical history, current medications, allergies, and family or social history that is actually stated. Write the history of present illness as a narrative paragraph; use bullet points for lists such as review of systems, medications, and allergies.
- objective: Measurable, observable data reported by the clinician — vital signs, physical examination findings, and results of any labs, imaging, or point-of-care tests mentioned. Include only what is explicitly stated.
- assessment: The clinician's clinical impression — diagnosis, differential diagnosis, or problem list as discussed. Number the problems when there is more than one.
- plan: The management plan as discussed — further workup or diagnostics ordered, treatments and medications (with dose, route, and frequency when stated), referrals, patient education, and follow-up instructions. Use bullet points, and organize by problem when multiple problems exist.

CONSTRAINTS:
- Do NOT infer information not stated in the transcript.
- Do NOT use the patient's name or visit reason to generate content; rely solely on the transcript.
- Do NOT add standard-of-care steps, normal vitals, or boilerplate that was not actually discussed.
- Do NOT include section headings, footers, disclaimers, sign-offs, or statements about draft status in any field. (The draft-review caveat is shown by the application, not written into the note.)
- If the transcript is empty or contains no clinical content, return all four fields as empty strings.`
}

/**
 * User prompt — supplies the transcript only.
 * Patient name and visit reason are intentionally excluded (HIPAA minimum necessary).
 */
export function getUserPrompt(params: ClinicalNotePromptParams): string {
  const { transcript } = params

  return `Convert this clinical encounter transcript into a structured SOAP note following the format provided in the system message.

TRANSCRIPT:
${transcript}

Generate the SOAP note JSON. Extract only information explicitly stated in the transcript above. Return an empty string for a section if the transcript contains no relevant information for it.`
}

/**
 * Metadata for prompt versioning and A/B testing
 */
export const PROMPT_METADATA = {
  version: PROMPT_VERSION,
  created_at: "2026-07-12",
  optimized_for: MODEL_OPTIMIZED_FOR,
  description: "SOAP note via structured outputs — one JSON field per section; markdown assembled by the app",
  changelog: [
    "v4-soap-structured: Switched to API structured outputs (output_config.format); the section split is schema-guaranteed",
    "v3-soap: Suppress trailing draft/disclaimer footer — note ends after the Plan section",
    "v3-soap: Replaced configurable templates and short/long length with one fixed SOAP note format",
    "v2-markdown: Switched from JSON schema to markdown templates",
    "Removed tool calling in favor of direct text generation",
  ],
} as const
