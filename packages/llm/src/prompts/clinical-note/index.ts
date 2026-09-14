/**
 * Clinical Note Prompt Exports
 * Central location for managing prompt versions
 */

import * as v1 from "./v1"
import * as v2 from "./v2"
import * as v3 from "./v3"
import * as v4 from "./v4"

// Default to latest version (SOAP markdown with fidelity rules and worked examples)
export const currentVersion = v4

// Export all versions for A/B testing
export { v1, v2, v3, v4 }

// Re-export types
export type { ClinicalNotePromptParams } from "./v4"
