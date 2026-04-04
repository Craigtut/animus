/**
 * Bash tool safety layers.
 *
 * Seven layers of defense-in-depth for shell command execution:
 * 1. Environment variable stripping
 * 2. Critical path protection
 * 3. Command classification
 * 4. Path validation for write commands
 * 5. Obfuscation and injection detection
 * 6. Script preflight
 * 7. Auto-mode classifier (utility model LLM call)
 *
 * Reference: docs/cortex/tools/bash.md (Safety Architecture)
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { buildSafeEnv as buildSafeEnvShared } from '../shared/safe-env.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommandClassification =
  | 'read'
  | 'write'
  | 'create'
  | 'network'
  | 'safe-stdin'
  | 'unknown';

export interface SafetyCheckResult {
  allowed: boolean;
  reason?: string | undefined;
  classification?: CommandClassification | undefined;
}

// ---------------------------------------------------------------------------
// Layer 1: Environment Variable Security
// ---------------------------------------------------------------------------

/**
 * Build a safe environment for child processes by stripping dangerous variables.
 * Adds CORTEX_SHELL=exec as a context marker.
 *
 * Delegates to the shared buildSafeEnv utility so that both the Bash tool
 * and the MCP client use the same blocklist.
 *
 * @param parentEnv - The source environment (typically process.env)
 * @param overrides - Optional env var overrides that bypass the blocklist
 */
export function buildSafeEnv(
  parentEnv: NodeJS.ProcessEnv,
  overrides?: Record<string, string>,
): Record<string, string> {
  return buildSafeEnvShared(parentEnv, 'exec', overrides);
}

// ---------------------------------------------------------------------------
// Layer 2: Critical Path Protection
// ---------------------------------------------------------------------------

const UNIX_CRITICAL_PATHS = [
  '/',
  '/usr',
  '/etc',
  '/boot',
  '/sbin',
  '/var',
  '/System',
  '/proc',
  '/sys',
];

const MACOS_CRITICAL_PATHS = [
  path.join(process.env['HOME'] ?? '', 'Library'),
];

const WINDOWS_CRITICAL_PATHS = [
  'C:\\Windows',
  'C:\\Windows\\System32',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
];

/**
 * Check if a target path resolves to a critical system directory.
 */
export function isCriticalPath(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const normalized = resolved.replace(/\\/g, '/').replace(/\/+$/, '');

  const criticalPaths = process.platform === 'win32'
    ? WINDOWS_CRITICAL_PATHS
    : [...UNIX_CRITICAL_PATHS, ...(process.platform === 'darwin' ? MACOS_CRITICAL_PATHS : [])];

  for (const cp of criticalPaths) {
    const normalizedCp = cp.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalized === normalizedCp || normalized.toLowerCase() === normalizedCp.toLowerCase()) {
      return true;
    }
  }

  // Check for Windows AppData
  if (process.platform === 'win32') {
    const userProfile = process.env['USERPROFILE'];
    if (userProfile) {
      const appDataPath = path.join(userProfile, 'AppData').replace(/\\/g, '/');
      if (normalized.toLowerCase().startsWith(appDataPath.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Layer 3: Command Classification
// ---------------------------------------------------------------------------

const UNIX_READ_COMMANDS = new Set([
  'cd', 'ls', 'find', 'cat', 'head', 'tail', 'sort', 'wc', 'diff',
  'grep', 'echo', 'pwd', 'env', 'which', 'file', 'stat', 'strings',
  'hexdump', 'less', 'more', 'tree',
]);

const UNIX_WRITE_COMMANDS = new Set([
  'rm', 'rmdir', 'mv', 'cp', 'chmod', 'chown',
]);

const UNIX_CREATE_COMMANDS = new Set([
  'mkdir', 'touch', 'tee',
]);

const UNIX_NETWORK_COMMANDS = new Set([
  'curl', 'wget', 'ssh', 'scp', 'rsync', 'nc', 'nmap',
]);

const UNIX_SAFE_STDIN_COMMANDS = new Set([
  'jq', 'cut', 'uniq', 'head', 'tail', 'tr', 'wc',
]);

const PS_READ_COMMANDS = new Set([
  'get-content', 'get-childitem', 'get-item', 'get-location',
  'select-string', 'compare-object', 'test-path', 'get-process',
  'dir', 'type', 'where',
]);

const PS_WRITE_COMMANDS = new Set([
  'remove-item', 'move-item', 'copy-item', 'set-content',
  'rename-item', 'set-itemproperty',
]);

const PS_CREATE_COMMANDS = new Set([
  'new-item', 'out-file', 'add-content',
]);

const PS_NETWORK_COMMANDS = new Set([
  'invoke-webrequest', 'invoke-restmethod', 'test-netconnection', 'ssh',
]);

/**
 * Git subcommands that are read-only.
 */
const GIT_READ_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'show', 'branch', 'tag', 'remote', 'stash',
  'blame', 'shortlog', 'describe', 'rev-parse', 'ls-files', 'ls-tree',
]);

/**
 * Safe-stdin denied flags per binary.
 */
const SAFE_STDIN_DENIED_FLAGS: Record<string, Set<string>> = {
  grep: new Set(['-r', '-R', '-d', '-f', '--recursive', '--dereference-recursive', '--directories', '--file', '--exclude-from']),
  jq: new Set(['-f', '-L', '--from-file', '--library-path', '--argfile', '--rawfile', '--slurpfile']),
  sort: new Set(['-o', '-T', '--output', '--temporary-directory', '--compress-program', '--files0-from', '--random-source']),
  wc: new Set(['--files0-from']),
};

/**
 * Split a command string on shell operators (; && || |) while respecting
 * quoted strings. Returns the individual sub-commands.
 */
export function splitOnShellOperators(command: string): string[] {
  const subCommands: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let i = 0;

  while (i < command.length) {
    const ch = command[i]!;

    if (escaped) {
      current += ch;
      escaped = false;
      i++;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      current += ch;
      i++;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      i++;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      i++;
      continue;
    }

    // Only split when outside quotes
    if (!inSingle && !inDouble) {
      // Check for && or ||
      if ((ch === '&' && command[i + 1] === '&') || (ch === '|' && command[i + 1] === '|')) {
        if (current.trim()) subCommands.push(current.trim());
        current = '';
        i += 2;
        continue;
      }

      // Check for single pipe (not ||) or semicolon
      if (ch === ';' || (ch === '|' && command[i + 1] !== '|')) {
        if (current.trim()) subCommands.push(current.trim());
        current = '';
        i++;
        continue;
      }
    }

    current += ch;
    i++;
  }

  if (current.trim()) subCommands.push(current.trim());

  return subCommands;
}

/**
 * Extract the command name from a single (non-compound) command string.
 */
function extractCommandName(singleCommand: string): string {
  const trimmed = singleCommand.trim();
  // Handle 'sed -i' specifically
  if (/^sed\s+.*-i/.test(trimmed)) return 'sed-i';

  // Get the first token (the command name)
  const tokens = trimmed.split(/\s+/);
  return (tokens[0] ?? '').toLowerCase();
}

/**
 * Risk ordering from lowest to highest. Used to pick the most dangerous
 * classification when a compound command contains multiple sub-commands.
 */
const CLASSIFICATION_RISK_ORDER: readonly CommandClassification[] = [
  'read',
  'safe-stdin',
  'create',
  'write',
  'network',
  'unknown',
];

/**
 * Return the higher-risk classification of two values.
 */
function higherRisk(a: CommandClassification, b: CommandClassification): CommandClassification {
  const aIdx = CLASSIFICATION_RISK_ORDER.indexOf(a);
  const bIdx = CLASSIFICATION_RISK_ORDER.indexOf(b);
  return aIdx >= bIdx ? a : b;
}

/**
 * Classify a single (non-compound) command by its potential impact.
 */
function classifySingleCommand(singleCommand: string): CommandClassification {
  const cmdName = extractCommandName(singleCommand);
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    const psCmd = cmdName.toLowerCase();
    if (PS_READ_COMMANDS.has(psCmd)) return 'read';
    if (PS_WRITE_COMMANDS.has(psCmd)) return 'write';
    if (PS_CREATE_COMMANDS.has(psCmd)) return 'create';
    if (PS_NETWORK_COMMANDS.has(psCmd)) return 'network';
    // Handle PS aliases
    if (psCmd === 'curl' || psCmd === 'wget') return 'network';
    return 'unknown';
  }

  // Unix
  // Handle git subcommands
  if (cmdName === 'git') {
    const parts = singleCommand.trim().split(/\s+/);
    const subcommand = parts[1]?.toLowerCase();
    if (subcommand && GIT_READ_SUBCOMMANDS.has(subcommand)) return 'read';
    return 'unknown';
  }

  // Handle sed -i (write)
  if (cmdName === 'sed-i') return 'write';

  if (UNIX_READ_COMMANDS.has(cmdName)) return 'read';
  if (UNIX_WRITE_COMMANDS.has(cmdName)) return 'write';
  if (UNIX_CREATE_COMMANDS.has(cmdName)) return 'create';
  if (UNIX_NETWORK_COMMANDS.has(cmdName)) return 'network';

  // Check safe-stdin
  if (UNIX_SAFE_STDIN_COMMANDS.has(cmdName)) {
    // Verify no denied flags and no file args
    const tokens = singleCommand.trim().split(/\s+/);
    const deniedFlags = SAFE_STDIN_DENIED_FLAGS[cmdName];
    if (deniedFlags) {
      for (const token of tokens.slice(1)) {
        if (deniedFlags.has(token)) return 'unknown';
      }
    }
    // Check for path-like positional arguments (simple heuristic)
    const args = tokens.slice(1).filter((t) => !t.startsWith('-'));
    const hasPathArgs = args.some((a) => a.includes('/') || a.includes('.'));
    if (hasPathArgs) return 'unknown';

    return 'safe-stdin';
  }

  return 'unknown';
}

/**
 * Classify a command (potentially compound) by its potential impact.
 * For compound commands, returns the highest-risk classification
 * among all sub-commands.
 */
export function classifyCommand(command: string): CommandClassification {
  const subCommands = splitOnShellOperators(command);
  if (subCommands.length === 0) return 'unknown';

  let result: CommandClassification = classifySingleCommand(subCommands[0]!);
  for (let i = 1; i < subCommands.length; i++) {
    result = higherRisk(result, classifySingleCommand(subCommands[i]!));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Layer 4: Path Validation
// ---------------------------------------------------------------------------

/**
 * Extract target paths from write/create commands in a single sub-command.
 */
function extractWritePathsFromSingle(singleCommand: string): string[] {
  const paths: string[] = [];
  const tokens = singleCommand.trim().split(/\s+/);
  const cmd = (tokens[0] ?? '').toLowerCase();

  if (['rm', 'rmdir', 'mv', 'cp', 'touch', 'mkdir'].includes(cmd)) {
    // Last argument(s) that aren't flags
    for (let i = tokens.length - 1; i > 0; i--) {
      const token = tokens[i]!;
      if (!token.startsWith('-')) {
        paths.push(token);
        // For rm, rmdir, touch, mkdir - all non-flag args are targets
        // For mv, cp - last arg is destination
        if (['mv', 'cp'].includes(cmd)) break;
      }
    }
  }

  return paths;
}

/**
 * Extract target paths from write/create commands.
 * Returns the paths that would be modified by the command.
 * Handles compound commands by extracting paths from all sub-commands.
 */
export function extractWritePaths(command: string): string[] {
  const subCommands = splitOnShellOperators(command);
  const paths: string[] = [];
  for (const sub of subCommands) {
    paths.push(...extractWritePathsFromSingle(sub));
  }
  return paths;
}

/**
 * Resolve a path, following symlinks when the target exists.
 * Falls back to path.resolve() if the path does not yet exist.
 */
function resolveWithSymlinks(targetPath: string): string {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    // Path does not exist yet (e.g., mkdir for a new directory), fall back
    return path.resolve(targetPath);
  }
}

/**
 * Validate that write paths are within the allowed working directory.
 */
export function validateWritePaths(
  command: string,
  workingDirectory: string,
  currentCwd: string,
): SafetyCheckResult {
  const classification = classifyCommand(command);
  if (classification !== 'write' && classification !== 'create') {
    return { allowed: true, classification };
  }

  const writePaths = extractWritePaths(command);
  for (const wp of writePaths) {
    // Resolve relative to current CWD, then resolve symlinks
    const rawResolved = path.resolve(currentCwd, wp);
    const resolved = resolveWithSymlinks(rawResolved);

    // Check critical paths
    if (isCriticalPath(resolved)) {
      return {
        allowed: false,
        reason: 'This command would modify a critical system directory. This cannot be auto-allowed.',
        classification,
      };
    }
  }

  return { allowed: true, classification };
}

// ---------------------------------------------------------------------------
// Layer 5: Obfuscation and Injection Detection
// ---------------------------------------------------------------------------

/**
 * Strip invisible Unicode characters that could be used for obfuscation.
 */
export function stripInvisibleChars(command: string): string {
  // Zero-width characters, BiDi markers, variation selectors, tag characters
  return command.replace(
    /[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD\u034F\u061C\u180E\u2060-\u2069\uFFF9-\uFFFB\u{E0001}-\u{E007F}\u{FE00}-\u{FE0F}]/gu,
    '',
  );
}

/**
 * Safe URL allowlist for download-and-execute patterns.
 */
const SAFE_DOWNLOAD_URLS: Array<{ host: string; pathPrefix?: string | undefined }> = [
  { host: 'brew.sh' },
  { host: 'get.pnpm.io' },
  { host: 'bun.sh', pathPrefix: '/install' },
  { host: 'sh.rustup.rs' },
  { host: 'get.docker.com' },
  { host: 'install.python-poetry.org' },
  { host: 'raw.githubusercontent.com', pathPrefix: '/Homebrew/' },
  { host: 'raw.githubusercontent.com', pathPrefix: '/nvm-sh/nvm/' },
];

/**
 * Check if a URL is in the safe download allowlist.
 */
function isSafeDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Reject URLs with credentials
    if (parsed.username || parsed.password) return false;

    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    for (const entry of SAFE_DOWNLOAD_URLS) {
      if (host === entry.host || host === `www.${entry.host}`) {
        if (!entry.pathPrefix || pathname.startsWith(entry.pathPrefix)) {
          return true;
        }
      }
    }
  } catch {
    // Invalid URL
  }
  return false;
}

/**
 * Extract URLs from a command string.
 */
function extractUrls(command: string): string[] {
  const urlRegex = /https?:\/\/[^\s'"]+/g;
  return command.match(urlRegex) ?? [];
}

interface ObfuscationPattern {
  pattern: RegExp;
  description: string;
  /** When true, only match against unquoted portions of the command. */
  quoteAware?: boolean;
}

/**
 * Unix obfuscation and injection patterns.
 */
const UNIX_OBFUSCATION_PATTERNS: ObfuscationPattern[] = [
  // Encoded execution
  { pattern: /base64\s+(-d|--decode)\s*\|.*\b(ba)?sh\b/i, description: 'Base64 decode piped to shell' },
  { pattern: /xxd\s+-r\s*\|.*\b(ba)?sh\b/i, description: 'Hex decode piped to shell' },
  { pattern: /printf\s+.*\\x.*\|.*\b(ba)?sh\b/i, description: 'Printf escape sequences piped to shell' },
  // Eval injection
  { pattern: /\beval\s+.*(\$\(|`|base64|\\x|\\[0-7])/i, description: 'Eval with encoded/obfuscated input' },
  // Heredoc execution
  { pattern: /<<\s*['"]?\w+['"]?\s*\n.*\b(ba)?sh\b/is, description: 'Heredoc used to construct and execute commands' },
  // Escape sequences
  { pattern: /\$'\\[0-7]{3}.*\\[0-7]{3}'/, description: 'Bash octal escape sequences constructing commands' },
  { pattern: /\$'\\x[0-9a-f]{2}.*\\x[0-9a-f]{2}'/i, description: 'Bash hex escape sequences constructing commands' },
  // Polyglot injection
  { pattern: /python[23]?\s+-c\s+.*(?:base64|eval|exec|__import__)/i, description: 'Python with obfuscation patterns' },
  { pattern: /perl\s+-e\s+.*(?:eval|unpack|decode_base64)/i, description: 'Perl with obfuscation patterns' },
  { pattern: /ruby\s+-e\s+.*(?:eval|Base64|decode64)/i, description: 'Ruby with obfuscation patterns' },
  // Variable obfuscation
  { pattern: /\w+=[^;]*;\s*\w+=[^;]*;\s*\$\{?\w+\}?\$\{?\w+\}?/i, description: 'Variable assignment chains constructing commands' },
  // Process substitution with remote content
  { pattern: /<\(.*(?:curl|wget|nc)\s+/i, description: 'Remote content via process substitution' },
  // Shell metacharacters — uses quote-aware matching in checkObfuscation()
  // so that legitimate regex patterns inside quotes (e.g., grep "foo\|bar") are not flagged.
  { pattern: /\\[;&|]/, description: 'Backslash-escaped operators or whitespace', quoteAware: true },
  { pattern: /[\u200B\u200C\u200D\uFEFF\u00A0]/, description: 'Unicode whitespace characters' },
  { pattern: /[\x00-\x08\x0E-\x1F]/, description: 'Control characters in command' },
  { pattern: /\w#\w/, description: 'Mid-word hash (potential comment injection)' },
  { pattern: /['"]-+\w/, description: 'Obfuscated flags via quotes' },
  // Structural
  { pattern: /#.*['"].*\n/, description: 'Comment/quote desync pattern' },
  { pattern: /'[^']*\n[^']*'/, description: 'Embedded newlines in single-quoted strings' },
  { pattern: /[|;&]\s*$/, description: 'Incomplete command (trailing pipe or semicolon)' },
  // NOTE: IFS manipulation and /proc access are handled by dedicated
  // quote-aware validators below (checkIfsInjection, checkProcSysAccess).
];

/**
 * PowerShell obfuscation patterns.
 */
const PS_OBFUSCATION_PATTERNS: ObfuscationPattern[] = [
  { pattern: /-EncodedCommand\b/i, description: 'PowerShell encoded command' },
  { pattern: /\[Convert\]::FromBase64String.*\|\s*iex/i, description: 'Base64 decode piped to Invoke-Expression' },
  { pattern: /Invoke-Expression\s+.*(\+|\[char\]|\.Replace)/i, description: 'Invoke-Expression with constructed strings' },
  { pattern: /Net\.WebClient.*DownloadString.*\|\s*iex/i, description: 'Download cradle piped to iex' },
  { pattern: /Invoke-WebRequest.*\|\s*iex/i, description: 'Web request piped to Invoke-Expression' },
  { pattern: /Start-Process.*-WindowStyle\s+Hidden/i, description: 'Hidden process execution' },
  { pattern: /\[Reflection\.Assembly\]::Load/i, description: 'Reflection-based assembly loading' },
  { pattern: /-ExecutionPolicy\s+Bypass/i, description: 'Execution policy bypass' },
];

/**
 * Strip the content of single-quoted and double-quoted strings from a command,
 * preserving the quotes themselves. This lets obfuscation patterns check only
 * the unquoted portions of a command so that legitimate regex syntax inside
 * quotes (e.g., grep "foo\|bar") is not flagged as shell obfuscation.
 */
function stripQuotedContent(command: string): string {
  return command.replace(/"[^"]*"|'[^']*'/g, (match) => {
    // Preserve the quote characters but empty the content
    const quote = match[0];
    return `${quote}${quote}`;
  });
}

// ---------------------------------------------------------------------------
// Quote State Machine (shared utility for quote-aware validators)
// ---------------------------------------------------------------------------

/**
 * Per-character quote context. Describes the quoting state at a given position.
 */
export type QuoteContext = 'none' | 'single' | 'double' | 'backtick' | 'escaped';

/**
 * Analyze the quoting context of each character in a shell command.
 * Returns an array of QuoteContext values, one per character, indicating
 * whether that position is inside single quotes, double quotes, backticks,
 * escaped, or unquoted. Handles nested escapes correctly (e.g., `\"` inside
 * double quotes keeps the next character as "double", not "escaped").
 */
export function analyzeQuoteState(command: string): QuoteContext[] {
  const states: QuoteContext[] = new Array(command.length);
  let context: 'none' | 'single' | 'double' | 'backtick' = 'none';
  // Track the context to return to when a backtick closes (for backtick-in-double-quote)
  let returnContext: 'none' | 'double' = 'none';

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;

    if (context === 'single') {
      // Inside single quotes, only a closing single quote ends the context.
      // No escape processing at all inside single quotes.
      if (ch === "'") {
        states[i] = 'none';
        context = 'none';
      } else {
        states[i] = 'single';
      }
      continue;
    }

    if (context === 'double') {
      // Inside double quotes, backslash only escapes: $, `, ", \, and newline.
      if (ch === '\\' && i + 1 < command.length) {
        const next = command[i + 1]!;
        if ('$`"\\'.includes(next) || next === '\n') {
          states[i] = 'escaped';
          states[i + 1] = 'escaped';
          i++; // skip the escaped character
          continue;
        }
      }
      if (ch === '"') {
        states[i] = 'none';
        context = 'none';
      } else if (ch === '`') {
        // Backticks nest inside double quotes. Track return context so we
        // resume double-quote context when the backtick closes.
        states[i] = 'backtick';
        returnContext = 'double';
        context = 'backtick';
      } else {
        states[i] = 'double';
      }
      continue;
    }

    if (context === 'backtick') {
      if (ch === '\\' && i + 1 < command.length) {
        states[i] = 'escaped';
        states[i + 1] = 'escaped';
        i++;
        continue;
      }
      if (ch === '`') {
        states[i] = returnContext === 'double' ? 'double' : 'none';
        context = returnContext;
        returnContext = 'none';
      } else {
        states[i] = 'backtick';
      }
      continue;
    }

    // context === 'none' (unquoted)
    if (ch === '\\' && i + 1 < command.length) {
      states[i] = 'escaped';
      states[i + 1] = 'escaped';
      i++;
      continue;
    }

    if (ch === "'") {
      states[i] = 'single'; // the quote character itself is "in" single-quote context
      context = 'single';
      continue;
    }

    if (ch === '"') {
      states[i] = 'double';
      context = 'double';
      continue;
    }

    if (ch === '`') {
      states[i] = 'backtick';
      context = 'backtick';
      continue;
    }

    states[i] = 'none';
  }

  return states;
}

/**
 * Extract the unquoted portions of a command using the quote state machine.
 * Returns a string where quoted characters are replaced with spaces (preserving
 * positions) so that regex matches on the result correspond to unquoted regions.
 */
function getUnquotedText(command: string, states: QuoteContext[]): string {
  const chars: string[] = [];
  for (let i = 0; i < command.length; i++) {
    chars.push(states[i] === 'none' ? command[i]! : ' ');
  }
  return chars.join('');
}

// ---------------------------------------------------------------------------
// Validator 2: Enhanced IFS Injection
// ---------------------------------------------------------------------------

/**
 * Detect IFS variable manipulation in unquoted context.
 * `IFS=` inside quotes is harmless (just a string literal).
 * Unquoted `IFS=` is a shell variable assignment that can enable attacks.
 */
export function checkIfsInjection(command: string, states: QuoteContext[]): SafetyCheckResult {
  const unquoted = getUnquotedText(command, states);
  if (/\bIFS\s*=/.test(unquoted)) {
    return {
      allowed: false,
      reason: 'Obfuscation pattern detected: IFS variable manipulation',
    };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Validator 3: Enhanced proc/sys Access
// ---------------------------------------------------------------------------

/**
 * Sensitive paths under /proc and /sys that can be used for exfiltration
 * or system introspection attacks.
 */
const PROC_SYS_PATTERNS: RegExp[] = [
  // /proc exfiltration vectors
  /\/proc\/[^/]*\/environ/,
  /\/proc\/[^/]*\/cmdline/,
  /\/proc\/[^/]*\/maps/,
  /\/proc\/[^/]*\/mem\b/,
  /\/proc\/[^/]*\/fd\//,
  /\/proc\/[^/]*\/exe\b/,
  /\/proc\/[^/]*\/cwd\b/,
  /\/proc\/[^/]*\/root\b/,
  /\/proc\/[^/]*\/mountinfo/,
  /\/proc\/[^/]*\/status/,
  // /sys sensitive paths
  /\/sys\/class\/net\b/,
  /\/sys\/kernel\//,
  /\/sys\/firmware\//,
  /\/sys\/fs\/cgroup\//,
];

/**
 * Detect access to sensitive /proc and /sys paths in unquoted context.
 * Quoted references (e.g., `echo "/proc/self/environ"`) are harmless string
 * literals. Unquoted references indicate actual filesystem access attempts.
 */
export function checkProcSysAccess(command: string, states: QuoteContext[]): SafetyCheckResult {
  const unquoted = getUnquotedText(command, states);
  for (const pattern of PROC_SYS_PATTERNS) {
    if (pattern.test(unquoted)) {
      return {
        allowed: false,
        reason: 'Obfuscation pattern detected: Access to sensitive /proc or /sys path',
      };
    }
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Validator 4: jq system() Blocking
// ---------------------------------------------------------------------------

/**
 * Detect jq command abuse: system() calls, @sh filter for shell injection,
 * and -n with module imports that could load malicious jq modules.
 */
export function checkJqAbuse(command: string): SafetyCheckResult {
  // Only check commands that invoke jq
  if (!/\bjq\b/.test(command)) {
    return { allowed: true };
  }

  // Block jq filters containing system( -- executes shell commands from jq
  // Use dotAll (s) flag so multi-line jq filters are caught
  if (/\bjq\b.*\bsystem\s*\(/s.test(command)) {
    return {
      allowed: false,
      reason: 'Obfuscation pattern detected: jq system() call can execute arbitrary shell commands',
    };
  }

  // Block @sh filter used for shell injection
  if (/\bjq\b.*@sh\b/s.test(command)) {
    return {
      allowed: false,
      reason: 'Obfuscation pattern detected: jq @sh filter can be used for shell injection',
    };
  }

  // Block jq -n with import/include (module loading)
  if (/\bjq\b\s+.*-n\b.*\b(import|include)\b/s.test(command) || /\bjq\b\s+.*\b(import|include)\b.*-n\b/s.test(command)) {
    return {
      allowed: false,
      reason: 'Obfuscation pattern detected: jq module import with -n flag',
    };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Validator 5: ANSI-C Quoting Detection
// ---------------------------------------------------------------------------

/**
 * Detect ANSI-C quoting ($'...') with hex or octal escape sequences that
 * encode potentially dangerous content. Simple escapes like $'\n' and $'\t'
 * are legitimate and allowed.
 */
export function checkAnsiCQuoting(command: string): SafetyCheckResult {
  // Match $'...' patterns. We need to find all ANSI-C quoted strings and
  // check if they contain hex (\xHH) or octal (\0NNN or \NNN with 3 digits) escapes.
  const ansiCPattern = /\$'([^'\\]*(?:\\.[^'\\]*)*)'/g;
  let match: RegExpExecArray | null;

  while ((match = ansiCPattern.exec(command)) !== null) {
    const content = match[1] ?? '';

    // Check for hex escapes (\xHH)
    const hasHex = /\\x[0-9a-fA-F]{2}/.test(content);
    // Check for octal escapes (\0NNN or \NNN where N are 3 octal digits)
    const hasOctal = /\\0[0-7]{1,3}/.test(content) || /\\[1-3][0-7]{2}/.test(content);

    if (hasHex || hasOctal) {
      return {
        allowed: false,
        reason: 'Obfuscation pattern detected: ANSI-C quoting with hex/octal escapes can encode hidden commands',
      };
    }
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Validator 6: Enhanced Heredoc Validation
// ---------------------------------------------------------------------------

/**
 * Detect heredoc patterns and validate their content. Unquoted heredoc
 * delimiters (<<EOF) allow variable expansion and command substitution in
 * the body, which can be used for injection. Quoted delimiters (<<'EOF')
 * are treated as literal text and are safe.
 */
export function checkHeredocInjection(command: string): SafetyCheckResult {
  // Match heredoc operators: <<[-]?DELIMITER or <<[-]?"DELIMITER" or <<[-]?'DELIMITER'
  // We look for the delimiter, then try to find the body if it is inline (multi-line command).
  const heredocPattern = /<<-?\s*(["']?)(\w+)\1/g;
  let match: RegExpExecArray | null;

  while ((match = heredocPattern.exec(command)) !== null) {
    const quoteChar = match[1] ?? '';
    const delimiter = match[2] ?? '';
    const isQuoted = quoteChar !== '';

    if (isQuoted || !delimiter) {
      // Quoted heredocs are safe (no expansion), skip
      continue;
    }

    // For unquoted heredocs, check if the body (text after the delimiter line
    // and before the closing delimiter) contains injection patterns.
    const afterMatch = command.substring(match.index + match[0].length);

    // The body starts after a newline following the heredoc operator
    const newlineIdx = afterMatch.indexOf('\n');
    if (newlineIdx === -1) continue; // no body present in the command string

    const bodyAndRest = afterMatch.substring(newlineIdx + 1);
    const closingPattern = new RegExp(`^${delimiter}\\s*$`, 'm');
    const closingMatch = closingPattern.exec(bodyAndRest);
    const body = closingMatch ? bodyAndRest.substring(0, closingMatch.index) : bodyAndRest;

    // Check the heredoc body for injection patterns
    const injectionPatterns = [
      /\$\(/, // command substitution
      /`[^`]+`/, // backtick command substitution
      /\$\{.*[^}]*\}/, // parameter expansion with manipulation
    ];

    for (const pattern of injectionPatterns) {
      if (pattern.test(body)) {
        return {
          allowed: false,
          reason: 'Obfuscation pattern detected: Unquoted heredoc with command substitution in body',
        };
      }
    }
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Validator 7: Brace Expansion Detection
// ---------------------------------------------------------------------------

/**
 * Detect brace expansion patterns ({a,b} or {1..N}) in unquoted context
 * that target suspicious paths or combine with dangerous commands.
 */
export function checkBraceExpansion(command: string, states: QuoteContext[]): SafetyCheckResult {
  const unquoted = getUnquotedText(command, states);

  // Find {x,y} patterns in unquoted text. Only flag when combined with
  // destructive commands or when referencing sensitive system paths.
  // Benign patterns like `diff {old,new}/config.ts` should pass.
  const commaExpansion = /\{[^}]*,[^}]*\}/g;
  let match: RegExpExecArray | null;

  // Extract leading command for context-aware decisions
  const firstToken = unquoted.trim().split(/\s+/)[0] ?? '';
  const destructiveCommands = ['rm', 'chmod', 'chown', 'mv', 'rmdir', 'dd', 'shred'];

  while ((match = commaExpansion.exec(unquoted)) !== null) {
    const content = match[0];
    // Flag if expansion references sensitive paths
    if (/\betc\b|passwd|shadow|authorized_keys|\bssh\b|\bproc\b|\bsys\b/.test(content)) {
      return {
        allowed: false,
        reason: 'Obfuscation pattern detected: Brace expansion referencing sensitive paths',
      };
    }
    // Flag if any element starts with absolute path AND command is destructive
    if (/\{\/|,\s*\//.test(content) && destructiveCommands.includes(firstToken.toLowerCase())) {
      return {
        allowed: false,
        reason: 'Obfuscation pattern detected: Brace expansion with absolute paths in destructive command',
      };
    }
  }

  // Check for range expansion {N..M} combined with dangerous commands.
  // Look at the first token of the overall command to determine context.
  const rangeExpansion = /\{[^}]*\.\.[^}]*\}/g;
  if (rangeExpansion.test(unquoted)) {
    // Extract the leading command name from the unquoted text
    const firstToken = unquoted.trim().split(/\s+/)[0] ?? '';
    const destructiveCommands = ['rm', 'chmod', 'chown', 'mv', 'cp'];
    if (destructiveCommands.includes(firstToken.toLowerCase())) {
      return {
        allowed: false,
        reason: 'Obfuscation pattern detected: Brace range expansion with destructive command',
      };
    }
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Validator 8: Enhanced Escaped Character Detection
// ---------------------------------------------------------------------------

/**
 * Detect escape chains and printf hex/octal patterns that can hide dangerous
 * commands from string-level pattern matching.
 */
export function checkEnhancedEscapes(command: string, states: QuoteContext[]): SafetyCheckResult {
  // Detect double-backslash before shell operators in unquoted context.
  // In "echo hello\\;rm", the state machine marks both backslashes as escaped
  // (the first escapes the second), leaving ";" as unquoted (none). We look
  // for an escaped pair where the raw characters are both backslashes, followed
  // immediately by an unquoted shell operator.
  const shellOps = new Set([';', '&', '|']);
  for (let i = 0; i + 2 < command.length; i++) {
    if (
      states[i] === 'escaped' &&
      states[i + 1] === 'escaped' &&
      command[i] === '\\' &&
      command[i + 1] === '\\' &&
      states[i + 2] === 'none' &&
      shellOps.has(command[i + 2]!)
    ) {
      return {
        allowed: false,
        reason: 'Obfuscation pattern detected: Double-escaped shell operator (live operator hidden behind escape chain)',
      };
    }
  }

  // Detect printf with hex/octal that spells dangerous commands.
  // We look for printf calls with multiple escape sequences.
  const printfMatch = command.match(/\bprintf\s+(['"])((?:\\x[0-9a-fA-F]{2}|\\[0-7]{3}){3,})\1/);
  if (printfMatch) {
    return {
      allowed: false,
      reason: 'Obfuscation pattern detected: printf with encoded character sequences',
    };
  }

  // Also catch printf with %b and hex/octal in a variable
  if (/\bprintf\s+['"]?%b['"]?\s+.*(?:\\x[0-9a-fA-F]{2}|\\[0-7]{3}){3,}/.test(command)) {
    return {
      allowed: false,
      reason: 'Obfuscation pattern detected: printf %b with encoded character sequences',
    };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Main obfuscation check
// ---------------------------------------------------------------------------

/**
 * Check a command for obfuscation and injection patterns.
 */
export function checkObfuscation(command: string): SafetyCheckResult {
  // Strip invisible characters first
  const cleaned = stripInvisibleChars(command);

  // Check if the cleaned command differs significantly (invisible chars were present)
  if (cleaned.length < command.length) {
    return {
      allowed: false,
      reason: 'Command contains invisible Unicode characters that may be used for obfuscation.',
    };
  }

  // Length check
  if (command.length > 10000) {
    return {
      allowed: false,
      reason: 'Command exceeds maximum length (10,000 characters).',
    };
  }

  // Check download-and-execute pattern (curl | bash)
  const hasPipeToShell = /\|\s*(ba)?sh\b/i.test(command) || /\|\s*\bsh\b/.test(command);
  if (hasPipeToShell && /(curl|wget)\s+/i.test(command)) {
    const urls = extractUrls(command);
    if (urls.length === 1 && isSafeDownloadUrl(urls[0]!)) {
      // Safe URL, allow
    } else {
      return {
        allowed: false,
        reason: 'Download-and-execute pattern detected (curl/wget piped to shell). This requires explicit approval.',
      };
    }
  }

  // Platform-specific patterns
  const patterns = process.platform === 'win32'
    ? PS_OBFUSCATION_PATTERNS
    : UNIX_OBFUSCATION_PATTERNS;

  // Quote-stripped version for patterns where matches inside quoted strings
  // are benign (e.g., backslash-escaped operators in grep regex patterns).
  const unquotedCommand = stripQuotedContent(command);

  for (const { pattern, description, quoteAware } of patterns) {
    // Quote-aware patterns only match against unquoted portions of the command.
    // e.g., "echo test\;rm -rf /" is obfuscation (unquoted), but
    // "grep 'foo\|bar'" is legitimate grep regex (inside quotes).
    const target = quoteAware ? unquotedCommand : command;
    if (pattern.test(target)) {
      return {
        allowed: false,
        reason: `Obfuscation pattern detected: ${description}`,
      };
    }
  }

  // --- Enhanced validators (quote-state-machine-powered) ---

  const quoteStates = analyzeQuoteState(command);

  // Validator 2: Enhanced IFS injection (quote-aware)
  const ifsResult = checkIfsInjection(command, quoteStates);
  if (!ifsResult.allowed) return ifsResult;

  // Validator 3: Enhanced proc/sys access (quote-aware)
  const procResult = checkProcSysAccess(command, quoteStates);
  if (!procResult.allowed) return procResult;

  // Validator 4: jq system() blocking
  const jqResult = checkJqAbuse(command);
  if (!jqResult.allowed) return jqResult;

  // Validator 5: ANSI-C quoting detection
  const ansiCResult = checkAnsiCQuoting(command);
  if (!ansiCResult.allowed) return ansiCResult;

  // Validator 6: Enhanced heredoc validation
  const heredocResult = checkHeredocInjection(command);
  if (!heredocResult.allowed) return heredocResult;

  // Validator 7: Brace expansion detection
  const braceResult = checkBraceExpansion(command, quoteStates);
  if (!braceResult.allowed) return braceResult;

  // Validator 8: Enhanced escaped character detection
  const escapeResult = checkEnhancedEscapes(command, quoteStates);
  if (!escapeResult.allowed) return escapeResult;

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Layer 6: Script Preflight
// ---------------------------------------------------------------------------

/**
 * Check if a command is running a script file, and if so,
 * scan the script for shell syntax bleed.
 */
export async function checkScriptPreflight(command: string, cwd: string): Promise<SafetyCheckResult> {
  // Detect script execution patterns
  const scriptPatterns = [
    /^python[23]?\s+(\S+)/i,
    /^node\s+(\S+)/i,
    /^ts-node\s+(\S+)/i,
    /^ruby\s+(\S+)/i,
    /^perl\s+(\S+)/i,
  ];

  for (const pattern of scriptPatterns) {
    const match = command.match(pattern);
    if (!match?.[1]) continue;

    const scriptPath = path.resolve(cwd, match[1]);

    try {
      const content = await fs.promises.readFile(scriptPath, 'utf8');
      const firstLines = content.split('\n').slice(0, 10);

      // Check for bare $VARS in Python/JS files
      const ext = path.extname(scriptPath).toLowerCase();
      if (['.py', '.js', '.ts', '.mjs', '.cjs'].includes(ext)) {
        for (const line of firstLines) {
          // Shell variable patterns that don't belong in Python/JS
          if (/^\s*\$[A-Z_]+\b/.test(line) && !/^\s*\/\//.test(line) && !/^\s*#/.test(line)) {
            return {
              allowed: false,
              reason: `Script ${scriptPath} contains shell variable syntax ($VAR) that may indicate shell syntax bleed.`,
            };
          }
        }
      }

      // Check for shell commands at start of script
      if (['.py', '.js', '.ts'].includes(ext)) {
        const firstLine = (firstLines[0] ?? '').trim();
        if (/^(cd|ls|cat|echo|export|source|alias)\s/.test(firstLine) && !firstLine.startsWith('#!')) {
          return {
            allowed: false,
            reason: `Script ${scriptPath} starts with shell commands, suggesting mixed file contexts.`,
          };
        }
      }
    } catch {
      // Can't read script file, skip check
    }
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Layer 7: Auto-Mode Classifier (Stub)
// ---------------------------------------------------------------------------

/**
 * Auto-mode classifier that uses the utility model to classify whether
 * a command should be blocked in autonomous mode.
 *
 * The full implementation will:
 * 1. Fast check (256 max tokens): quick classification
 * 2. Full analysis (4096 max tokens): if fast check is uncertain
 *
 * Fail-safe behavior: when auto-approve mode is active (isAutoApprove=true)
 * but no classifier function is available, this layer BLOCKS the command.
 * When auto-approve is not active, the consumer's permission resolver
 * (beforeToolCall) has already approved, so this layer passes through.
 */
export async function checkAutoModeClassifier(
  _command: string,
  _description: string | undefined,
  _utilityComplete?: ((context: unknown) => Promise<unknown>) | undefined,
  isAutoApprove?: boolean,
): Promise<SafetyCheckResult> {
  // When auto-approve is not active, the consumer's permission system has
  // already handled approval. Layer 7 is defense-in-depth for auto mode only.
  if (!isAutoApprove) {
    return { allowed: true };
  }

  // Auto-approve is active but no classifier function is available.
  // Fail-safe: block until the classifier is fully implemented.
  if (!_utilityComplete) {
    return {
      allowed: false,
      reason: 'Auto-mode classifier not yet implemented. Command requires manual approval.',
    };
  }

  // TODO: Full implementation will call utilityComplete for classification.
  // For now, block in auto-approve mode even with a utility model, since
  // the classification prompt/logic is not yet built.
  return {
    allowed: false,
    reason: 'Auto-mode classifier not yet implemented. Command requires manual approval.',
  };
}

// ---------------------------------------------------------------------------
// Composite safety check
// ---------------------------------------------------------------------------

/**
 * Run all safety layers on a command.
 * Returns the first failure or { allowed: true } if all pass.
 */
export async function runSafetyChecks(
  command: string,
  workingDirectory: string,
  currentCwd: string,
  options?: {
    utilityComplete?: ((context: unknown) => Promise<unknown>) | undefined;
    description?: string | undefined;
    /** Whether the consumer is in auto-approve mode. When true and no classifier is available, Layer 7 blocks. */
    isAutoApprove?: boolean | undefined;
  },
): Promise<SafetyCheckResult> {
  // Layer 2: Critical path protection
  // Check each sub-command independently for critical path access
  const subCommands = splitOnShellOperators(command);
  for (const sub of subCommands) {
    const subTokens = sub.split(/\s+/);
    for (const token of subTokens) {
      if (token.startsWith('/') || token.startsWith('~') || (process.platform === 'win32' && /^[A-Za-z]:\\/.test(token))) {
        if (isCriticalPath(token)) {
          const subClassification = classifySingleCommand(sub);
          if (subClassification === 'write' || subClassification === 'create' || subClassification === 'unknown') {
            return {
              allowed: false,
              reason: 'This command would modify a critical system directory. This cannot be auto-allowed.',
              classification: classifyCommand(command),
            };
          }
        }
      }
    }
  }

  // Layer 4: Path validation for write commands (handles all sub-commands)
  const pathResult = validateWritePaths(command, workingDirectory, currentCwd);
  if (!pathResult.allowed) return pathResult;

  // Layer 5: Obfuscation detection
  const obfuscationResult = checkObfuscation(command);
  if (!obfuscationResult.allowed) return obfuscationResult;

  // Layer 6: Script preflight
  const scriptResult = await checkScriptPreflight(command, currentCwd);
  if (!scriptResult.allowed) return scriptResult;

  // Layer 7: Auto-mode classifier
  const classifierResult = await checkAutoModeClassifier(
    command,
    options?.description,
    options?.utilityComplete,
    options?.isAutoApprove,
  );
  if (!classifierResult.allowed) return classifierResult;

  return {
    allowed: true,
    classification: classifyCommand(command),
  };
}
