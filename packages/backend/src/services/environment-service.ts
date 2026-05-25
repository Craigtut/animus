/**
 * Environment Service — manages the entity's self-owned working environment.
 *
 * Reads/writes the overlay manifest at `$DATA_DIR/agent-env/environment.json`
 * and merges it into the backend `process.env`. Because the Cortex bash tool
 * rebuilds its sanitized env from `process.env` on every command, a path
 * registered here is effective for the next command and persists across
 * restarts. The entity uses this to build up its own toolchain over time.
 *
 * Security: this service refuses to set environment variables that Cortex's
 * `safe-env` strips for safety (NODE_OPTIONS, NODE_PATH, PYTHONPATH, LD_*,
 * DYLD_*, etc.) and never lets PATH be overwritten wholesale — PATH is managed
 * only through additive, deduplicated `pathAdditions`. See
 * docs/research/self-managed-environment.md.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  environmentManifestSchema,
  type EnvironmentManifest,
  type EnvironmentTool,
} from '@animus-labs/shared';
import { AGENT_ENV_DIR } from '../utils/env.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('EnvironmentService', 'server');

const MANIFEST_PATH = path.join(AGENT_ENV_DIR, 'environment.json');
const BIN_DIR = path.join(AGENT_ENV_DIR, 'bin');
const TOOLS_DIR = path.join(AGENT_ENV_DIR, 'tools');
const SKILLS_DIR = path.join(AGENT_ENV_DIR, 'skills');

const PATH_SEP = path.delimiter;

/**
 * Environment variables the overlay is forbidden from setting. These mirror
 * the variables Cortex's bash tool strips (they would either be ignored or
 * constitute a security bypass). PATH is managed separately via pathAdditions.
 */
const DENYLISTED_ENV_VARS = new Set([
  'PATH',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PYTHONPATH',
  'BASH_ENV',
  'ENV',
  'ZDOTDIR',
  'IFS',
]);

/** Variables matching these prefixes are also forbidden (dynamic linker). */
const DENYLISTED_PREFIXES = ['LD_', 'DYLD_'];

/**
 * macOS PATH floor: a Finder/Dock launch hands the app a minimal PATH and
 * does not source the login shell, so Homebrew / common tool dirs are absent.
 * Appended (lowest priority) so the entity can still find user-installed tools.
 */
const MACOS_FLOOR_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin'];

function isAllowedEnvVar(name: string): boolean {
  if (DENYLISTED_ENV_VARS.has(name)) return false;
  return !DENYLISTED_PREFIXES.some((p) => name.startsWith(p));
}

function dedupePath(parts: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    if (part && !seen.has(part)) {
      seen.add(part);
      result.push(part);
    }
  }
  return result;
}

class EnvironmentService {
  /**
   * The PATH as it was before any overlay was applied. Captured once so PATH
   * can be recomputed deterministically (additions can be removed cleanly).
   */
  private basePath: string | null = null;

  /** Ensure the agent-env directory structure exists. */
  ensureDirs(): void {
    for (const dir of [AGENT_ENV_DIR, BIN_DIR, TOOLS_DIR, SKILLS_DIR]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  /** Resolve `${AGENT_ENV}` placeholders in a manifest value. */
  private resolve(value: string): string {
    return value.replaceAll('${AGENT_ENV}', AGENT_ENV_DIR);
  }

  /** Read the manifest, returning an empty (default) one if absent/invalid. */
  readManifest(): EnvironmentManifest {
    try {
      const raw = readFileSync(MANIFEST_PATH, 'utf-8');
      const parsed = environmentManifestSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
      log.warn('environment.json failed validation, using empty manifest:', parsed.error.message);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('Failed to read environment.json, using empty manifest:', err);
      }
    }
    return environmentManifestSchema.parse({});
  }

  private writeManifest(manifest: EnvironmentManifest): void {
    this.ensureDirs();
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  /**
   * Apply the manifest to `process.env`. Idempotent: PATH is recomputed from
   * the captured base as `[resolved pathAdditions] + [base PATH] + [floor]`,
   * deduplicated. Allowlisted env vars are set; denylisted ones are skipped.
   */
  applyToProcessEnv(): void {
    this.ensureDirs();
    if (this.basePath === null) {
      this.basePath = process.env['PATH'] ?? '';
    }
    const manifest = this.readManifest();

    const additions = manifest.pathAdditions.map((p) => this.resolve(p));
    const baseParts = this.basePath.split(PATH_SEP);
    const floor = process.platform === 'darwin'
      ? MACOS_FLOOR_DIRS.filter((d) => existsSync(d))
      : [];

    const merged = dedupePath([...additions, ...baseParts, ...floor]);
    process.env['PATH'] = merged.join(PATH_SEP);

    for (const [name, value] of Object.entries(manifest.envVars)) {
      if (isAllowedEnvVar(name)) {
        process.env[name] = this.resolve(value);
      } else {
        log.warn(`Refusing to apply denylisted env var from manifest: ${name}`);
      }
    }

    const toolCount = Object.keys(manifest.tools).length;
    log.info(
      `Environment applied: ${additions.length} path addition(s), ${toolCount} registered tool(s)`
    );
  }

  /** Add a directory to PATH. Idempotent. Returns the updated manifest. */
  addPath(dir: string): EnvironmentManifest {
    const manifest = this.readManifest();
    if (!manifest.pathAdditions.includes(dir)) {
      manifest.pathAdditions.push(dir);
      this.writeManifest(manifest);
    }
    this.applyToProcessEnv();
    return manifest;
  }

  /** Remove a directory from PATH. Returns the updated manifest. */
  removePath(dir: string): EnvironmentManifest {
    const manifest = this.readManifest();
    manifest.pathAdditions = manifest.pathAdditions.filter((p) => p !== dir);
    this.writeManifest(manifest);
    this.applyToProcessEnv();
    return manifest;
  }

  /** Set an allowlisted environment variable. Throws if denylisted. */
  setVar(name: string, value: string): EnvironmentManifest {
    if (!isAllowedEnvVar(name)) {
      throw new Error(
        `Environment variable "${name}" cannot be set: it is reserved or security-sensitive.`
      );
    }
    const manifest = this.readManifest();
    manifest.envVars[name] = value;
    this.writeManifest(manifest);
    process.env[name] = this.resolve(value);
    return manifest;
  }

  /** Unset a previously set environment variable. */
  unsetVar(name: string): EnvironmentManifest {
    const manifest = this.readManifest();
    if (name in manifest.envVars) {
      delete manifest.envVars[name];
      this.writeManifest(manifest);
      delete process.env[name];
    }
    return manifest;
  }

  /**
   * Register an installed/discovered tool. Adds its binDir to PATH and records
   * metadata for audit and per-tick awareness.
   */
  registerTool(tool: Omit<EnvironmentTool, 'registeredAt'>): EnvironmentManifest {
    const manifest = this.readManifest();
    manifest.tools[tool.name] = { ...tool, registeredAt: new Date().toISOString() };
    if (!manifest.pathAdditions.includes(tool.binDir)) {
      manifest.pathAdditions.push(tool.binDir);
    }
    this.writeManifest(manifest);
    this.applyToProcessEnv();
    log.info(`Registered tool "${tool.name}"${tool.version ? ` (${tool.version})` : ''} at ${tool.binDir}`);
    return manifest;
  }

  /** Unregister a tool, removing its binDir from PATH if unused by others. */
  unregisterTool(name: string): EnvironmentManifest {
    const manifest = this.readManifest();
    const tool = manifest.tools[name];
    if (tool) {
      delete manifest.tools[name];
      const stillUsed = Object.values(manifest.tools).some((t) => t.binDir === tool.binDir);
      if (!stillUsed) {
        manifest.pathAdditions = manifest.pathAdditions.filter((p) => p !== tool.binDir);
      }
      this.writeManifest(manifest);
      this.applyToProcessEnv();
    }
    return manifest;
  }

  /** Directory where self-contained toolchains should be installed. */
  get toolsDir(): string {
    return TOOLS_DIR;
  }

  /** Directory where built-in skills are materialized. */
  get skillsDir(): string {
    return SKILLS_DIR;
  }

  /** The resolved agent-env root (substituted for `${AGENT_ENV}` in skills). */
  get rootDir(): string {
    return AGENT_ENV_DIR;
  }

  /**
   * Write a built-in skill's SKILL.md into the agent-env skills directory and
   * return its path. Idempotent overwrite so skill content ships with updates.
   */
  materializeSkill(name: string, content: string): string {
    this.ensureDirs();
    const dir = path.join(SKILLS_DIR, name);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const skillPath = path.join(dir, 'SKILL.md');
    writeFileSync(skillPath, content, 'utf-8');
    return skillPath;
  }

  /**
   * Compact, human-readable summary of registered tools for the per-tick
   * ENVIRONMENT context block. Returns null when nothing is registered.
   */
  getToolSummary(): string | null {
    const manifest = this.readManifest();
    const names = Object.values(manifest.tools).map((t) =>
      t.version ? `${t.name} ${t.version}` : t.name
    );
    return names.length > 0 ? names.join(', ') : null;
  }
}

let instance: EnvironmentService | null = null;

export function getEnvironmentService(): EnvironmentService {
  if (!instance) instance = new EnvironmentService();
  return instance;
}
