/**
 * Recall exchange detection — structured output
 * Marks the question–answer exchanges in a diarised consultation transcript
 * and names the clinician's speaker number, for the stimulated-recall
 * interview that brackets those exchanges in the transcript.
 */

export interface RecallExchangePromptTurn {
  index: number
  speaker: number
  text: string
}

export interface RecallExchangePromptParams {
  turns: RecallExchangePromptTurn[]
}

export const PROMPT_VERSION = "v1-recall-exchanges"
/** A small, fast model: the task is segmentation, not reasoning. */
export const MODEL_OPTIMIZED_FOR = "claude-haiku-4-5-20251001"

/**
 * JSON schema for the response. Every property is required and
 * additionalProperties is false, as structured outputs demand; -1 stands in
 * for "could not tell" on the clinician speaker.
 */
export const RECALL_EXCHANGES_SCHEMA = {
  name: "RecallExchanges",
  schema: {
    type: "object",
    properties: {
      clinician_speaker: {
        type: "integer",
        description:
          "The speaker number of the clinician: the one who takes the history, examines and gives the plan. -1 if it cannot be told.",
      },
      exchanges: {
        type: "array",
        description: "Every question–answer exchange, in transcript order, without overlaps.",
        items: {
          type: "object",
          properties: {
            question: {
              type: "integer",
              description: "Index of the clinician turn that asks the patient something.",
            },
            answer_end: {
              type: "integer",
              description:
                "Index of the last consecutive patient turn answering it, before the clinician speaks again. Usually question + 1.",
            },
          },
          required: ["question", "answer_end"],
          additionalProperties: false,
        },
      },
    },
    required: ["clinician_speaker", "exchanges"],
    additionalProperties: false,
  } as Record<string, unknown>,
}

export function getSystemPrompt(): string {
  return `You read a diarised transcript of a primary care consultation and mark the exchanges in which the clinician asks the patient something and the patient answers. The transcript is given as numbered turns. Your output drives a stimulated-recall interview in which the clinician is later asked why they asked each question and what they made of the answer.

RULES:
- An exchange starts at a clinician turn that seeks information from the patient: a direct question, or a request such as "tell me about the pain". It ends at the last consecutive patient turn before the clinician speaks again, which is usually the very next turn.
- Include the opening question ("what can I do for you today?") and closed screening questions ("any fevers?"). A turn that asks several questions at once is one exchange.
- Exclude instructions and examination talk ("take a deep breath", "let me have a listen"), rhetorical or checking questions ("okay?", "does that make sense?"), questions the patient asks the clinician, and clinician questions that get no patient reply.
- Decide which speaker is the clinician: the one who takes the history, examines and gives the plan. Report -1 if you cannot tell.
- Use the turn numbers exactly as given. question must be less than answer_end. Exchanges must be in transcript order and must not overlap.
- Return only the JSON.`
}

export function getUserPrompt(params: RecallExchangePromptParams): string {
  const lines = params.turns.map((turn) => `[${turn.index}] Speaker ${turn.speaker}: ${turn.text}`)
  return `Transcript, one turn per line as [index] Speaker N: text.\n\n${lines.join("\n")}`
}

export const PROMPT_METADATA = {
  version: PROMPT_VERSION,
  model: MODEL_OPTIMIZED_FOR,
  description: "Question–answer exchange detection for stimulated recall",
}
