/**
 * Write tool: create a new file or overwrite an existing file.
 *
 * Enforces the read-before-write contract via ReadRegistry.
 * Performs atomic writes (write to temp, then rename) to prevent
 * partial writes on crash. Creates parent directories as needed.
 *
 * Reference: docs/cortex/tools/write.md
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import type { ReadRegistry } from './shared/read-registry.js';
import type { ToolContentDetails } from '../types.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const WriteParams = Type.Object({
  file_path: Type.String({ description: 'Absolute path to the file to write (must be absolute, not relative)' }),
  content: Type.String({ description: 'The full content to write to the file' }),
});

export type WriteParamsType = Static<typeof WriteParams>;

// ---------------------------------------------------------------------------
// Details type
// ---------------------------------------------------------------------------

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface WriteDetails {
  filePath: string;
  isCreate: boolean;
  bytesWritten: number;
  diff: DiffHunk[] | null;
  originalContent: string | null;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface WriteToolConfig {
  readRegistry: ReadRegistry;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a simple line-level diff between two strings.
 * Returns an array of diff hunks suitable for UI rendering.
 */
function computeDiff(oldContent: string, newContent: string): DiffHunk[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const hunks: DiffHunk[] = [];

  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    // Skip matching lines
    if (oldIdx < oldLines.length && newIdx < newLines.length && oldLines[oldIdx] === newLines[newIdx]) {
      oldIdx++;
      newIdx++;
      continue;
    }

    // Found a difference - collect the hunk
    const hunkOldStart = oldIdx + 1;
    const hunkNewStart = newIdx + 1;
    const hunkLines: string[] = [];

    // Collect all differing lines until we find a match
    const contextLookAhead = 3;
    let matchFound = false;

    while (!matchFound && (oldIdx < oldLines.length || newIdx < newLines.length)) {
      // Check if the next few lines match
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

      // Record removed lines from old
      if (oldIdx < oldLines.length && (newIdx >= newLines.length || oldLines[oldIdx] !== newLines[newIdx])) {
        hunkLines.push(`-${oldLines[oldIdx]}`);
        oldIdx++;
      }

      // Record added lines from new
      if (newIdx < newLines.length && (oldIdx >= oldLines.length || oldLines[oldIdx] !== newLines[newIdx])) {
        hunkLines.push(`+${newLines[newIdx]}`);
        newIdx++;
      }

      // Safety: prevent infinite loop on edge cases
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

export function createWriteTool(config: WriteToolConfig): {
  name: string;
  description: string;
  parameters: typeof WriteParams;
  execute: (params: WriteParamsType) => Promise<ToolContentDetails<WriteDetails>>;
} {
  const { readRegistry } = config;

  return {
    name: 'Write',
    description: 'Create a new file or overwrite an existing file on the local filesystem.',
    parameters: WriteParams,

    async execute(params: WriteParamsType): Promise<ToolContentDetails<WriteDetails>> {
      const filePath = path.resolve(params.file_path);
      const newContent = params.content;

      // Check if file exists
      let fileExists = false;
      let originalContent: string | null = null;
      try {
        const stat = await fs.promises.stat(filePath);
        fileExists = stat.isFile();
      } catch {
        // File does not exist - that's fine for creation
      }

      // Enforce read-before-write for existing files
      if (fileExists && !readRegistry.hasBeenRead(filePath)) {
        return {
          content: [{ type: 'text', text: 'You must Read this file before overwriting it.' }],
          details: {
            filePath,
            isCreate: false,
            bytesWritten: 0,
            diff: null,
            originalContent: null,
          },
        };
      }

      // Read original content for diff (existing files only)
      if (fileExists) {
        try {
          originalContent = await fs.promises.readFile(filePath, 'utf8');
        } catch {
          // If we can't read for diff, continue without it
        }
      }

      // Create parent directories
      const parentDir = path.dirname(filePath);
      try {
        await fs.promises.mkdir(parentDir, { recursive: true });
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EACCES') {
          return {
            content: [{ type: 'text', text: `Cannot create directory: ${parentDir}` }],
            details: {
              filePath,
              isCreate: !fileExists,
              bytesWritten: 0,
              diff: null,
              originalContent,
            },
          };
        }
        throw err;
      }

      // Atomic write: write to temp file, then rename
      const tempPath = path.join(parentDir, `.write-${crypto.randomUUID()}.tmp`);
      try {
        await fs.promises.writeFile(tempPath, newContent, 'utf8');
        try {
          await fs.promises.rename(tempPath, filePath);
        } catch {
          // Rename may fail on Windows if target is open. Fall back to direct write.
          await fs.promises.writeFile(filePath, newContent, 'utf8');
          // Clean up temp file
          try {
            await fs.promises.unlink(tempPath);
          } catch {
            // Ignore cleanup errors
          }
        }
      } catch (err: unknown) {
        // Clean up temp file on error
        try {
          await fs.promises.unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }

        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EACCES') {
          return {
            content: [{ type: 'text', text: `Permission denied: ${filePath}` }],
            details: {
              filePath,
              isCreate: !fileExists,
              bytesWritten: 0,
              diff: null,
              originalContent,
            },
          };
        }
        if (code === 'ENOSPC') {
          return {
            content: [{ type: 'text', text: `Disk full. Cannot write to: ${filePath}` }],
            details: {
              filePath,
              isCreate: !fileExists,
              bytesWritten: 0,
              diff: null,
              originalContent,
            },
          };
        }
        if (code === 'ENAMETOOLONG') {
          return {
            content: [{ type: 'text', text: `Path exceeds system limit: ${filePath}` }],
            details: {
              filePath,
              isCreate: !fileExists,
              bytesWritten: 0,
              diff: null,
              originalContent,
            },
          };
        }
        throw err;
      }

      // Mark as read (so subsequent edits work)
      readRegistry.markRead(filePath);

      const bytesWritten = Buffer.byteLength(newContent, 'utf8');
      const isCreate = !fileExists;

      // Compute diff for updates
      const diff = originalContent !== null ? computeDiff(originalContent, newContent) : null;

      const verb = isCreate ? 'Created' : 'Updated';
      return {
        content: [{ type: 'text', text: `${verb} ${filePath} (${bytesWritten} bytes)` }],
        details: {
          filePath,
          isCreate,
          bytesWritten,
          diff,
          originalContent,
        },
      };
    },
  };
}
