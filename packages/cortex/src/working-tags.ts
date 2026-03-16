/**
 * Working tags parser.
 *
 * Separates agent text into user-facing and working (internal reasoning)
 * content based on <working> XML tag delimiters.
 *
 * Parsing rules:
 * - Tags are flat delimiters: <working> opens, </working> closes. No nesting.
 * - Multiple <working> blocks are concatenated (newline-separated) in `working`.
 * - Whitespace between closing </working> tag and subsequent text is normalized.
 * - Unclosed <working> tag: all content after the opening tag is treated as working.
 * - Simple regex, not a full XML parser.
 *
 * Reference: working-tags.md
 */

import type { AgentTextOutput } from './types.js';

/**
 * Regex pattern for matching working tag blocks.
 *
 * Matches <working>...</working> pairs (non-greedy) and captures the content.
 * The `s` flag makes `.` match newlines so working content can span multiple lines.
 * The `g` flag finds all blocks in the text.
 */
const WORKING_TAG_PATTERN = /<working>(.*?)<\/working>/gs;

/**
 * Pattern for detecting an unclosed <working> tag at the end of the text.
 * Captures everything after the last unclosed <working> tag.
 */
const UNCLOSED_TAG_PATTERN = /<working>([\s\S]*)$/;

/**
 * Strip all <working> tag content from text, returning only user-facing content.
 * Whitespace is normalized: consecutive whitespace collapsed, trimmed.
 *
 * @param text - Raw agent text potentially containing <working> tags
 * @returns User-facing text with all working content removed
 */
export function stripWorkingTags(text: string): string {
  // Replace closed <working>...</working> blocks with a newline sentinel.
  // This ensures a clean break between content that was separated by a working block.
  // The sentinel is used instead of directly removing to enable whitespace normalization.
  let result = text.replace(WORKING_TAG_PATTERN, '\n');

  // Handle any unclosed <working> tag at the end
  result = result.replace(UNCLOSED_TAG_PATTERN, '');

  // Normalize whitespace:
  // 1. Collapse spaces/tabs around newlines into just the newline
  // 2. Collapse 3+ newlines to 2 (preserve paragraph breaks)
  result = result
    .replace(/[ \t]*\n[ \t]*/g, '\n')  // normalize spaces around newlines
    .replace(/\n{3,}/g, '\n\n')         // collapse 3+ newlines to 2
    .trim();

  return result;
}

/**
 * Extract content from inside <working> tags.
 * Multiple blocks are concatenated with newline separators.
 * Returns null if no working tags are found.
 *
 * @param text - Raw agent text potentially containing <working> tags
 * @returns Concatenated working content, or null if none found
 */
export function extractWorkingContent(text: string): string | null {
  const blocks: string[] = [];

  // Reset regex lastIndex since we reuse the global pattern
  WORKING_TAG_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = WORKING_TAG_PATTERN.exec(text)) !== null) {
    const content = match[1];
    if (content !== undefined && content.trim().length > 0) {
      blocks.push(content.trim());
    }
  }

  // Check for unclosed tag
  // We need to check if there's an unclosed <working> AFTER the last closed block
  const lastClosingIndex = text.lastIndexOf('</working>');
  const lastOpeningIndex = text.lastIndexOf('<working>');

  if (lastOpeningIndex > lastClosingIndex) {
    // There is an unclosed tag after all closed blocks
    const unclosedContent = text.slice(lastOpeningIndex + '<working>'.length);
    if (unclosedContent.trim().length > 0) {
      blocks.push(unclosedContent.trim());
    }
  }

  if (blocks.length === 0) {
    return null;
  }

  return blocks.join('\n');
}

/**
 * Parse text into structured AgentTextOutput with user-facing and working segments.
 *
 * This is the primary parsing function used by CortexAgent at turn completion.
 * It combines stripWorkingTags and extractWorkingContent into a single result.
 *
 * @param text - Raw agent text potentially containing <working> tags
 * @returns Structured output with userFacing, working, and raw properties
 */
export function parseWorkingTags(text: string): AgentTextOutput {
  return {
    userFacing: stripWorkingTags(text),
    working: extractWorkingContent(text),
    raw: text,
  };
}
