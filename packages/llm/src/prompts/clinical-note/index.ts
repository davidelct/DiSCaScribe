/**
 * Clinical Note Prompt Exports
 * Central location for managing prompt versions
 */

import * as v1 from "./v1"
import * as v2 from "./v2"
import * as v3 from "./v3"

// Default to latest version (markdown note against the SOAP template)
export const currentVersion = v3

// Export all versions for A/B testing
export { v1, v2, v3 }

// Re-export types
export type { ClinicalNotePromptParams } from "./v3"
