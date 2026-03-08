import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { createLogger } from '../lib/logger.js';
import { DATA_DIR } from '../utils/env.js';
import { CLAUDE_SDK_VERSION, CLAUDE_SDK_PACKAGE } from '../lib/sdk-constants.js';
import { getEventBus } from '../lib/event-bus.js';
import { _resetCache } from '../lib/cli-paths.js';

const log = createLogger('SdkManager', 'server');

export interface SdkInstallStatus {
  installed: boolean;
  version: string | null;
  installPath: string;
  installing: boolean;
  error: string | null;
}

class SdkManager {
  private installing = false;
  private lastError: string | null = null;

  getInstallPath(): string {
    return join(DATA_DIR, 'sdks', 'claude');
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
   * Returns { bin, args } where bin is the executable and args is a prefix
   * to prepend before npm subcommand args.
   *
   * In Tauri production, the bundled npm shell script uses `require()` (CJS)
   * but the nearest package.json has `"type": "module"`, causing Node to
   * reject it. We bypass the shell script entirely by invoking Node directly
   * with the npm-cli.js entry point.
   */
  resolveNpmBinary(): { bin: string; prefixArgs: string[] } {
    const resourcesDir = process.env['ANIMUS_RESOURCES_DIR'];
    if (resourcesDir) {
      // Use the npm-cli.js directly to avoid CJS/ESM shebang conflict
      // Try both possible npm-cli.js locations (with and without lib/ prefix)
      const candidates = [
        join(resourcesDir, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        join(resourcesDir, 'npm', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ];
      const npmCliJs = candidates.find(p => existsSync(p));
      if (npmCliJs) {
        log.debug(`Using bundled npm-cli.js at ${npmCliJs}`);
        return { bin: process.execPath, prefixArgs: [npmCliJs] };
      }
    }

    // Fallback to system npm (dev mode, Docker)
    const systemNpm = platform() === 'win32' ? 'npm.cmd' : 'npm';
    log.debug(`Using system npm: ${systemNpm}`);
    return { bin: systemNpm, prefixArgs: [] };
  }

  async install(version?: string): Promise<void> {
    if (this.installing) {
      log.warn('SDK installation already in progress');
      return;
    }

    this.installing = true;
    this.lastError = null;
    const eventBus = getEventBus();
    const installPath = this.getInstallPath();
    const targetVersion = version ?? CLAUDE_SDK_VERSION;

    try {
      eventBus.emit('sdk:install_progress', {
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

      eventBus.emit('sdk:install_progress', {
        sdk: 'claude-agent-sdk',
        phase: 'downloading',
        message: 'Downloading Claude Agent SDK...',
      });

      // Resolve npm binary
      const { bin: npmBin, prefixArgs } = this.resolveNpmBinary();
      const packageSpec = `${CLAUDE_SDK_PACKAGE}@${targetVersion}`;

      // Build npm args (prefixArgs may contain the npm-cli.js path)
      const args = [...prefixArgs, 'install', packageSpec, '--no-fund', '--no-audit', '--no-progress'];

      log.info(`Installing ${packageSpec} to ${installPath}`);

      await new Promise<void>((resolve, reject) => {
        execFile(npmBin, args, {
          cwd: installPath,
          timeout: 120_000,
          // npm.cmd on Windows requires shell to execute
          shell: platform() === 'win32' && npmBin.endsWith('.cmd'),
        }, (error, stdout, stderr) => {
          if (error) {
            log.error('npm install failed:', error);
            log.error('stderr:', stderr);
            reject(new Error(stderr || error.message));
          } else {
            log.info('npm install output:', stdout);
            resolve();
          }
        });
      });

      eventBus.emit('sdk:install_progress', {
        sdk: 'claude-agent-sdk',
        phase: 'installing',
        message: 'Finalizing installation...',
      });

      // Reset CLI path cache so adapters find the new SDK
      _resetCache();

      eventBus.emit('sdk:install_progress', {
        sdk: 'claude-agent-sdk',
        phase: 'complete',
        message: 'Claude Agent SDK installed successfully.',
      });

      const status = this.getStatus();
      log.info(`SDK installed: v${status.version} at ${installPath}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.lastError = errorMsg;
      log.error('SDK installation failed:', errorMsg);

      eventBus.emit('sdk:install_progress', {
        sdk: 'claude-agent-sdk',
        phase: 'error',
        message: 'Installation failed.',
        error: errorMsg,
      });
    } finally {
      this.installing = false;
    }
  }
}

// Singleton
let instance: SdkManager | null = null;

export function getSdkManager(): SdkManager {
  if (!instance) instance = new SdkManager();
  return instance;
}
