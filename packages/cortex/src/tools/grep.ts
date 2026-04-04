/**
 * Grep tool: search file contents using regex.
 *
 * Uses the bundled ripgrep (rg) binary from @vscode/ripgrep as the
 * primary search engine. Falls back to a pure Node.js regex search
 * if the rg binary is unavailable (e.g., postinstall failed).
 *
 * Three output modes: files_with_matches, content, count.
 * Pagination via offset + head_limit.
 *
 * Reference: docs/cortex/tools/grep.md
 */

import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
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
    Type.Number({ description: 'Limit number of results. Default: 250. Pass 0 for unlimited.' }),
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

const DEFAULT_IGNORE = new Set(DEFAULT_IGNORE_PATTERNS);
const DEFAULT_HEAD_LIMIT = 250;

/** VCS directories to exclude from ripgrep searches. */
const VCS_DIRECTORIES = ['.git', '.svn', '.hg', '.bzr', '.jj', '.sl'];

/** File type to extension mapping (mimics ripgrep --type). */
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
// Ripgrep binary resolution
// ---------------------------------------------------------------------------

let resolvedRgPath: string | false | undefined;
const require = createRequire(import.meta.url);

/**
 * Get the path to the bundled ripgrep binary from @vscode/ripgrep.
 * Caches the result for the process lifetime.
 * Returns the path to rg, or false if unavailable.
 */
function getRipgrepPath(): string | false {
  if (resolvedRgPath !== undefined) return resolvedRgPath;

  try {
    // @vscode/ripgrep exports { rgPath } pointing to the downloaded binary
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { rgPath } = require('@vscode/ripgrep') as { rgPath: string };
    fs.accessSync(rgPath, fs.constants.X_OK);
    resolvedRgPath = rgPath;
    return rgPath;
  } catch {
    // Package not installed or binary not downloaded (postinstall failed)
    resolvedRgPath = false;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Ripgrep execution
// ---------------------------------------------------------------------------

/**
 * Execute ripgrep and return the output lines.
 */
function execRipgrep(
  args: string[],
  cwd: string,
): Promise<string[]> {
  const rgPath = getRipgrepPath();
  if (!rgPath) return Promise.reject(new Error('rg binary not available'));

  return new Promise((resolve, reject) => {
    child_process.execFile(
      rgPath,
      args,
      {
        cwd,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        timeout: 30_000,
        encoding: 'utf8',
      },
      (error, stdout) => {
        if (error) {
          // rg exits with code 1 when no matches found (not an error)
          const exitCode = (error as { code?: number | string }).code;
          if (exitCode === 1) {
            resolve([]);
            return;
          }
          reject(error);
          return;
        }
        const lines = stdout ? stdout.split('\n').filter(Boolean) : [];
        resolve(lines);
      },
    );
  });
}

/**
 * Convert an absolute path to relative (from cwd) to save tokens.
 */
function toRelativePath(absPath: string, cwd: string): string {
  if (!absPath.startsWith('/')) return absPath; // already relative
  const rel = path.relative(cwd, absPath);
  // Only use relative if it's shorter and doesn't escape too far
  if (rel.startsWith('../../..')) return absPath;
  return rel.length < absPath.length ? rel : absPath;
}

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------

function applyHeadLimit<T>(
  items: T[],
  limit: number | undefined,
  offset: number = 0,
): { items: T[]; truncated: boolean } {
  // Explicit 0 = unlimited
  if (limit === 0) {
    return { items: items.slice(offset), truncated: false };
  }
  const effectiveLimit = limit ?? DEFAULT_HEAD_LIMIT;
  const afterOffset = items.slice(offset);
  const truncated = afterOffset.length > effectiveLimit;
  return {
    items: afterOffset.slice(0, effectiveLimit),
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Ripgrep-based search
// ---------------------------------------------------------------------------

async function searchWithRipgrep(
  params: GrepParamsType,
  searchPath: string,
  config: GrepToolConfig,
  respectGitignore: boolean,
): Promise<ToolContentDetails<GrepDetails>> {
  const startTime = Date.now();
  const outputMode = params.output_mode ?? 'files_with_matches';
  const caseInsensitive = params['-i'] ?? false;
  const multiline = params.multiline ?? false;
  const contextLines = params.context ?? 0;
  const cwd = config.defaultCwd;

  const args: string[] = ['--hidden', '--no-require-git'];

  // When gitignore respect is disabled, tell rg to skip all ignore files
  if (!respectGitignore) {
    args.push('--no-ignore');
  }

  // Exclude VCS directories
  for (const dir of VCS_DIRECTORIES) {
    args.push('--glob', `!${dir}`);
  }

  // Apply default ignore patterns (node_modules, dist, __pycache__, etc.)
  for (const pattern of DEFAULT_IGNORE_PATTERNS) {
    args.push('--glob', `!${pattern}`);
  }

  // Limit line length to prevent base64/minified content from cluttering output
  args.push('--max-columns', '500');

  if (multiline) {
    args.push('-U', '--multiline-dotall');
  }

  if (caseInsensitive) {
    args.push('-i');
  }

  // Output mode flags
  if (outputMode === 'files_with_matches') {
    args.push('-l');
  } else if (outputMode === 'count') {
    args.push('-c');
  }

  // Line numbers for content mode
  if (outputMode === 'content') {
    args.push('-n');
    if (contextLines > 0) {
      args.push('-C', String(contextLines));
    }
  }

  // Pattern (use -e for dash-prefixed patterns)
  if (params.pattern.startsWith('-')) {
    args.push('-e', params.pattern);
  } else {
    args.push(params.pattern);
  }

  // Type filter
  if (params.type) {
    args.push('--type', params.type);
  }

  // Glob filter
  if (params.glob) {
    const rawPatterns = params.glob.split(/\s+/);
    for (const rawPattern of rawPatterns) {
      if (rawPattern.includes('{') && rawPattern.includes('}')) {
        args.push('--glob', rawPattern);
      } else {
        for (const p of rawPattern.split(',').filter(Boolean)) {
          args.push('--glob', p);
        }
      }
    }
  }

  // Always pass search path explicitly so rg returns absolute-resolvable paths
  args.push(searchPath);

  // Use the parent dir of searchPath as cwd; rg will resolve searchPath argument
  const rgCwd = path.dirname(searchPath);

  if (outputMode === 'content') {
    const rawLines = await execRipgrep(args, rgCwd);
    const durationMs = Date.now() - startTime;

    const { items: limited, truncated } = applyHeadLimit(
      rawLines,
      params.head_limit,
      params.offset ?? 0,
    );

    // Convert absolute paths in content lines to relative
    const finalLines = limited.map(line => {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const filePart = line.substring(0, colonIdx);
        if (filePart.startsWith('/')) {
          return toRelativePath(filePart, cwd) + line.substring(colonIdx);
        }
      }
      return line;
    });

    const text = finalLines.length > 0 ? finalLines.join('\n') : 'No matches found.';

    return {
      content: [{ type: 'text', text }],
      details: {
        totalFiles: 0,
        totalMatches: finalLines.length,
        durationMs,
        truncated,
        usingFallback: false,
      },
    };
  }

  if (outputMode === 'count') {
    const rawLines = await execRipgrep(args, rgCwd);
    const durationMs = Date.now() - startTime;

    const { items: limited, truncated } = applyHeadLimit(
      rawLines,
      params.head_limit,
      params.offset ?? 0,
    );

    let totalMatches = 0;
    const finalLines = limited.map(line => {
      const colonIdx = line.lastIndexOf(':');
      if (colonIdx > 0) {
        const filePart = line.substring(0, colonIdx);
        const countStr = line.substring(colonIdx + 1);
        const count = parseInt(countStr, 10);
        if (!isNaN(count)) totalMatches += count;
        return toRelativePath(filePart, cwd) + ':' + countStr;
      }
      return line;
    });

    const text = finalLines.length > 0 ? finalLines.join('\n') : 'No matches found.';

    return {
      content: [{ type: 'text', text }],
      details: {
        totalFiles: finalLines.length,
        totalMatches,
        durationMs,
        truncated,
        usingFallback: false,
      },
    };
  }

  // files_with_matches: rg returns absolute paths, sort by mtime (newest first)
  const results = await execRipgrep(args, rgCwd);
  const durationMs = Date.now() - startTime;

  const stats = await Promise.allSettled(
    results.map(f => fs.promises.stat(f)),
  );
  const sorted = results
    .map((f, i) => {
      const r = stats[i]!;
      return [f, r.status === 'fulfilled' ? (r.value.mtimeMs ?? 0) : 0] as const;
    })
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([f]) => f);

  const { items: limited, truncated } = applyHeadLimit(
    sorted,
    params.head_limit,
    params.offset ?? 0,
  );

  const relativeMatches = limited.map(f => toRelativePath(f, cwd));
  const text = relativeMatches.length > 0
    ? relativeMatches.join('\n')
    : 'No matches found.';

  return {
    content: [{ type: 'text', text }],
    details: {
      totalFiles: relativeMatches.length,
      totalMatches: results.length,
      durationMs,
      truncated,
      usingFallback: false,
    },
  };
}

// ---------------------------------------------------------------------------
// JS fallback helpers
// ---------------------------------------------------------------------------

function fileGlobToRegex(pattern: string): RegExp {
  let regex = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        regex += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
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

function matchesGitignorePattern(name: string, relativePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const cleanPattern = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
    if (!cleanPattern.includes('/')) {
      if (cleanPattern.includes('*') || cleanPattern.includes('?')) {
        if (fileGlobToRegex(cleanPattern).test(name)) return true;
      } else {
        if (name === cleanPattern) return true;
      }
    } else {
      if (fileGlobToRegex(cleanPattern).test(relativePath)) return true;
    }
  }
  return false;
}

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
    if (DEFAULT_IGNORE.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(root, fullPath).split(path.sep).join('/');

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
// JS fallback search
// ---------------------------------------------------------------------------

async function searchWithFallback(
  params: GrepParamsType,
  searchPath: string,
  config: GrepToolConfig,
  respectGitignore: boolean,
): Promise<ToolContentDetails<GrepDetails>> {
  const outputMode = params.output_mode ?? 'files_with_matches';
  const caseInsensitive = params['-i'] ?? false;
  const headLimit = params.head_limit;
  const offset = params.offset ?? 0;
  const multiline = params.multiline ?? false;
  const contextLines = params.context ?? 0;
  const startTime = Date.now();
  const cwd = config.defaultCwd;

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

  // Collect files
  let filesToSearch: string[];
  try {
    const stat = await fs.promises.stat(searchPath);
    if (stat.isFile()) {
      filesToSearch = [searchPath];
    } else if (stat.isDirectory()) {
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
        details: { totalFiles: 0, totalMatches: 0, durationMs: Date.now() - startTime, truncated: false, usingFallback: true },
      };
    }
  } catch {
    return {
      content: [{ type: 'text', text: `Path does not exist: ${searchPath}` }],
      details: { totalFiles: 0, totalMatches: 0, durationMs: Date.now() - startTime, truncated: false, usingFallback: true },
    };
  }

  // Search files
  const matchingFiles: string[] = [];
  const contentMatches: ContentMatch[] = [];
  const fileCounts: FileCount[] = [];
  let totalMatches = 0;

  for (const file of filesToSearch) {
    if (await isBinaryFile(file)) continue;

    let content: string;
    try {
      content = await fs.promises.readFile(file, 'utf8');
    } catch {
      continue;
    }

    if (multiline) {
      const matches = content.match(regex);
      if (matches && matches.length > 0) {
        totalMatches += matches.length;
        matchingFiles.push(file);

        if (outputMode === 'count') {
          fileCounts.push({ file, count: matches.length });
        } else if (outputMode === 'content') {
          regex.lastIndex = 0;
          let execMatch: RegExpExecArray | null;
          while ((execMatch = regex.exec(content)) !== null) {
            const matchIdx = execMatch.index;
            const lineNum = content.slice(0, matchIdx).split('\n').length;
            const matchText = execMatch[0];
            contentMatches.push({
              file,
              lineNumber: lineNum,
              line: matchText.length > 500 ? matchText.slice(0, 500) + '...' : matchText,
            });
          }
        }
      }
    } else {
      const lines = content.split('\n');
      let fileMatchCount = 0;
      let hasMatch = false;
      const emittedLines = new Set<number>();

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx]!;
        regex.lastIndex = 0;
        if (regex.test(line)) {
          fileMatchCount++;
          hasMatch = true;

          if (outputMode === 'content') {
            if (contextLines > 0) {
              const startCtx = Math.max(0, lineIdx - contextLines);
              const endCtx = Math.min(lines.length - 1, lineIdx + contextLines);
              for (let ci = startCtx; ci <= endCtx; ci++) {
                if (emittedLines.has(ci)) continue;
                emittedLines.add(ci);
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

  // Format output with relative paths and pagination
  let text: string;
  let truncated = false;

  if (outputMode === 'files_with_matches') {
    const result = applyHeadLimit(matchingFiles, headLimit, offset);
    truncated = result.truncated;
    const relPaths = result.items.map(f => toRelativePath(f, cwd));
    text = relPaths.length > 0 ? relPaths.join('\n') : 'No matches found.';
  } else if (outputMode === 'content') {
    let lines: string[] = [];
    let lastFile = '';

    for (const match of contentMatches) {
      if (match.file !== lastFile) {
        if (lastFile) lines.push('');
        lines.push(toRelativePath(match.file, cwd));
        lastFile = match.file;
      }
      lines.push(`${match.lineNumber}:${match.line}`);
    }

    const result = applyHeadLimit(lines, headLimit, offset);
    truncated = result.truncated;
    text = result.items.length > 0 ? result.items.join('\n') : 'No matches found.';
  } else {
    const result = applyHeadLimit(fileCounts, headLimit, offset);
    truncated = result.truncated;
    text = result.items.length > 0
      ? result.items.map((fc) => `${toRelativePath(fc.file, cwd)}:${fc.count}`).join('\n')
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

      // Use bundled ripgrep as primary engine, fall back to pure JS
      if (getRipgrepPath()) {
        try {
          return await searchWithRipgrep(params, searchPath, config, respectGitignore);
        } catch {
          // rg failed (timeout, bad args, etc.), fall back to JS
        }
      }

      return searchWithFallback(params, searchPath, config, respectGitignore);
    },
  };
}

/**
 * Reset the cached ripgrep path. Used by tests to force re-detection.
 * @internal
 */
export function _resetRipgrepCache(): void {
  resolvedRgPath = undefined;
}
