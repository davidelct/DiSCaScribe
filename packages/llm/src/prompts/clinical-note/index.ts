/**
 * Clinical Note Prompt Exports
 * Central location for managing prompt versions
 */

import * as v1 from "./v1"
import * as v2 from "./v2"

// Default to latest version (structured output)
export const currentVersion = v2

// Export all versions for A/B testing
export { v1, v2 }

// Re-export types
export type { ClinicalNotePromptParams } from "./v2"
