/**
 * Grep tool: search file contents using regex.
 *
 * Uses a Node.js built-in regex search for cross-platform compatibility.
 * Ripgrep binary integration is a packaging concern deferred to a future phase.
 *
 * Three output modes: files_with_matches, content, count.
 * Pagination via offset + maxResults.
 *
 * Reference: docs/cortex/tools/grep.md
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import type { ToolContentDetails } from '../types.js';
import {
  readGitignorePatterns,
  DEFAULT_IGNORE_PATTERNS,
} from './shared/gitignore.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const GrepParams = Type.Object({
  pattern: Type.String({ description: 'Regex pattern to search for' }),
  path: Type.Optional(
    Type.String({ description: 'File or directory to search in. Default: current working directory.' }),
  ),
  glob: Type.Optional(
    Type.String({ description: 'Glob pattern to filter files (e.g., "*.ts", "**/*.{js,jsx}")' }),
  ),
  type: Type.Optional(
    Type.String({ description: 'File type filter (e.g., "js", "py", "rust")' }),
  ),
  output_mode: Type.Optional(
    Type.Union([
      Type.Literal('files_with_matches'),
      Type.Literal('content'),
      Type.Literal('count'),
    ], { description: 'Output mode. Default: files_with_matches.' }),
  ),
  context: Type.Optional(
    Type.Number({ description: 'Lines of context before and after each match. Only in content mode.' }),
  ),
  '-i': Type.Optional(
    Type.Boolean({ description: 'Case insensitive search. Default: false.' }),
  ),
  head_limit: Type.Optional(
    Type.Number({ description: 'Limit number of results. Default: 0 (unlimited).' }),
  ),
  offset: Type.Optional(
    Type.Number({ description: 'Skip first N results. Default: 0.' }),
  ),
  multiline: Type.Optional(
    Type.Boolean({ description: 'Enable multiline mode where . matches newlines. Default: false.' }),
  ),
});

export type GrepParamsType = Static<typeof GrepParams>;

// ---------------------------------------------------------------------------
// Details type
// ---------------------------------------------------------------------------

export interface GrepDetails {
  totalFiles: number;
  totalMatches: number;
  durationMs: number;
  truncated: boolean;
  usingFallback: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default ignore set (for backward compatibility with collectFiles).
 * Built from the shared DEFAULT_IGNORE_PATTERNS.
 */
const DEFAULT_IGNORE = new Set(DEFAULT_IGNORE_PATTERNS);

/**
 * File type to extension mapping (mimics ripgrep --type).
 */
const TYPE_EXTENSIONS: Record<string, string[]> = {
  js: ['.js', '.jsx', '.mjs', '.cjs'],
  ts: ['.ts', '.tsx', '.mts', '.cts'],
  py: ['.py', '.pyi'],
  rust: ['.rs'],
  go: ['.go'],
  java: ['.java'],
  c: ['.c', '.h'],
  cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.h'],
  css: ['.css', '.scss', '.sass', '.less'],
  html: ['.html', '.htm'],
  json: ['.json'],
  yaml: ['.yml', '.yaml'],
  md: ['.md', '.markdown'],
  xml: ['.xml'],
  sql: ['.sql'],
  sh: ['.sh', '.bash', '.zsh'],
  ruby: ['.rb'],
  php: ['.php'],
  swift: ['.swift'],
  kotlin: ['.kt', '.kts'],
  toml: ['.toml'],
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface GrepToolConfig {
  /** Default search directory when no path param is given. */
  defaultCwd: string;
  /** Whether to respect .gitignore. Default: true. */
  respectGitignore?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple glob pattern to regex for file filtering.
 */
function fileGlobToRegex(pattern: string): RegExp {
  let regex = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        regex += '.*';
        i++; // skip second *
        if (pattern[i + 1] === '/') i++; // skip trailing /
      } else {
        regex += '[^/]*';
      }
    } else if (char === '?') {
      regex += '[^/]';
    } else if (char === '{') {
      const closeIdx = pattern.indexOf('}', i);
      if (closeIdx !== -1) {
        const alternatives = pattern.slice(i + 1, closeIdx).split(',');
        regex += '(?:' + alternatives.map((a) => a.replace(/[.*+?^$|[\]\\()]/g, '\\$&')).join('|') + ')';
        i = closeIdx;
      } else {
        regex += '\\{';
      }
    } else if (char === '.') {
      regex += '\\.';
    } else {
      regex += char;
    }
  }
  return new RegExp(`^${regex}$`);
}

/**
 * Check if a file/directory name matches any gitignore pattern.
 * Supports simple name matching and basic glob patterns.
 */
function matchesGitignorePattern(name: string, relativePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const cleanPattern = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;

    if (!cleanPattern.includes('/')) {
      // Simple name match
      if (cleanPattern.includes('*') || cleanPattern.includes('?')) {
        if (fileGlobToRegex(cleanPattern).test(name)) return true;
      } else {
        if (name === cleanPattern) return true;
      }
    } else {
      // Path pattern match
      if (fileGlobToRegex(cleanPattern).test(relativePath)) return true;
    }
  }
  return false;
}

/**
 * Recursively collect file paths, respecting ignore patterns.
 */
async function collectFiles(
  dir: string,
  fileFilter?: (relativePath: string, ext: string) => boolean,
  gitignorePatterns?: string[],
  baseDir?: string,
): Promise<string[]> {
  const results: string[] = [];
  const root = baseDir ?? dir;

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    // Always check the default ignore set
    if (DEFAULT_IGNORE.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(root, fullPath).split(path.sep).join('/');

    // Check gitignore patterns if provided
    if (gitignorePatterns && gitignorePatterns.length > 0) {
      if (matchesGitignorePattern(entry.name, relativePath, gitignorePatterns)) continue;
    }

    if (entry.isDirectory()) {
      const subResults = await collectFiles(fullPath, fileFilter, gitignorePatterns, root);
      results.push(...subResults);
    } else if (entry.isFile()) {
      if (fileFilter) {
        const ext = path.extname(entry.name).toLowerCase();
        const relName = entry.name;
        if (!fileFilter(relName, ext)) continue;
      }
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Check if a file appears to be binary by reading the first 8KB.
 */
async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const fd = await fs.promises.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(8192);
      const { bytesRead } = await fd.read(buffer, 0, 8192, 0);
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) return true;
      }
      return false;
    } finally {
      await fd.close();
    }
  } catch {
    return false;
  }
}

interface ContentMatch {
  file: string;
  lineNumber: number;
  line: string;
}

interface FileCount {
  file: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createGrepTool(config: GrepToolConfig): {
  name: string;
  description: string;
  parameters: typeof GrepParams;
  execute: (params: GrepParamsType) => Promise<ToolContentDetails<GrepDetails>>;
} {
  const respectGitignore = config.respectGitignore ?? true;

  return {
    name: 'Grep',
    description: 'Search file contents using regex patterns.',
    parameters: GrepParams,

    async execute(params: GrepParamsType): Promise<ToolContentDetails<GrepDetails>> {
      const searchPath = params.path ? path.resolve(params.path) : path.resolve(config.defaultCwd);
      const outputMode = params.output_mode ?? 'files_with_matches';
      const caseInsensitive = params['-i'] ?? false;
      const headLimit = params.head_limit ?? 0;
      const offset = params.offset ?? 0;
      const multiline = params.multiline ?? false;
      const contextLines = params.context ?? 0;
      const startTime = Date.now();

      // Build regex
      let regex: RegExp;
      try {
        let flags = 'g';
        if (caseInsensitive) flags += 'i';
        if (multiline) flags += 'ms';
        regex = new RegExp(params.pattern, flags);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Invalid regex: ${params.pattern}. ${msg}` }],
          details: {
            totalFiles: 0,
            totalMatches: 0,
            durationMs: Date.now() - startTime,
            truncated: false,
            usingFallback: true,
          },
        };
      }

      // Build file filter
      let fileFilter: ((relativePath: string, ext: string) => boolean) | undefined;

      if (params.type) {
        const typeExts = TYPE_EXTENSIONS[params.type];
        if (typeExts) {
          const extSet = new Set(typeExts);
          fileFilter = (_rel: string, ext: string) => extSet.has(ext);
        }
      }

      if (params.glob) {
        const globRegex = fileGlobToRegex(params.glob);
        const existingFilter = fileFilter;
        fileFilter = (rel: string, ext: string) => {
          if (existingFilter && !existingFilter(rel, ext)) return false;
          return globRegex.test(rel);
        };
      }

      // Check if search path is a file or directory
      let filesToSearch: string[];
      try {
        const stat = await fs.promises.stat(searchPath);
        if (stat.isFile()) {
          filesToSearch = [searchPath];
        } else if (stat.isDirectory()) {
          // Read .gitignore patterns if enabled
          let gitignorePatterns: string[] | undefined;
          if (respectGitignore) {
            const patterns = await readGitignorePatterns(searchPath);
            if (patterns.length > 0) {
              gitignorePatterns = patterns;
            }
          }
          filesToSearch = await collectFiles(searchPath, fileFilter, gitignorePatterns);
        } else {
          return {
            content: [{ type: 'text', text: `Path does not exist: ${searchPath}` }],
            details: {
              totalFiles: 0,
              totalMatches: 0,
              durationMs: Date.now() - startTime,
              truncated: false,
              usingFallback: true,
            },
          };
        }
      } catch {
        return {
          content: [{ type: 'text', text: `Path does not exist: ${searchPath}` }],
          details: {
            totalFiles: 0,
            totalMatches: 0,
            durationMs: Date.now() - startTime,
            truncated: false,
            usingFallback: true,
          },
        };
      }

      // Search files
      const matchingFiles: string[] = [];
      const contentMatches: ContentMatch[] = [];
      const fileCounts: FileCount[] = [];
      let totalMatches = 0;

      for (const file of filesToSearch) {
        // Skip binary files
        if (await isBinaryFile(file)) continue;

        let content: string;
        try {
          content = await fs.promises.readFile(file, 'utf8');
        } catch {
          continue; // Skip files we can't read
        }

        if (multiline) {
          // Multiline: search entire content
          const matches = content.match(regex);
          if (matches && matches.length > 0) {
            totalMatches += matches.length;
            matchingFiles.push(file);

            if (outputMode === 'count') {
              fileCounts.push({ file, count: matches.length });
            } else if (outputMode === 'content') {
              // For multiline, find the line numbers of each match
              const lines = content.split('\n');
              for (const match of matches) {
                const matchIdx = content.indexOf(match);
                const lineNum = content.slice(0, matchIdx).split('\n').length;
                contentMatches.push({
                  file,
                  lineNumber: lineNum,
                  line: match.length > 500 ? match.slice(0, 500) + '...' : match,
                });
              }
            }
          }
        } else {
          // Line-by-line search
          const lines = content.split('\n');
          let fileMatchCount = 0;
          let hasMatch = false;

          for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx]!;
            // Reset regex lastIndex for each line since we're using 'g' flag
            regex.lastIndex = 0;
            if (regex.test(line)) {
              fileMatchCount++;
              hasMatch = true;

              if (outputMode === 'content') {
                // Collect context lines
                if (contextLines > 0) {
                  const startCtx = Math.max(0, lineIdx - contextLines);
                  const endCtx = Math.min(lines.length - 1, lineIdx + contextLines);
                  for (let ci = startCtx; ci <= endCtx; ci++) {
                    const prefix = ci === lineIdx ? ':' : '-';
                    contentMatches.push({
                      file,
                      lineNumber: ci + 1,
                      line: `${prefix}${lines[ci]}`,
                    });
                  }
                } else {
                  contentMatches.push({
                    file,
                    lineNumber: lineIdx + 1,
                    line: lines[lineIdx]!,
                  });
                }
              }
            }
          }

          if (hasMatch) {
            totalMatches += fileMatchCount;
            matchingFiles.push(file);
            if (outputMode === 'count') {
              fileCounts.push({ file, count: fileMatchCount });
            }
          }
        }
      }

      const durationMs = Date.now() - startTime;

      // Apply offset and limit
      let text: string;
      let truncated = false;

      if (outputMode === 'files_with_matches') {
        let results = matchingFiles;
        if (offset > 0) results = results.slice(offset);
        if (headLimit > 0) {
          truncated = results.length > headLimit;
          results = results.slice(0, headLimit);
        }

        text = results.length > 0
          ? results.join('\n')
          : 'No matches found.';
      } else if (outputMode === 'content') {
        // Deduplicate context lines and format
        let lines: string[] = [];
        let lastFile = '';

        for (const match of contentMatches) {
          if (match.file !== lastFile) {
            if (lastFile) lines.push('');
            lines.push(match.file);
            lastFile = match.file;
          }
          lines.push(`${match.lineNumber}:${match.line}`);
        }

        if (offset > 0) lines = lines.slice(offset);
        if (headLimit > 0) {
          truncated = lines.length > headLimit;
          lines = lines.slice(0, headLimit);
        }

        text = lines.length > 0 ? lines.join('\n') : 'No matches found.';
      } else {
        // count mode
        let results = fileCounts;
        if (offset > 0) results = results.slice(offset);
        if (headLimit > 0) {
          truncated = results.length > headLimit;
          results = results.slice(0, headLimit);
        }

        text = results.length > 0
          ? results.map((fc) => `${fc.file}:${fc.count}`).join('\n')
          : 'No matches found.';
      }

      return {
        content: [{ type: 'text', text }],
        details: {
          totalFiles: matchingFiles.length,
          totalMatches,
          durationMs,
          truncated,
          usingFallback: true,
        },
      };
    },
  };
}
