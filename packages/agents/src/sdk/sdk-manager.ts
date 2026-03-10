/**
 * SDK Manager -- installs and manages agent SDK packages.
 *
 * Handles the installation of the Claude Agent SDK into a controlled
 * directory. Progress is reported via an `onProgress` callback rather
 * than an event bus, allowing the consumer (backend) to bridge to
 * its own eventing infrastructure.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { createTaggedLogger, type Logger } from '../logger.js';
import { CLAUDE_SDK_VERSION, CLAUDE_SDK_PACKAGE } from './sdk-constants.js';
import { _resetCache } from './sdk-resolver.js';

// ============================================================================
// Types
// ============================================================================

export interface SdkInstallStatus {
  installed: boolean;
  version: string | null;
  installPath: string;
  installing: boolean;
  error: string | null;
}

export interface SdkInstallProgress {
  sdk: string;
  phase: 'starting' | 'downloading' | 'installing' | 'complete' | 'error';
  message: string;
  error?: string;
}

export interface SdkManagerConfig {
  /** Directory where SDKs are installed (e.g., `data/sdks`) */
  sdksDir: string;
  /** Progress callback */
  onProgress?: (progress: SdkInstallProgress) => void;
  /** Custom logger */
  logger?: Logger;
}

// ============================================================================
// SdkManager
// ============================================================================

export class SdkManager {
  private installing = false;
  private lastError: string | null = null;
  private sdksDir: string;
  private onProgress: (progress: SdkInstallProgress) => void;
  private log: Logger;

  constructor(config: SdkManagerConfig) {
    this.sdksDir = config.sdksDir;
    this.onProgress = config.onProgress ?? (() => {});
    this.log = config.logger ?? createTaggedLogger('SdkManager');
  }

  getInstallPath(): string {
    return join(this.sdksDir, 'claude');
  }

  getStatus(): SdkInstallStatus {
    const installPath = this.getInstallPath();
    const pkgPath = join(installPath, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json');

    let installed = false;
    let version: string | null = null;

    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        installed = true;
        version = pkg.version ?? null;
      } catch {
        // Corrupt package.json
      }
    }

    return {
      installed,
      version,
      installPath,
      installing: this.installing,
      error: this.lastError,
    };
  }

  /**
   * Resolve the npm CLI entry point.
   *
   * In Tauri production, the bundled npm shell script uses `require()` (CJS)
   * but the nearest package.json has `"type": "module"`, causing Node to
   * reject it. We bypass the shell script entirely by invoking Node directly
   * with the npm-cli.js entry point.
   */
  resolveNpmBinary(): { bin: string; prefixArgs: string[] } {
    const resourcesDir = process.env['ANIMUS_RESOURCES_DIR'];
    if (resourcesDir) {
      const candidates = [
        join(resourcesDir, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        join(resourcesDir, 'npm', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ];
      const npmCliJs = candidates.find(p => existsSync(p));
      if (npmCliJs) {
        this.log.debug(`Using bundled npm-cli.js at ${npmCliJs}`);
        return { bin: process.execPath, prefixArgs: [npmCliJs] };
      }
    }

    const systemNpm = platform() === 'win32' ? 'npm.cmd' : 'npm';
    this.log.debug(`Using system npm: ${systemNpm}`);
    return { bin: systemNpm, prefixArgs: [] };
  }

  async install(version?: string): Promise<void> {
    if (this.installing) {
      this.log.warn('SDK installation already in progress');
      return;
    }

    this.installing = true;
    this.lastError = null;
    const installPath = this.getInstallPath();
    const targetVersion = version ?? CLAUDE_SDK_VERSION;

    try {
      this.onProgress({
        sdk: 'claude-agent-sdk',
        phase: 'starting',
        message: 'Preparing installation directory...',
      });

      // Create install directory and write minimal package.json
      mkdirSync(installPath, { recursive: true });
      const pkgJsonPath = join(installPath, 'package.json');
      if (!existsSync(pkgJsonPath)) {
        writeFileSync(pkgJsonPath, JSON.stringify({
          private: true,
          dependencies: {},
        }, null, 2) + '\n');
      }

      this.onProgress({
        sdk: 'claude-agent-sdk',
        phase: 'downloading',
        message: 'Downloading Claude Agent SDK...',
      });

      // Resolve npm binary
      const { bin: npmBin, prefixArgs } = this.resolveNpmBinary();
      const packageSpec = `${CLAUDE_SDK_PACKAGE}@${targetVersion}`;

      const args = [...prefixArgs, 'install', packageSpec, '--no-fund', '--no-audit', '--no-progress'];

      this.log.info(`Installing ${packageSpec} to ${installPath}`);

      await new Promise<void>((resolve, reject) => {
        execFile(npmBin, args, {
          cwd: installPath,
          timeout: 120_000,
          shell: platform() === 'win32' && npmBin.endsWith('.cmd'),
        }, (error, stdout, stderr) => {
          if (error) {
            this.log.error('npm install failed', { error: String(error), stderr });
            reject(new Error(stderr || error.message));
          } else {
            this.log.info('npm install completed', { stdout: stdout.trim() });
            resolve();
          }
        });
      });

      this.onProgress({
        sdk: 'claude-agent-sdk',
        phase: 'installing',
        message: 'Finalizing installation...',
      });

      // Reset CLI path cache so adapters find the new SDK
      _resetCache();

      // Install native binary (needed for auth commands)
      this.onProgress({
        sdk: 'claude-agent-sdk',
        phase: 'installing',
        message: 'Downloading Claude native binary...',
      });

      try {
        await this.installNativeBinary();
      } catch (nativeErr) {
        // Non-fatal: SDK works without native binary, just auth commands won't work
        this.log.warn('Native binary install failed (auth commands will be unavailable)', {
          error: nativeErr instanceof Error ? nativeErr.message : String(nativeErr),
        });
      }

      this.onProgress({
        sdk: 'claude-agent-sdk',
        phase: 'complete',
        message: 'Claude Agent SDK installed successfully.',
      });

      const status = this.getStatus();
      this.log.info(`SDK installed: v${status.version} at ${installPath}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.lastError = errorMsg;
      this.log.error('SDK installation failed', { error: errorMsg });

      this.onProgress({
        sdk: 'claude-agent-sdk',
        phase: 'error',
        message: 'Installation failed.',
        error: errorMsg,
      });
    } finally {
      this.installing = false;
    }
  }

  /**
   * Install the native Claude Code binary via `node cli.js install`.
   *
   * The Claude Agent SDK's cli.js has an `install` subcommand that downloads
   * the native binary to `$XDG_DATA_HOME/claude/versions/`. By controlling
   * XDG_DATA_HOME, we install to our own data directory.
   */
  async installNativeBinary(): Promise<void> {
    const installPath = this.getInstallPath();
    const cliJsPath = join(installPath, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js');

    if (!existsSync(cliJsPath)) {
      throw new Error('Claude Agent SDK not installed. Install it first via sdk.install().');
    }

    this.log.info('Installing Claude native binary via cli.js install');

    const env = {
      ...process.env,
      XDG_DATA_HOME: installPath,
    };

    await new Promise<void>((resolve, reject) => {
      execFile(process.execPath, [cliJsPath, 'install'], {
        env: env as Record<string, string>,
        timeout: 120_000,
      }, (error, stdout, stderr) => {
        if (error) {
          this.log.error('Native binary install failed', { error: String(error), stderr });
          reject(new Error(stderr || error.message));
        } else {
          this.log.info('Native binary installed', { stdout: stdout.trim() });
          _resetCache();
          resolve();
        }
      });
    });
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createSdkManager(config: SdkManagerConfig): SdkManager {
  return new SdkManager(config);
}
