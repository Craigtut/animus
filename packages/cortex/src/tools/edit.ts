/**
 * Edit tool: make precise string replacements in existing files.
 *
 * Supports exact string matching with a uniqueness constraint
 * (when replaceAll is false). Enforces read-before-edit via ReadRegistry.
 * Handles line ending normalization for cross-platform compatibility.
 *
 * Reference: docs/cortex/tools/edit.md
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import type { ReadRegistry } from './shared/read-registry.js';
import type { ToolContentDetails } from '../types.js';
import type { DiffHunk } from './write.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const EditParams = Type.Object({
  file_path: Type.String({ description: 'Absolute path to the file to edit' }),
  old_string: Type.String({ description: 'The exact text to find and replace' }),
  new_string: Type.String({ description: 'The replacement text (must differ from old_string)' }),
  replace_all: Type.Optional(
    Type.Boolean({
      description: 'Replace all occurrences. Default: false (replace first unique match).',
      default: false,
    }),
  ),
});

export type EditParamsType = Static<typeof EditParams>;

// ---------------------------------------------------------------------------
// Details type
// ---------------------------------------------------------------------------

export interface EditDetails {
  filePath: string;
  oldString: string;
  newString: string;
  replacementCount: number;
  replaceAll: boolean;
  diff: DiffHunk[];
  originalContent: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface EditToolConfig {
  readRegistry: ReadRegistry;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count non-overlapping occurrences of a substring in a string.
 */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

/**
 * Compute a line-level diff between old and new content.
 */
function computeEditDiff(oldContent: string, newContent: string): DiffHunk[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const hunks: DiffHunk[] = [];

  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (oldIdx < oldLines.length && newIdx < newLines.length && oldLines[oldIdx] === newLines[newIdx]) {
      oldIdx++;
      newIdx++;
      continue;
    }

    const hunkOldStart = oldIdx + 1;
    const hunkNewStart = newIdx + 1;
    const hunkLines: string[] = [];

    const contextLookAhead = 3;
    let matchFound = false;

    while (!matchFound && (oldIdx < oldLines.length || newIdx < newLines.length)) {
      if (oldIdx < oldLines.length && newIdx < newLines.length) {
        let allMatch = true;
        for (let k = 0; k < contextLookAhead; k++) {
          if (oldIdx + k >= oldLines.length || newIdx + k >= newLines.length) {
            break;
          }
          if (oldLines[oldIdx + k] !== newLines[newIdx + k]) {
            allMatch = false;
            break;
          }
        }
        if (allMatch && oldLines[oldIdx] === newLines[newIdx]) {
          matchFound = true;
          break;
        }
      }

      if (oldIdx < oldLines.length && (newIdx >= newLines.length || oldLines[oldIdx] !== newLines[newIdx])) {
        hunkLines.push(`-${oldLines[oldIdx]}`);
        oldIdx++;
      }

      if (newIdx < newLines.length && (oldIdx >= oldLines.length || oldLines[oldIdx] !== newLines[newIdx])) {
        hunkLines.push(`+${newLines[newIdx]}`);
        newIdx++;
      }

      if (oldIdx >= oldLines.length && newIdx >= newLines.length) {
        break;
      }
    }

    if (hunkLines.length > 0) {
      const removedCount = hunkLines.filter((l) => l.startsWith('-')).length;
      const addedCount = hunkLines.filter((l) => l.startsWith('+')).length;
      hunks.push({
        oldStart: hunkOldStart,
        oldLines: removedCount,
        newStart: hunkNewStart,
        newLines: addedCount,
        lines: hunkLines,
      });
    }
  }

  return hunks;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createEditTool(config: EditToolConfig): {
  name: string;
  description: string;
  parameters: typeof EditParams;
  execute: (params: EditParamsType) => Promise<ToolContentDetails<EditDetails>>;
} {
  const { readRegistry } = config;

  return {
    name: 'Edit',
    description: 'Make precise string replacements in an existing file.',
    parameters: EditParams,

    async execute(params: EditParamsType): Promise<ToolContentDetails<EditDetails>> {
      const filePath = path.resolve(params.file_path);
      const oldString = params.old_string;
      const newString = params.new_string;
      const replaceAll = params.replace_all ?? false;

      // Check identical strings
      if (oldString === newString) {
        return {
          content: [{ type: 'text', text: 'old_string and new_string are identical. No change needed.' }],
          details: {
            filePath,
            oldString,
            newString,
            replacementCount: 0,
            replaceAll,
            diff: [],
            originalContent: '',
          },
        };
      }

      // Check file exists
      try {
        await fs.promises.stat(filePath);
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          return {
            content: [{ type: 'text', text: `File does not exist: ${filePath}` }],
            details: {
              filePath,
              oldString,
              newString,
              replacementCount: 0,
              replaceAll,
              diff: [],
              originalContent: '',
            },
          };
        }
        if (code === 'EACCES') {
          return {
            content: [{ type: 'text', text: `Permission denied: ${filePath}` }],
            details: {
              filePath,
              oldString,
              newString,
              replacementCount: 0,
              replaceAll,
              diff: [],
              originalContent: '',
            },
          };
        }
        throw err;
      }

      // Enforce read-before-edit
      if (!readRegistry.hasBeenRead(filePath)) {
        return {
          content: [{ type: 'text', text: 'You must Read this file before editing it.' }],
          details: {
            filePath,
            oldString,
            newString,
            replacementCount: 0,
            replaceAll,
            diff: [],
            originalContent: '',
          },
        };
      }

      // Read the file content
      const originalContent = await fs.promises.readFile(filePath, 'utf8');

      // Normalize line endings for matching: \r\n -> \n
      // We'll do matching on normalized content but track whether the
      // original had \r\n so we can preserve the original style.
      const hadCRLF = originalContent.includes('\r\n');
      const normalizedContent = originalContent.replace(/\r\n/g, '\n');
      const normalizedOldString = oldString.replace(/\r\n/g, '\n');
      const normalizedNewString = newString.replace(/\r\n/g, '\n');

      // Count occurrences in normalized content
      const matchCount = countOccurrences(normalizedContent, normalizedOldString);

      if (matchCount === 0) {
        return {
          content: [{ type: 'text', text: 'The specified text was not found in the file.' }],
          details: {
            filePath,
            oldString,
            newString,
            replacementCount: 0,
            replaceAll,
            diff: [],
            originalContent,
          },
        };
      }

      // Uniqueness constraint when replaceAll is false
      if (!replaceAll && matchCount > 1) {
        return {
          content: [{
            type: 'text',
            text: `Found ${matchCount} matches. Provide more surrounding context to uniquely identify the edit location.`,
          }],
          details: {
            filePath,
            oldString,
            newString,
            replacementCount: 0,
            replaceAll,
            diff: [],
            originalContent,
          },
        };
      }

      // Perform the replacement
      let newNormalizedContent: string;
      let replacementCount: number;

      if (replaceAll) {
        newNormalizedContent = normalizedContent.split(normalizedOldString).join(normalizedNewString);
        replacementCount = matchCount;
      } else {
        // Replace first (and only) occurrence
        const idx = normalizedContent.indexOf(normalizedOldString);
        newNormalizedContent =
          normalizedContent.slice(0, idx) +
          normalizedNewString +
          normalizedContent.slice(idx + normalizedOldString.length);
        replacementCount = 1;
      }

      // Restore original line ending style if it was CRLF
      const finalContent = hadCRLF
        ? newNormalizedContent.replace(/\n/g, '\r\n')
        : newNormalizedContent;

      // Compute diff
      const diff = computeEditDiff(originalContent, finalContent);

      // Atomic write: write to temp file, then rename
      const tempPath = path.join(path.dirname(filePath), `.edit-${crypto.randomUUID()}.tmp`);
      try {
        await fs.promises.writeFile(tempPath, finalContent, 'utf8');
        try {
          await fs.promises.rename(tempPath, filePath);
        } catch {
          // Rename may fail on Windows if target is open. Fall back to direct write.
          await fs.promises.writeFile(filePath, finalContent, 'utf8');
          try { await fs.promises.unlink(tempPath); } catch { /* ignore */ }
        }
      } catch (writeErr) {
        try { await fs.promises.unlink(tempPath); } catch { /* ignore */ }
        throw writeErr;
      }

      const plural = replacementCount === 1 ? 'replacement' : 'replacements';
      return {
        content: [{ type: 'text', text: `Made ${replacementCount} ${plural} in ${filePath}` }],
        details: {
          filePath,
          oldString,
          newString,
          replacementCount,
          replaceAll,
          diff,
          originalContent,
        },
      };
    },
  };
}
