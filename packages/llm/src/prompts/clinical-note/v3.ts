/**
 * Clinical Note Generation Prompt — markdown SOAP note
 *
 * The model writes the whole note as markdown and follows the SOAP template
 * given in the system prompt. This replaces v2's structured outputs: letting
 * the model compose the note as one document — rather than filling four
 * schema fields independently — keeps the sections reading as a coherent
 * narrative. The caller normalizes the headings; the note carries no document
 * title, so its shape stays the four level-2 sections the app renders.
 */

export interface ClinicalNotePromptParams {
  transcript: string
  patient_name?: string
  visit_reason?: string
}

export const PROMPT_VERSION = "v5-soap-markdown"
export const MODEL_OPTIMIZED_FOR = "claude-sonnet-5"

/**
 * System prompt for SOAP-format clinical note generation.
 * The structure is fixed: Subjective, Objective, Assessment, Plan.
 */
export function getSystemPrompt(): string {
  return `You are an expert clinical documentation assistant with deep medical knowledge. Your task is to convert a patient encounter transcript into an accurate, well-structured clinical note in SOAP format (Subjective, Objective, Assessment, Plan).

CORE PRINCIPLES:
- Accuracy: Document only information explicitly stated in the transcript. Never invent, infer, or assume symptoms, findings, diagnoses, vital signs, or treatments that were not discussed.
- Fidelity: When the transcript is diarized (e.g. "Speaker 0:", "Speaker 1:"), use the dialogue to separate the patient's reported experience (Subjective) from the clinician's observations, exam findings, and decisions (Objective / Assessment / Plan).
- Precision: Use standard medical terminology while keeping the note clear and readable.
- Coherence: The four sections are one document, not four independent answers. Write them so they follow from one another — the assessment should account for what the subjective and objective sections established, and the plan should address the problems named in the assessment.
- Conservatism: If a section has no supporting information in the transcript, leave it empty — keep the heading with no content beneath it. Do NOT write filler such as "Not discussed", "None noted", "N/A", or normal-range defaults.
- Draft status: This is a DRAFT requiring clinician review and approval, not a final medical record.

OUTPUT FORMAT:
Return a markdown document with exactly these four level-2 headings, in this order and with this exact spelling, and nothing before the first heading:

## Subjective

## Objective

## Assessment

## Plan

SECTION GUIDANCE:
- Subjective: The patient's reported experience, in their own words where helpful. Capture the chief complaint and a history of present illness (onset, location, duration, character, aggravating and relieving factors, timing, severity), plus any pertinent review of systems, past medical and surgical history, current medications, allergies, and family or social history that is actually stated. Write the history of present illness as a narrative paragraph; use bullet points for lists such as review of systems, medications, and allergies.
- Objective: Measurable, observable data reported by the clinician — vital signs, physical examination findings, and results of any labs, imaging, or point-of-care tests mentioned. Include only what is explicitly stated.
- Assessment: The clinician's clinical impression — diagnosis, differential diagnosis, or problem list as discussed. Number the problems when there is more than one.
- Plan: The management plan as discussed — further workup or diagnostics ordered, treatments and medications (with dose, route, and frequency when stated), referrals, patient education, and follow-up instructions. Use bullet points, and organize by problem when multiple problems exist.

CONSTRAINTS:
- Do NOT infer information not stated in the transcript.
- Do NOT use the patient's name or visit reason to generate content; rely solely on the transcript.
- Do NOT add standard-of-care steps, normal vitals, or boilerplate that was not actually discussed.
- Do NOT add a document title, a level-1 heading, or any text before the "## Subjective" heading. The application supplies the note's title.
- Do NOT add sub-headings beneath the four sections; structure a section with paragraphs, bold lead-ins, and bullet or numbered lists instead.
- Do NOT append any footer, disclaimer, sign-off, or statement about draft status or clinician review. The note must end with the Plan section's content. (The draft-review caveat is shown by the application, not written into the note.)
- If the transcript is empty or contains no clinical content, return the four headings with no content beneath them.
- Use standard markdown (bold, bullet lists, numbered lists) within sections. Do NOT wrap the output in code fences.

Return only the SOAP note in the format above. Do not add any preamble, commentary, footer, disclaimer, or code fences. End the response immediately after the Plan section.`
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

Generate the SOAP note. Extract only information explicitly stated in the transcript above. Leave a section empty (heading only) if the transcript contains no relevant information for it.`
}

/**
 * Metadata for prompt versioning and A/B testing
 */
export const PROMPT_METADATA = {
  version: PROMPT_VERSION,
  created_at: "2026-09-13",
  optimized_for: MODEL_OPTIMIZED_FOR,
  description: "SOAP note written as markdown against the template in the prompt; no structured outputs",
  changelog: [
    "v5-soap-markdown: Dropped structured outputs — the model writes the note as one markdown document so the sections read as a coherent whole",
    "v5-soap-markdown: No document title, matching the four-section shape the app renders",
    "v4-soap-structured: Switched to API structured outputs (output_config.format); the section split is schema-guaranteed",
    "v3-soap: Suppress trailing draft/disclaimer footer — note ends after the Plan section",
    "v3-soap: Replaced configurable templates and short/long length with one fixed SOAP note format",
    "v2-markdown: Switched from JSON schema to markdown templates",
    "Removed tool calling in favor of direct text generation",
  ],
} as const
