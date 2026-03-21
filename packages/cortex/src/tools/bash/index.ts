/**
 * Bash tool: execute shell commands in the host environment.
 *
 * Cross-platform: bash/zsh on macOS and Linux, PowerShell on Windows.
 * Tracks working directory across calls within an agentic loop.
 * Supports background execution with auto-yield.
 *
 * Reference: docs/cortex/tools/bash.md
 */

import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import type { CwdTracker } from '../shared/cwd-tracker.js';
import type { ToolContentDetails } from '../../types.js';
import { buildSafeEnv, runSafetyChecks } from './safety.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const BashParams = Type.Object({
  command: Type.String({ description: 'The shell command to execute' }),
  timeout: Type.Optional(
    Type.Number({ description: 'Timeout in milliseconds. Default: 120000 (2 min). Max: 600000 (10 min).' }),
  ),
  description: Type.Optional(
    Type.String({ description: 'Human-readable explanation of the command.' }),
  ),
  background: Type.Optional(
    Type.Boolean({ description: 'Run the command in the background immediately. Default: false.' }),
  ),
});

export type BashParamsType = Static<typeof BashParams>;

// ---------------------------------------------------------------------------
// Details type
// ---------------------------------------------------------------------------

export interface BashDetails {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  duration: number;
  interrupted: boolean;
  timedOut: boolean;
  backgrounded: boolean;
  taskId: string | null;
  finalCwd: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 600_000;
const MAX_OUTPUT_CHARS = 30_000;
const TRUNCATION_HALF = 15_000;
const AUTO_YIELD_THRESHOLD = 10_000; // 10 seconds
const CWD_MARKER = '___CWD___';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface BashToolConfig {
  cwdTracker: CwdTracker;
  /** Custom shell path override. */
  shellPath?: string | undefined;
  /** Auto-yield threshold in ms. Default: 10000. */
  autoYieldThreshold?: number | undefined;
  /** Callback for tracking subprocess PIDs (for cleanup on exit). */
  onProcessSpawned?: ((pid: number) => void) | undefined;
  /** Callback for removing tracked PIDs when process exits. */
  onProcessExited?: ((pid: number) => void) | undefined;
  /** Utility model completion function for Layer 7 safety classifier. */
  utilityComplete?: ((context: unknown) => Promise<unknown>) | undefined;
  /**
   * Consumer-set environment variable overrides that bypass the security blocklist.
   * Merged ON TOP of the sanitized environment for shell subprocesses.
   * Used for macOS dock icon suppression vars (DYLD_INSERT_LIBRARIES, etc.).
   */
  envOverrides?: Record<string, string> | undefined;
}

// ---------------------------------------------------------------------------
// Background task store
// ---------------------------------------------------------------------------

export interface BackgroundTask {
  id: string;
  process: child_process.ChildProcess;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  completed: boolean;
  startTime: number;
}

/** Module-level store for background tasks. Shared with TaskOutput tool. */
const backgroundTasks = new Map<string, BackgroundTask>();

export function getBackgroundTask(id: string): BackgroundTask | undefined {
  return backgroundTasks.get(id);
}

/** Clean up completed background tasks older than 30 minutes to prevent memory leaks. */
function cleanupCompletedTasks(): void {
  const maxAge = 30 * 60 * 1000;
  const now = Date.now();
  for (const [id, task] of backgroundTasks) {
    if (task.completed && now - task.startTime > maxAge) {
      backgroundTasks.delete(id);
    }
  }
}

export function getAllBackgroundTasks(): Map<string, BackgroundTask> {
  return backgroundTasks;
}

// ---------------------------------------------------------------------------
// Shell Selection
// ---------------------------------------------------------------------------

interface ShellConfig {
  shell: string;
  args: string[];
}

/**
 * Read /etc/shells and return the set of trusted shell paths.
 */
function readTrustedShells(): Set<string> {
  const trusted = new Set<string>();
  try {
    const content = fs.readFileSync('/etc/shells', 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        trusted.add(trimmed);
      }
    }
  } catch {
    // /etc/shells not available; empty set means we fall back
  }
  return trusted;
}

/**
 * Select the appropriate shell for the current platform.
 */
function selectShell(customShellPath?: string): ShellConfig {
  // Custom override
  if (customShellPath) {
    if (process.platform === 'win32') {
      return { shell: customShellPath, args: ['-NoProfile', '-NonInteractive', '-Command'] };
    }
    return { shell: customShellPath, args: ['-c'] };
  }

  if (process.platform === 'win32') {
    return selectWindowsShell();
  }

  return selectUnixShell();
}

function selectUnixShell(): ShellConfig {
  const userShell = process.env['SHELL'];

  if (userShell) {
    // Reject fish (incompatible with common bashisms)
    if (userShell.endsWith('/fish')) {
      return findUnixFallback();
    }

    // Validate against /etc/shells
    const trusted = readTrustedShells();
    if (trusted.size === 0 || trusted.has(userShell)) {
      return { shell: userShell, args: ['-c'] };
    }
  }

  return findUnixFallback();
}

function findUnixFallback(): ShellConfig {
  // Try /bin/bash first, then /bin/sh
  for (const shell of ['/bin/bash', '/bin/sh']) {
    try {
      fs.accessSync(shell, fs.constants.X_OK);
      return { shell, args: ['-c'] };
    } catch {
      continue;
    }
  }

  return { shell: '/bin/sh', args: ['-c'] };
}

function selectWindowsShell(): ShellConfig {
  // Try PowerShell 7 first
  const ps7Paths = [
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    `${process.env['ProgramW6432']}\\PowerShell\\7\\pwsh.exe`,
  ];

  for (const ps7 of ps7Paths) {
    try {
      fs.accessSync(ps7, fs.constants.X_OK);
      return { shell: ps7, args: ['-NoProfile', '-NonInteractive', '-Command'] };
    } catch {
      continue;
    }
  }

  // Fall back to Windows PowerShell 5.1
  const ps5 = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  return { shell: ps5, args: ['-NoProfile', '-NonInteractive', '-Command'] };
}

// ---------------------------------------------------------------------------
// Output handling
// ---------------------------------------------------------------------------

/**
 * Truncate output to MAX_OUTPUT_CHARS keeping first and last halves.
 */
function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;

  const first = output.slice(0, TRUNCATION_HALF);
  const last = output.slice(-TRUNCATION_HALF);
  const elided = output.length - TRUNCATION_HALF * 2;

  return `${first}\n[... truncated ${elided} characters. Use Read or Grep to inspect specific parts. ...]\n${last}`;
}

/**
 * Sanitize output by stripping binary control characters.
 * Preserves tab, newline, and carriage return.
 */
function sanitizeOutput(output: string): string {
  // eslint-disable-next-line no-control-regex
  return output.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Extract CWD from output using the CWD_MARKER.
 * Returns [cleanedOutput, extractedCwd].
 */
function extractCwd(output: string): [string, string | null] {
  const markerIdx = output.lastIndexOf(CWD_MARKER);
  if (markerIdx === -1) return [output, null];

  const beforeMarker = output.slice(0, markerIdx);
  const afterMarker = output.slice(markerIdx + CWD_MARKER.length).trim();

  // The CWD is on the line after the marker
  const lines = afterMarker.split('\n');
  const cwd = (lines[0] ?? '').trim();

  return [beforeMarker.trimEnd(), cwd || null];
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

let taskIdCounter = 0;

export function createBashTool(config: BashToolConfig): {
  name: string;
  description: string;
  parameters: typeof BashParams;
  execute: (params: BashParamsType) => Promise<ToolContentDetails<BashDetails>>;
} {
  const { cwdTracker, autoYieldThreshold = AUTO_YIELD_THRESHOLD } = config;

  return {
    name: 'Bash',
    description: 'Execute a shell command in the host environment.',
    parameters: BashParams,

    async execute(params: BashParamsType): Promise<ToolContentDetails<BashDetails>> {
      cleanupCompletedTasks();
      const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
      const background = params.background ?? false;
      const startTime = Date.now();

      // Run safety checks (Layers 2-7)
      const safetyResult = await runSafetyChecks(
        params.command,
        cwdTracker.getDefaultDir(),
        cwdTracker.getCwd(),
        {
          utilityComplete: config.utilityComplete,
          description: params.description,
        },
      );

      if (!safetyResult.allowed) {
        return {
          content: [{ type: 'text', text: safetyResult.reason ?? 'Command blocked by safety check.' }],
          details: {
            stdout: '',
            stderr: '',
            exitCode: null,
            duration: Date.now() - startTime,
            interrupted: false,
            timedOut: false,
            backgrounded: false,
            taskId: null,
            finalCwd: cwdTracker.getCwd(),
          },
        };
      }

      // Select shell
      const shellConfig = selectShell(config.shellPath);

      // Verify shell exists
      try {
        fs.accessSync(shellConfig.shell, fs.constants.X_OK);
      } catch {
        return {
          content: [{ type: 'text', text: `Shell not found: ${shellConfig.shell}. Configure a custom shell in settings.` }],
          details: {
            stdout: '',
            stderr: '',
            exitCode: null,
            duration: Date.now() - startTime,
            interrupted: false,
            timedOut: false,
            backgrounded: false,
            taskId: null,
            finalCwd: cwdTracker.getCwd(),
          },
        };
      }

      // Build safe environment (Layer 1), with consumer overrides merged on top
      const safeEnv = buildSafeEnv(process.env, config.envOverrides);

      // Append CWD capture suffix
      const isWindows = process.platform === 'win32';
      // Capture exit code before CWD suffix so pwd/Get-Location don't mask it
      const cwdSuffix = isWindows
        ? `; $__ec=$LASTEXITCODE; Write-Host "${CWD_MARKER}"; Get-Location; exit $__ec`
        : `; __ec=$?; echo "${CWD_MARKER}"; pwd; exit $__ec`;

      // UTF-8 prefix for Windows PowerShell
      const utf8Prefix = isWindows
        ? '$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; '
        : '';

      const fullCommand = `${utf8Prefix}${params.command}${cwdSuffix}`;

      // Spawn the process
      const proc = child_process.spawn(
        shellConfig.shell,
        [...shellConfig.args, fullCommand],
        {
          cwd: cwdTracker.getCwd(),
          env: safeEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: !isWindows, // Process group for Unix cleanup
        },
      );

      // Track PID
      if (proc.pid && config.onProcessSpawned) {
        config.onProcessSpawned(proc.pid);
      }

      // Background execution
      if (background) {
        const taskId = `task_${++taskIdCounter}`;
        const task: BackgroundTask = {
          id: taskId,
          process: proc,
          stdout: '',
          stderr: '',
          exitCode: null,
          completed: false,
          startTime: Date.now(),
        };
        backgroundTasks.set(taskId, task);

        proc.stdout?.setEncoding('utf8');
        proc.stderr?.setEncoding('utf8');
        proc.stdout?.on('data', (data: string) => { task.stdout += data; });
        proc.stderr?.on('data', (data: string) => { task.stderr += data; });
        proc.on('close', (code) => {
          task.exitCode = code;
          task.completed = true;
          if (proc.pid && config.onProcessExited) {
            config.onProcessExited(proc.pid);
          }
        });

        return {
          content: [{ type: 'text', text: `Command running in background. Task ID: ${taskId}\nUse TaskOutput to poll, send input, or kill.` }],
          details: {
            stdout: '',
            stderr: '',
            exitCode: null,
            duration: 0,
            interrupted: false,
            timedOut: false,
            backgrounded: true,
            taskId,
            finalCwd: cwdTracker.getCwd(),
          },
        };
      }

      // Foreground execution
      return new Promise<ToolContentDetails<BashDetails>>((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let autoYielded = false;
        let taskId: string | null = null;

        proc.stdout?.setEncoding('utf8');
        proc.stderr?.setEncoding('utf8');
        proc.stdout?.on('data', (data: string) => { stdout += data; });
        proc.stderr?.on('data', (data: string) => { stderr += data; });

        // Timeout handler
        const timeoutTimer = setTimeout(() => {
          timedOut = true;
          killProcessTree(proc);
        }, timeout);

        // Auto-yield handler
        const autoYieldTimer = setTimeout(() => {
          if (!proc.exitCode && proc.pid) {
            autoYielded = true;
            taskId = `task_${++taskIdCounter}`;
            const task: BackgroundTask = {
              id: taskId,
              process: proc,
              stdout,
              stderr,
              exitCode: null,
              completed: false,
              startTime: Date.now(),
            };
            backgroundTasks.set(taskId, task);

            // Remove original foreground listeners to prevent memory leak
            proc.stdout?.removeAllListeners('data');
            proc.stderr?.removeAllListeners('data');
            // Continue collecting output for the background task
            proc.stdout?.on('data', (data: string) => { task.stdout += data; });
            proc.stderr?.on('data', (data: string) => { task.stderr += data; });
            proc.on('close', (code) => {
              task.exitCode = code;
              task.completed = true;
              if (proc.pid && config.onProcessExited) {
                config.onProcessExited(proc.pid);
              }
            });

            clearTimeout(timeoutTimer);

            const [cleanedOutput] = extractCwd(sanitizeOutput(stdout));
            resolve({
              content: [{ type: 'text', text: `${truncateOutput(cleanedOutput)}\n\n[Command auto-yielded after ${autoYieldThreshold}ms. Task ID: ${taskId}]` }],
              details: {
                stdout: cleanedOutput,
                stderr,
                exitCode: null,
                duration: Date.now() - startTime,
                interrupted: false,
                timedOut: false,
                backgrounded: true,
                taskId,
                finalCwd: cwdTracker.getCwd(),
              },
            });
          }
        }, autoYieldThreshold);

        proc.on('close', (code) => {
          clearTimeout(timeoutTimer);
          clearTimeout(autoYieldTimer);

          if (proc.pid && config.onProcessExited) {
            config.onProcessExited(proc.pid);
          }

          // If already auto-yielded, don't resolve again
          if (autoYielded) return;

          const rawOutput = sanitizeOutput(stdout);
          const [cleanedOutput, newCwd] = extractCwd(rawOutput);

          // Update CWD tracker
          if (newCwd) {
            cwdTracker.updateCwd(newCwd);
          }

          const duration = Date.now() - startTime;

          let text = truncateOutput(cleanedOutput);
          if (stderr) {
            text += `\nstderr: ${truncateOutput(stderr)}`;
          }
          if (timedOut) {
            text += `\nCommand timed out after ${timeout}ms.`;
          }
          if (code !== null && code !== 0) {
            text += `\nExit code: ${code}`;
          }

          resolve({
            content: [{ type: 'text', text: text || '(no output)' }],
            details: {
              stdout: cleanedOutput,
              stderr,
              exitCode: code,
              duration,
              interrupted: false,
              timedOut,
              backgrounded: false,
              taskId: null,
              finalCwd: newCwd ?? cwdTracker.getCwd(),
            },
          });
        });

        proc.on('error', (err) => {
          clearTimeout(timeoutTimer);
          clearTimeout(autoYieldTimer);

          if (autoYielded) return;

          resolve({
            content: [{ type: 'text', text: `Failed to execute command: ${err.message}` }],
            details: {
              stdout,
              stderr,
              exitCode: null,
              duration: Date.now() - startTime,
              interrupted: false,
              timedOut: false,
              backgrounded: false,
              taskId: null,
              finalCwd: cwdTracker.getCwd(),
            },
          });
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Process tree cleanup
// ---------------------------------------------------------------------------

/**
 * Kill the entire process tree.
 * Unix: send SIGKILL to the process group.
 * Windows: use taskkill /F /T.
 */
function killProcessTree(proc: child_process.ChildProcess): void {
  if (!proc.pid) return;

  try {
    if (process.platform === 'win32') {
      child_process.execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
    } else {
      // Kill the entire process group
      process.kill(-proc.pid, 'SIGKILL');
    }
  } catch {
    // Process may have already exited
    try {
      proc.kill('SIGKILL');
    } catch {
      // Ignore
    }
  }
}
