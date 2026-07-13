import Anthropic from "@anthropic-ai/sdk"

export interface LLMRequest {
  system: string
  prompt: string
  model?: string
  apiKey?: string
  /**
   * When provided, the response is constrained to this JSON schema via the
   * API's structured outputs (output_config.format), so the returned string is
   * guaranteed to be valid JSON matching the schema. The schema must set
   * additionalProperties: false and list every property in required.
   */
  jsonSchema?: {
    name: string
    schema: Record<string, unknown>
  }
}

/**
 * HIPAA Compliance: Validate that Anthropic SDK uses HTTPS.
 * The Anthropic SDK defaults to https://api.anthropic.com, but we validate
 * to prevent future configuration overrides that could expose PHI.
 */
function validateAnthropicHttps(client: Anthropic): void {
  // The Anthropic SDK uses https://api.anthropic.com by default
  // We validate the baseURL if it's been customized
  const baseURL = (client as Anthropic & { baseURL?: string }).baseURL || "https://api.anthropic.com"
  
  try {
    const parsed = new URL(baseURL)
    if (parsed.protocol !== "https:") {
      throw new Error(
        `SECURITY ERROR: Anthropic API endpoint must use HTTPS for HIPAA compliance. ` +
        `Received: ${parsed.protocol}//${parsed.host}`
      )
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Invalid Anthropic API URL: ${baseURL}`)
    }
    throw error
  }
}

export async function runLLMRequest({ system, prompt, model, apiKey, jsonSchema }: LLMRequest): Promise<string> {
  const anthropicApiKey = (apiKey || process.env.ANTHROPIC_API_KEY || "").trim()

  const normalizedKey = anthropicApiKey.toLowerCase()
  const looksPlaceholder =
    !anthropicApiKey ||
    normalizedKey.includes("your_key") ||
    normalizedKey.includes("your-key") ||
    normalizedKey.includes("placeholder")

  if (looksPlaceholder) {
    throw new Error(
      "ANTHROPIC_API_KEY is required. " +
      "Please configure it in Settings."
    )
  }

  const defaultModel = "claude-sonnet-5"
  const resolvedModel = model ?? defaultModel

  const client = new Anthropic({
    apiKey: anthropicApiKey,
  })

  // Validate HTTPS before sending any PHI
  validateAnthropicHttps(client)

  // Build request parameters
  const requestParams: Anthropic.MessageCreateParams = {
    model: resolvedModel,
    max_tokens: 4096,
    // Sonnet 5 turns adaptive thinking ON when `thinking` is omitted (Sonnet 4.6
    // defaulted to off). Thinking tokens share the max_tokens budget, so leaving
    // it on could truncate the note. Keep it disabled to preserve the prior
    // behaviour — flip to {type: "adaptive"} (and raise max_tokens) to trade
    // latency/cost for a potential note-quality gain.
    thinking: { type: "disabled" },
    system: system,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  }

  // Structured outputs: constrain the response to the caller's JSON schema.
  if (jsonSchema) {
    requestParams.output_config = {
      format: {
        type: "json_schema",
        schema: jsonSchema.schema,
      },
    }
  }

  const timeoutMs = Number(process.env.ANTHROPIC_TIMEOUT_MS || 45000)
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Anthropic request timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  let message: Awaited<ReturnType<typeof client.messages.create>>
  try {
    message = await Promise.race([client.messages.create(requestParams), timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }

  // Extract text content from response
  const textContent = message.content.find((block) => block.type === "text")
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text content in Anthropic response")
  }

  return textContent.text
}

// Export prompts for versioned prompt management
export * as prompts from "./prompts"
