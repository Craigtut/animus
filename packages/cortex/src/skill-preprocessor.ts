/**
 * Skill Preprocessor: processes SKILL.md body at load time.
 *
 * Three preprocessor types run in order:
 * 1. Variable substitution: ${VAR}, $ARGUMENTS, $N
 * 2. Shell commands: !`command` (parallel execution)
 * 3. Script execution: !{script: path} (parallel execution)
 *
 * Shell commands use the same shell selection logic as the Bash tool
 * (PowerShell on Windows, bash/zsh on Unix).
 *
 * References:
 *   - docs/cortex/skill-system.md
 *   - docs/cortex/cross-platform-considerations.md
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreprocessorConfig {
  /** Variables for ${VAR} and $N substitution. */
  variables: Record<string, string>;
  /** Context object passed to script executions. */
  scriptContext: Record<string, unknown>;
  /** Absolute path to the skill directory. */
  skillDir: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Timeout for each shell command or script execution. */
const COMMAND_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/** Match !`command` patterns (shell command markers). */
const SHELL_COMMAND_PATTERN = /^!\`([^`]+)\`$/gm;

/** Match !{script: path} or !{script: path, key: value, ...} patterns. */
const SCRIPT_PATTERN = /^!\{script:\s*([^,}]+)(?:,\s*([^}]+))?\}$/gm;

/** Match ${VAR} variable references. */
const VARIABLE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Match $N positional argument references (1-9). */
const POSITIONAL_PATTERN = /\$([1-9])/g;

/** Match $ARGUMENTS reference. */
const ARGUMENTS_PATTERN = /\$ARGUMENTS/g;

// ---------------------------------------------------------------------------
// Shell selection (mirrors bash tool logic)
// ---------------------------------------------------------------------------

interface ShellConfig {
  shell: string;
  args: string[];
}

function getShellConfig(): ShellConfig {
  if (process.platform === 'win32') {
    // PowerShell on Windows
    const psCore = process.env['ProgramFiles'];
    const psCorePath = psCore ? `${psCore}\\PowerShell\\7\\pwsh.exe` : null;

    // Try pwsh (PowerShell 7+) first, fall back to Windows PowerShell
    try {
      if (psCorePath) {
        fs.accessSync(psCorePath);
        return { shell: psCorePath, args: ['-NoProfile', '-NonInteractive', '-Command'] };
      }
    } catch {
      // Fall through
    }

    return {
      shell: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command'],
    };
  }

  // Unix: use $SHELL, falling back to /bin/bash or /bin/sh
  const userShell = process.env['SHELL'];
  if (userShell && !userShell.endsWith('/fish')) {
    return { shell: userShell, args: ['-c'] };
  }

  // Fall back
  try {
    fs.accessSync('/bin/bash');
    return { shell: '/bin/bash', args: ['-c'] };
  } catch {
    return { shell: '/bin/sh', args: ['-c'] };
  }
}

// ---------------------------------------------------------------------------
// Preprocessor implementation
// ---------------------------------------------------------------------------

/**
 * Preprocess a SKILL.md body. Runs all three stages:
 * 1. Variable substitution
 * 2. Shell commands and scripts (in parallel)
 * 3. Assemble final content
 */
export async function preprocessSkillBody(
  body: string,
  config: PreprocessorConfig,
): Promise<string> {
  // Stage 1: Variable substitution (runs first so vars are available
  // inside shell commands and script arguments)
  let content = substituteVariables(body, config.variables);

  // Stage 2: Collect shell command and script markers, execute in parallel
  const shellReplacements: Array<{ marker: string; promise: Promise<string> }> = [];
  const scriptReplacements: Array<{ marker: string; promise: Promise<string> }> = [];

  // Find shell commands
  let match: RegExpExecArray | null;
  const shellRegex = new RegExp(SHELL_COMMAND_PATTERN.source, 'gm');
  while ((match = shellRegex.exec(content)) !== null) {
    const fullMatch = match[0]!;
    const command = match[1]!;
    shellReplacements.push({
      marker: fullMatch,
      promise: executeShellCommand(command, config.skillDir),
    });
  }

  // Find scripts
  const scriptRegex = new RegExp(SCRIPT_PATTERN.source, 'gm');
  while ((match = scriptRegex.exec(content)) !== null) {
    const fullMatch = match[0]!;
    const scriptPath = match[1]!.trim();
    const extraArgs = match[2]?.trim() ?? '';
    scriptReplacements.push({
      marker: fullMatch,
      promise: executeScript(scriptPath, extraArgs, config),
    });
  }

  // Execute all in parallel
  const allReplacements = [...shellReplacements, ...scriptReplacements];
  if (allReplacements.length > 0) {
    const results = await Promise.allSettled(
      allReplacements.map(r => r.promise),
    );

    for (let i = 0; i < allReplacements.length; i++) {
      const replacement = allReplacements[i]!;
      const result = results[i]!;
      const output = result.status === 'fulfilled'
        ? result.value
        : `[Error: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}]`;
      // Use callback to prevent $& and other replacement patterns in output
      content = content.replace(replacement.marker, () => output);
    }
  }

  return content;
}

/**
 * Substitute ${VAR}, $ARGUMENTS, and $N references with their values.
 */
export function substituteVariables(
  body: string,
  variables: Record<string, string>,
): string {
  let result = body;

  // Replace $ARGUMENTS first (before ${} to avoid partial matching)
  result = result.replace(ARGUMENTS_PATTERN, () => variables['ARGUMENTS'] ?? '');

  // Replace positional $1..$9
  result = result.replace(POSITIONAL_PATTERN, (_match, num: string) => {
    return variables[num] ?? '';
  });

  // Replace ${VAR} references
  result = result.replace(VARIABLE_PATTERN, (_match, varName: string) => {
    return variables[varName] ?? '';
  });

  return result;
}

/**
 * Execute a shell command and return stdout.
 * Uses the same shell selection as the Bash tool.
 */
export function executeShellCommand(
  command: string,
  cwd: string,
): Promise<string> {
  return new Promise((resolve) => {
    const shellConfig = getShellConfig();

    // Use execFile to invoke the shell directly with the command as an argument.
    // This avoids double-shell invocation (exec spawns a shell around our shell).
    const args = [...shellConfig.args, command];

    const child = execFile(
      shellConfig.shell,
      args,
      {
        cwd,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 1024 * 1024, // 1MB
        env: process.env,
      },
      (error: Error | null, stdout: string, _stderr: string) => {
        if (error) {
          if ('killed' in error && (error as { killed?: boolean }).killed) {
            resolve('[Error: command timed out]');
          } else {
            const exitCode = 'code' in error && (error as Record<string, unknown>)['code'] != null
              ? (error as Record<string, unknown>)['code']
              : 'unknown';
            resolve(`[Error: command failed with exit code ${exitCode}]`);
          }
          return;
        }
        resolve(stdout.trim());
      },
    );

    child.on('error', () => {
      resolve('[Error: failed to execute command]');
    });
  });
}

/**
 * Execute a JavaScript script and return its output.
 * Scripts are loaded via dynamic import() and must export a default
 * async function.
 */
export async function executeScript(
  scriptPath: string,
  extraArgsStr: string,
  config: PreprocessorConfig,
): Promise<string> {
  const absolutePath = path.isAbsolute(scriptPath)
    ? scriptPath
    : path.resolve(config.skillDir, scriptPath);

  // Parse extra args from "key: value, key2: value2" format
  const scriptArgs: Record<string, string> = {};
  if (extraArgsStr) {
    const pairs = extraArgsStr.split(',');
    for (const pair of pairs) {
      const colonIdx = pair.indexOf(':');
      if (colonIdx > 0) {
        const key = pair.substring(0, colonIdx).trim();
        const value = pair.substring(colonIdx + 1).trim();
        scriptArgs[key] = value;
      }
    }
  }

  // Build context: consumer context spread first, then Cortex built-ins
  // override (skillDir and scriptArgs are Cortex-owned and cannot be
  // overridden by consumer). args/rawArgs come pre-merged in
  // config.scriptContext from the registry with the same precedence.
  const ctx: Record<string, unknown> = {
    ...config.scriptContext,
    skillDir: config.skillDir,
    scriptArgs,
  };

  // Execute with timeout
  const timeoutPromise = new Promise<string>((resolve) => {
    setTimeout(() => resolve('[Error: script timed out]'), COMMAND_TIMEOUT_MS);
  });

  const executionPromise = (async (): Promise<string> => {
    try {
      // Dynamic import of the script file
      const fileUrl = pathToFileURL(absolutePath).href;
      const mod = await import(fileUrl);
      const fn = mod.default ?? mod;

      if (typeof fn !== 'function') {
        return '[Error: script does not export a function]';
      }

      const result = await fn(ctx);
      return typeof result === 'string' ? result : String(result ?? '');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `[Error: script failed: ${message}]`;
    }
  })();

  return Promise.race([executionPromise, timeoutPromise]);
}
