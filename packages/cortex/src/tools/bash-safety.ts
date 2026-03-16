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
 * Variables to strip from child process environment.
 */
const BLOCKED_ENV_PREFIXES = ['LD_', 'DYLD_', 'BASH_FUNC_'];

const BLOCKED_ENV_VARS = new Set([
  // Runtime loaders
  'NODE_OPTIONS', 'NODE_PATH',
  'PYTHONPATH', 'PYTHONHOME',
  'PERL5LIB', 'PERL5OPT',
  'RUBYLIB', 'RUBYOPT',
  // Shell startup injection
  'BASH_ENV', 'ENV', 'SHELLOPTS', 'PS4', 'IFS', 'PROMPT_COMMAND', 'ZDOTDIR',
  // Git execution
  'GIT_EXTERNAL_DIFF', 'GIT_EXEC_PATH', 'GIT_SSH_COMMAND',
  // Security-sensitive
  'SSLKEYLOGFILE', 'GCONV_PATH', 'OPENSSL_CONF', 'CURL_HOME', 'WGETRC',
]);

/**
 * Build a safe environment for child processes by stripping dangerous variables.
 * Adds CORTEX_SHELL=exec as a context marker.
 */
export function buildSafeEnv(parentEnv: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue;

    // Check exact match
    if (BLOCKED_ENV_VARS.has(key)) continue;

    // Check prefix match
    let blocked = false;
    for (const prefix of BLOCKED_ENV_PREFIXES) {
      if (key.startsWith(prefix)) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    env[key] = value;
  }

  // Add context marker
  env['CORTEX_SHELL'] = 'exec';

  return env;
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
 * Extract the first command from a shell command string.
 * Handles pipes, semicolons, and && chains by taking the first token.
 */
function extractFirstCommand(command: string): string {
  const trimmed = command.trim();
  // Handle 'sed -i' specifically
  if (/^sed\s+.*-i/.test(trimmed)) return 'sed-i';

  // Split on pipes, semicolons, &&, ||
  const parts = trimmed.split(/[;|&]+/);
  const firstPart = (parts[0] ?? '').trim();

  // Get the first token (the command name)
  const tokens = firstPart.split(/\s+/);
  return (tokens[0] ?? '').toLowerCase();
}

/**
 * Classify a command by its potential impact.
 */
export function classifyCommand(command: string): CommandClassification {
  const firstCmd = extractFirstCommand(command);
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    const psCmd = firstCmd.toLowerCase();
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
  if (firstCmd === 'git') {
    const parts = command.trim().split(/\s+/);
    const subcommand = parts[1]?.toLowerCase();
    if (subcommand && GIT_READ_SUBCOMMANDS.has(subcommand)) return 'read';
    return 'unknown';
  }

  // Handle sed -i (write)
  if (firstCmd === 'sed-i') return 'write';

  if (UNIX_READ_COMMANDS.has(firstCmd)) return 'read';
  if (UNIX_WRITE_COMMANDS.has(firstCmd)) return 'write';
  if (UNIX_CREATE_COMMANDS.has(firstCmd)) return 'create';
  if (UNIX_NETWORK_COMMANDS.has(firstCmd)) return 'network';

  // Check safe-stdin
  if (UNIX_SAFE_STDIN_COMMANDS.has(firstCmd)) {
    // Verify no denied flags and no file args
    const tokens = command.trim().split(/\s+/);
    const deniedFlags = SAFE_STDIN_DENIED_FLAGS[firstCmd];
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

// ---------------------------------------------------------------------------
// Layer 4: Path Validation
// ---------------------------------------------------------------------------

/**
 * Extract target paths from write/create commands.
 * Returns the paths that would be modified by the command.
 */
export function extractWritePaths(command: string): string[] {
  const paths: string[] = [];
  const tokens = command.trim().split(/\s+/);
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
    // Resolve relative to current CWD
    const resolved = path.resolve(currentCwd, wp);

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

/**
 * Unix obfuscation and injection patterns.
 */
const UNIX_OBFUSCATION_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
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
  // IFS manipulation
  { pattern: /\bIFS\s*=/, description: 'IFS variable manipulation' },
  // /proc access
  { pattern: /\/proc\/[^/]*\/environ/, description: 'Access to process environment via /proc' },
];

/**
 * PowerShell obfuscation patterns.
 */
const PS_OBFUSCATION_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
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

  for (const { pattern, description } of patterns) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        reason: `Obfuscation pattern detected: ${description}`,
      };
    }
  }

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
 * Placeholder for the auto-mode classifier that uses the utility model
 * to classify whether a command should be blocked in autonomous mode.
 *
 * The full implementation will:
 * 1. Fast check (256 max tokens): quick classification
 * 2. Full analysis (4096 max tokens): if fast check is uncertain
 *
 * For now, this always returns allowed (no-op).
 * Will be wired to utilityComplete in a later phase.
 */
export async function checkAutoModeClassifier(
  _command: string,
  _description: string | undefined,
  _utilityComplete?: (context: unknown) => Promise<unknown>,
): Promise<SafetyCheckResult> {
  // Stub: always allow. Full implementation requires utility model integration.
  return { allowed: true };
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
  },
): Promise<SafetyCheckResult> {
  // Layer 2: Critical path protection
  // Quick check for explicit paths in the command
  const tokens = command.split(/\s+/);
  for (const token of tokens) {
    if (token.startsWith('/') || token.startsWith('~') || (process.platform === 'win32' && /^[A-Za-z]:\\/.test(token))) {
      if (isCriticalPath(token)) {
        const classification = classifyCommand(command);
        if (classification === 'write' || classification === 'create' || classification === 'unknown') {
          return {
            allowed: false,
            reason: 'This command would modify a critical system directory. This cannot be auto-allowed.',
            classification,
          };
        }
      }
    }
  }

  // Layer 4: Path validation for write commands
  const pathResult = validateWritePaths(command, workingDirectory, currentCwd);
  if (!pathResult.allowed) return pathResult;

  // Layer 5: Obfuscation detection
  const obfuscationResult = checkObfuscation(command);
  if (!obfuscationResult.allowed) return obfuscationResult;

  // Layer 6: Script preflight
  const scriptResult = await checkScriptPreflight(command, currentCwd);
  if (!scriptResult.allowed) return scriptResult;

  // Layer 7: Auto-mode classifier (stub)
  const classifierResult = await checkAutoModeClassifier(
    command,
    options?.description,
    options?.utilityComplete,
  );
  if (!classifierResult.allowed) return classifierResult;

  return {
    allowed: true,
    classification: classifyCommand(command),
  };
}
