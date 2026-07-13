/**
 * Markdown-based clinical note model
 * 
 * Replaces the JSON-based approach with simple markdown parsing.
 * This makes it easier for contributors to work with note formats
 * without dealing with JSON schemas or strict data structures.
 */

/**
 * Parse a markdown clinical note into sections
 * Extracts content under level 2 headings (##)
 */
export function parseMarkdownNote(markdown: string): Record<string, string> {
  const sections: Record<string, string> = {};
  
  // Split by level 2 headings
  const lines = markdown.split('\n');
  let currentSection: string | null = null;
  let currentContent: string[] = [];
  
  for (const line of lines) {
    // Check if this is a level 2 heading
    const headingMatch = line.match(/^##\s+(.+)$/);
    
    if (headingMatch) {
      // Save previous section if any
      if (currentSection) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      
      // Start new section
      currentSection = headingMatch[1].trim();
      currentContent = [];
    } else if (currentSection) {
      // Add content to current section (skip level 1 heading)
      if (!line.match(/^#\s+/)) {
        currentContent.push(line);
      }
    }
  }
  
  // Save the last section
  if (currentSection) {
    sections[currentSection] = currentContent.join('\n').trim();
  }
  
  return sections;
}

/**
 * Format markdown note for display
 * Simply returns the markdown as-is
 */
export function formatMarkdownNote(markdown: string): string {
  return markdown.trim();
}

/**
 * Validate that required sections exist in the markdown note
 */
export function validateMarkdownNote(markdown: string): {
  valid: boolean;
  missingSections: string[];
} {
  const sections = parseMarkdownNote(markdown);
  const requiredSections = [
    'Subjective',
    'Objective',
    'Assessment',
    'Plan'
  ];
  
  const missingSections = requiredSections.filter(
    section => !sections[section] || sections[section].length === 0
  );
  
  return {
    valid: missingSections.length === 0,
    missingSections
  };
}

/**
 * Create an empty markdown note template
 */
export function createEmptyMarkdownNote(): string {
  return `## Subjective


## Objective


## Assessment


## Plan

`;
}

/**
 * Extract content from markdown that may be wrapped in code fences
 */
export function extractMarkdownFromResponse(response: string): string {
  // Remove markdown code fences if present
  const fencePattern = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/;
  const match = response.trim().match(fencePattern);
  
  if (match) {
    return match[1].trim();
  }
  
  return response.trim();
}

/**
 * Normalize SOAP section headings to standard format
 * Handles abbreviations and casing variations (e.g. "S" -> "Subjective")
 */
export function normalizeMarkdownSections(markdown: string): string {
  const sectionMappings: Record<string, string> = {
    'S': 'Subjective',
    'subjective': 'Subjective',
    'SUBJECTIVE': 'Subjective',
    'O': 'Objective',
    'objective': 'Objective',
    'OBJECTIVE': 'Objective',
    'A': 'Assessment',
    'assessment': 'Assessment',
    'ASSESSMENT': 'Assessment',
    'P': 'Plan',
    'plan': 'Plan',
    'PLAN': 'Plan',
  };
  
  let normalized = markdown;
  
  for (const [variant, standard] of Object.entries(sectionMappings)) {
    const regex = new RegExp(`^##\\s+${variant}\\s*$`, 'gm');
    normalized = normalized.replace(regex, `## ${standard}`);
  }
  
  return normalized;
}
