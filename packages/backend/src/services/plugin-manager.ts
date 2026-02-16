/**
 * Plugin Manager — core service that loads, validates, indexes, and provides
 * plugin components to the rest of the system.
 *
 * Singleton via getPluginManager(). Handles the full plugin lifecycle:
 * scanning, manifest validation, component loading, skill deployment,
 * hook/decision/trigger registration, and install/uninstall.
 *
 * See docs/architecture/plugin-system.md for the full design.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { PROJECT_ROOT } from '../utils/env.js';

import { getSystemDb } from '../db/index.js';
import * as pluginStore from '../db/stores/plugin-store.js';
import * as systemStore from '../db/stores/system-store.js';
import { encrypt, decrypt } from '../lib/encryption-service.js';
import { getEventBus } from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';
import {
  PluginManifestSchema,
  ContextSourceSchema,
  HookDefinitionSchema,
  DecisionTypeSchema,
  TriggerDefinitionSchema,
  PluginMcpServerSchema,
  AgentFrontmatterSchema,
  configSchemaSchema,
} from '@animus/shared';
import type {
  PluginManifest,
  PluginSource,
  PluginRecord,
  ContextSource,
  HookDefinition,
  DecisionTypeDefinition,
  TriggerDefinition,
  PluginMcpServer,
  AgentFrontmatter,
  ConfigSchema,
} from '@animus/shared';
import { z } from 'zod';

const log = createLogger('PluginManager', 'plugins');

// ============================================================================
// Types
// ============================================================================

interface LoadedPlugin {
  manifest: PluginManifest;
  absolutePath: string;
  source: PluginSource;
  enabled: boolean;
  configSchema: ConfigSchema | null;
  iconSvg: string | null;
  skills: Array<{ name: string; absolutePath: string }>;
  mcpServers: Record<string, PluginMcpServer>;
  contextSources: ContextSource[];
  hooks: HookDefinition[];
  decisionTypes: DecisionTypeDefinition[];
  triggers: TriggerDefinition[];
  agents: Array<{ frontmatter: AgentFrontmatter; prompt: string }>;
}

interface HandlerResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

interface WatcherProcess {
  pluginName: string;
  triggerName: string;
  process: ReturnType<typeof spawn> | null;
  failures: number;
  backoffMs: number;
  stopped: boolean;
}

// ============================================================================
// Plugin Manager
// ============================================================================

class PluginManager {
  private plugins = new Map<string, LoadedPlugin>();
  private decisionRegistry = new Map<string, { definition: DecisionTypeDefinition; pluginName: string }>();
  private hookRegistry = new Map<string, Array<{ definition: HookDefinition; pluginName: string; command: string }>>();
  private watchers: WatcherProcess[] = [];
  private staticContentCache = new Map<string, string>();
  private deployedSkillPaths: string[] = [];

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async loadAll(): Promise<void> {
    const db = getSystemDb();

    // 1. Scan directories for plugin manifests
    const rawDiscovered = await this.scanAllDirectories();

    // Deduplicate by name (first source wins: built-in > downloaded > registered)
    const discovered: Array<[string, PluginManifest, PluginSource]> = [];
    const seenNames = new Set<string>();
    for (const entry of rawDiscovered) {
      if (!seenNames.has(entry[1].name)) {
        seenNames.add(entry[1].name);
        discovered.push(entry);
      }
    }

    // 2. Cross-reference with DB
    const dbPlugins = pluginStore.getAllPlugins(db);
    const dbMap = new Map(dbPlugins.map(p => [p.name, p]));

    for (const [pluginPath, manifest, source] of discovered) {
      const existing = dbMap.get(manifest.name);
      if (!existing) {
        // New plugin — insert into DB (enabled by default, may be overridden below after loading config schema)
        pluginStore.insertPlugin(db, {
          name: manifest.name,
          version: manifest.version,
          path: pluginPath,
          source,
          enabled: true,
        });
        log.info(`Discovered new plugin: ${manifest.name} (${source})`);
      } else {
        // Update path/version if changed
        if (existing.path !== pluginPath || existing.version !== manifest.version) {
          pluginStore.updatePlugin(db, manifest.name, {
            path: pluginPath,
            version: manifest.version,
          });
        }
      }
    }

    // 3. Load components for enabled plugins
    const discoveredNames = new Set(discovered.map(([, m]) => m.name));
    const allRecords = pluginStore.getAllPlugins(db);
    let enabledCount = 0;

    for (const record of allRecords) {
      if (!discoveredNames.has(record.name) && record.source === 'built-in') {
        // Built-in plugin directory was removed — mark disabled
        pluginStore.updatePlugin(db, record.name, { enabled: false });
        continue;
      }

      const disc = discovered.find(([, m]) => m.name === record.name);
      if (!disc) continue;

      const [pluginPath, manifest, source] = disc;
      const loaded: LoadedPlugin = {
        manifest,
        absolutePath: pluginPath,
        source,
        enabled: record.enabled,
        configSchema: null,
        iconSvg: null,
        skills: [],
        mcpServers: {},
        contextSources: [],
        hooks: [],
        decisionTypes: [],
        triggers: [],
        agents: [],
      };

      // Always add to map first (so hasRequiredConfig can look it up)
      this.plugins.set(manifest.name, loaded);

      if (record.enabled) {
        await this.loadComponents(loaded);

        // Verify config — if required fields are missing, disable instead of enabling
        if (!this.hasRequiredConfig(manifest.name)) {
          log.warn(`Plugin "${manifest.name}" is missing required configuration — disabling`);
          loaded.enabled = false;
          pluginStore.updatePlugin(db, manifest.name, { enabled: false });
        } else {
          this.registerHooks(loaded);
          this.registerDecisionTypes(loaded);
          enabledCount++;
        }
      }
    }

    // 4. Deploy skills for active provider
    const settings = systemStore.getSystemSettings(db);
    await this.deploySkills(settings.defaultAgentProvider);

    // 5. Start watcher triggers
    await this.startTriggers();

    log.info(`Loaded ${this.plugins.size} plugins (${enabledCount} enabled)`);
  }

  async install(source: { type: PluginSource; path: string }): Promise<PluginManifest> {
    const absolutePath = path.resolve(source.path);
    const manifest = await this.readManifest(absolutePath);

    const db = getSystemDb();
    const existing = pluginStore.getPlugin(db, manifest.name);
    if (existing) {
      throw new Error(`Plugin "${manifest.name}" is already installed`);
    }

    const loaded: LoadedPlugin = {
      manifest,
      absolutePath,
      source: source.type,
      enabled: true,
      configSchema: null,
      iconSvg: null,
      skills: [],
      mcpServers: {},
      contextSources: [],
      hooks: [],
      decisionTypes: [],
      triggers: [],
      agents: [],
    };

    await this.loadComponents(loaded);

    // Check if required config is missing — install as disabled if so
    const needsConfig = loaded.configSchema &&
      loaded.configSchema.fields.some(f => f.required);

    if (needsConfig) {
      loaded.enabled = false;
      pluginStore.insertPlugin(db, {
        name: manifest.name,
        version: manifest.version,
        path: absolutePath,
        source: source.type,
        enabled: false,
      });
      log.info(`Installed plugin: ${manifest.name} (disabled — needs configuration)`);
    } else {
      pluginStore.insertPlugin(db, {
        name: manifest.name,
        version: manifest.version,
        path: absolutePath,
        source: source.type,
        enabled: true,
      });
      this.registerHooks(loaded);
      this.registerDecisionTypes(loaded);

      const settings = systemStore.getSystemSettings(db);
      await this.deploySkillsForPlugin(loaded, settings.defaultAgentProvider);
      await this.startTriggersForPlugin(loaded);
      log.info(`Installed plugin: ${manifest.name}`);
    }

    this.plugins.set(manifest.name, loaded);

    getEventBus().emit('plugin:changed', { pluginName: manifest.name, action: 'installed' });
    return manifest;
  }

  async uninstall(name: string): Promise<void> {
    const loaded = this.plugins.get(name);
    if (!loaded) {
      throw new Error(`Plugin "${name}" is not loaded`);
    }

    if (loaded.source === 'built-in') {
      throw new Error(`Cannot uninstall built-in plugin "${name}"`);
    }

    await this.stopTriggersForPlugin(name);
    this.deregisterHooks(name);
    this.deregisterDecisionTypes(name);
    await this.removeSkillsForPlugin(loaded);
    this.plugins.delete(name);

    const db = getSystemDb();
    pluginStore.deletePlugin(db, name);

    getEventBus().emit('plugin:changed', { pluginName: name, action: 'uninstalled' });
    log.info(`Uninstalled plugin: ${name}`);
  }

  async enable(name: string): Promise<void> {
    const loaded = this.plugins.get(name);
    if (!loaded) {
      throw new Error(`Plugin "${name}" is not loaded`);
    }

    if (loaded.enabled) return;

    // Load components first so configSchema is available for validation
    await this.loadComponents(loaded);

    // Block enable when required config fields are missing
    if (!this.hasRequiredConfig(name)) {
      throw new Error(`Plugin "${name}" is missing required configuration. Configure it before enabling.`);
    }

    loaded.enabled = true;
    this.registerHooks(loaded);
    this.registerDecisionTypes(loaded);

    const db = getSystemDb();
    pluginStore.updatePlugin(db, name, { enabled: true });

    const settings = systemStore.getSystemSettings(db);
    await this.deploySkillsForPlugin(loaded, settings.defaultAgentProvider);
    await this.startTriggersForPlugin(loaded);

    getEventBus().emit('plugin:changed', { pluginName: name, action: 'enabled' });
    log.info(`Enabled plugin: ${name}`);
  }

  async disable(name: string): Promise<void> {
    const loaded = this.plugins.get(name);
    if (!loaded) {
      throw new Error(`Plugin "${name}" is not loaded`);
    }

    if (!loaded.enabled) return;

    await this.stopTriggersForPlugin(name);
    this.deregisterHooks(name);
    this.deregisterDecisionTypes(name);
    await this.removeSkillsForPlugin(loaded);

    loaded.enabled = false;
    loaded.skills = [];
    loaded.mcpServers = {};
    loaded.contextSources = [];
    loaded.hooks = [];
    loaded.decisionTypes = [];
    loaded.triggers = [];
    loaded.agents = [];

    const db = getSystemDb();
    pluginStore.updatePlugin(db, name, { enabled: false });

    getEventBus().emit('plugin:changed', { pluginName: name, action: 'disabled' });
    log.info(`Disabled plugin: ${name}`);
  }

  // -------------------------------------------------------------------------
  // Skills
  // -------------------------------------------------------------------------

  async deploySkills(provider: string): Promise<void> {
    await this.cleanupSkills();
    for (const loaded of this.plugins.values()) {
      if (!loaded.enabled) continue;
      await this.deploySkillsForPlugin(loaded, provider);
    }
    // Create/refresh the Claude SDK bridge for skill discovery
    if (provider === 'claude') {
      await this.ensureSkillBridge();
    }
  }

  async cleanupSkills(): Promise<void> {
    for (const skillPath of this.deployedSkillPaths) {
      try {
        await fs.rm(skillPath, { recursive: true, force: true });
      } catch {
        // Ignore — may already be removed
      }
    }
    this.deployedSkillPaths = [];
  }

  /**
   * Get the path to the Claude SDK skill bridge directory.
   *
   * The bridge is a minimal pseudo-plugin that the Claude Agent SDK loads via
   * its `plugins` config. It contains only a `skills/` symlink pointing to
   * `.claude/skills/` where all Animus plugin skills are already deployed.
   * This allows the SDK to discover skills without needing
   * `settingSources: ['project']` (which would also load CLAUDE.md).
   */
  getSkillBridgePath(): string {
    return path.join(PROJECT_ROOT, '.claude', 'animus-skill-bridge');
  }

  /**
   * Create or refresh the Claude SDK skill bridge directory.
   *
   * Structure:
   *   .claude/animus-skill-bridge/
   *   ├── .claude-plugin/
   *   │   └── plugin.json          # Minimal manifest for the Claude SDK
   *   └── skills -> .claude/skills/
   */
  private async ensureSkillBridge(): Promise<void> {
    const bridgePath = this.getSkillBridgePath();
    const manifestDir = path.join(bridgePath, '.claude-plugin');
    const manifestPath = path.join(manifestDir, 'plugin.json');
    const bridgeSkillsLink = path.join(bridgePath, 'skills');
    const skillsDir = path.join(PROJECT_ROOT, '.claude', 'skills');

    try {
      // Create bridge directory and .claude-plugin/ manifest dir
      await fs.mkdir(manifestDir, { recursive: true });

      // Write the Claude SDK plugin manifest with explicit skills path
      const manifest = JSON.stringify({
        name: 'animus-skills',
        description: 'Animus plugin skills bridge',
        version: '1.0.0',
        skills: './skills/',
      }, null, 2);
      await fs.writeFile(manifestPath, manifest, 'utf-8');

      // Create skills/ symlink pointing to .claude/skills/
      try {
        await fs.rm(bridgeSkillsLink, { recursive: true, force: true });
      } catch {
        // Doesn't exist — fine
      }
      await fs.symlink(skillsDir, bridgeSkillsLink, 'dir');

      log.info(`Claude SDK skill bridge created: ${bridgePath} (${bridgeSkillsLink} → ${skillsDir})`);
    } catch (err) {
      log.error('Failed to create Claude SDK skill bridge:', err);
    }
  }

  private async deploySkillsForPlugin(loaded: LoadedPlugin, provider: string): Promise<void> {
    log.debug(`Deploying ${loaded.skills.length} skills for ${loaded.manifest.name} (provider: ${provider})`);
    for (const skill of loaded.skills) {
      // Use skill name directly (Agent Skills spec: name must match parent dir)
      const targetPath = this.getProviderSkillPath(provider, skill.name);
      log.debug(`Deploying skill "${skill.name}": ${skill.absolutePath} → ${targetPath}`);

      // Collision detection: check if another plugin already deployed this skill name
      if (this.deployedSkillPaths.includes(targetPath)) {
        const owner = this.findSkillOwner(skill.name, loaded.manifest.name);
        log.warn(`Skill name collision: "${skill.name}" from "${loaded.manifest.name}" conflicts with "${owner}" — skipping`);
        continue;
      }

      try {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        // Remove existing symlink/dir if present
        try {
          await fs.rm(targetPath, { recursive: true, force: true });
        } catch {
          // Doesn't exist — fine
        }
        await fs.symlink(skill.absolutePath, targetPath, 'dir');
        this.deployedSkillPaths.push(targetPath);
        log.info(`Deployed skill "${skill.name}" → ${targetPath}`);
      } catch (err) {
        log.error(`Failed to deploy skill ${skill.name} (${loaded.manifest.name}):`, err);
      }
    }
  }

  private async removeSkillsForPlugin(loaded: LoadedPlugin): Promise<void> {
    for (const skill of loaded.skills) {
      // Check all provider paths since we may not know which is active
      for (const provider of ['claude', 'codex', 'opencode']) {
        const targetPath = this.getProviderSkillPath(provider, skill.name);
        try {
          await fs.rm(targetPath, { recursive: true, force: true });
          this.deployedSkillPaths = this.deployedSkillPaths.filter(p => p !== targetPath);
        } catch {
          // Ignore
        }
      }
    }
  }

  private getProviderSkillPath(provider: string, skillName: string): string {
    switch (provider) {
      case 'claude':
        return path.join(PROJECT_ROOT, '.claude', 'skills', skillName);
      case 'codex':
        return path.join(PROJECT_ROOT, '.agents', 'skills', skillName);
      case 'opencode':
        return path.join(PROJECT_ROOT, '.opencode', 'skills', skillName);
      default:
        return path.join(PROJECT_ROOT, '.claude', 'skills', skillName);
    }
  }

  // -------------------------------------------------------------------------
  // Decision Types
  // -------------------------------------------------------------------------

  getDecisionTypes(): DecisionTypeDefinition[] {
    return Array.from(this.decisionRegistry.values()).map(e => e.definition);
  }

  getDecisionDescriptions(): string {
    const entries = Array.from(this.decisionRegistry.values());
    if (entries.length === 0) return '';

    return entries.map(({ definition }) => {
      const props = (definition.payloadSchema as Record<string, unknown>)['properties'] as Record<string, unknown> | undefined;
      const payloadDesc = Object.entries(props ?? {})
        .map(([key, schema]) => {
          const s = schema as Record<string, unknown>;
          const type = s['type'] ?? 'unknown';
          const enumArr = s['enum'] as string[] | undefined;
          const enumVals = enumArr ? enumArr.map(v => `"${v}"`).join('|') : null;
          return `${key}: ${enumVals ?? type}`;
        })
        .join(', ');

      return `- ${definition.name}: ${definition.description}\n    Payload: { ${payloadDesc} }\n    Required contact tier: ${definition.contactTier}`;
    }).join('\n');
  }

  async executeDecision(
    type: string,
    payload: unknown,
    contactTier: string,
  ): Promise<HandlerResult> {
    const entry = this.decisionRegistry.get(type);
    if (!entry) {
      return { success: false, error: `Unknown decision type: ${type}` };
    }

    // Contact tier enforcement
    const tierRank: Record<string, number> = { primary: 2, standard: 1, unknown: 0 };
    const requiredRank = tierRank[entry.definition.contactTier] ?? 2;
    const actualRank = tierRank[contactTier] ?? 0;
    if (actualRank < requiredRank) {
      return { success: false, error: `Insufficient contact tier: requires ${entry.definition.contactTier}, got ${contactTier}` };
    }

    const loaded = this.plugins.get(entry.pluginName);
    const config = loaded ? this.getDecryptedConfig(entry.pluginName) : null;
    const command = this.substitutePluginRoot(entry.definition.handler.command, loaded?.absolutePath ?? '');

    return this.executeHandler(command, { event: payload, config }, 30_000);
  }

  private registerDecisionTypes(loaded: LoadedPlugin): void {
    for (const def of loaded.decisionTypes) {
      if (this.decisionRegistry.has(def.name)) {
        const existing = this.decisionRegistry.get(def.name)!;
        log.warn(`Decision type collision: "${def.name}" from "${loaded.manifest.name}" conflicts with "${existing.pluginName}"`);
        continue;
      }
      this.decisionRegistry.set(def.name, { definition: def, pluginName: loaded.manifest.name });
    }
  }

  private deregisterDecisionTypes(pluginName: string): void {
    for (const [name, entry] of this.decisionRegistry.entries()) {
      if (entry.pluginName === pluginName) {
        this.decisionRegistry.delete(name);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------

  async fireHook(
    event: string,
    data: unknown,
  ): Promise<{ blocked: boolean; modifiedData?: unknown }> {
    const handlers = this.hookRegistry.get(event);
    if (!handlers || handlers.length === 0) {
      return { blocked: false };
    }

    const isBlocking = event.startsWith('pre');
    const timeout = isBlocking ? 10_000 : 30_000;

    if (isBlocking) {
      // Run sequentially for blocking hooks
      for (const handler of handlers) {
        const config = this.getDecryptedConfig(handler.pluginName);
        const result = await this.executeHandler(handler.command, { event: data, config }, timeout);
        if (!result.success) {
          log.info(`Hook blocked ${event} (plugin: ${handler.pluginName})`);
          return { blocked: true, modifiedData: result.result };
        }
      }
    } else {
      // Run all non-blocking hooks in parallel
      const promises = handlers.map(async handler => {
        const config = this.getDecryptedConfig(handler.pluginName);
        try {
          await this.executeHandler(handler.command, { event: data, config }, timeout);
        } catch (err) {
          log.warn(`Non-blocking hook failed for ${event} (plugin: ${handler.pluginName}):`, err);
        }
      });
      await Promise.allSettled(promises);
    }

    return { blocked: false };
  }

  private registerHooks(loaded: LoadedPlugin): void {
    for (const def of loaded.hooks) {
      const command = this.substitutePluginRoot(def.handler.command, loaded.absolutePath);
      const list = this.hookRegistry.get(def.event) ?? [];
      list.push({ definition: def, pluginName: loaded.manifest.name, command });
      this.hookRegistry.set(def.event, list);
    }
  }

  private deregisterHooks(pluginName: string): void {
    for (const [event, handlers] of this.hookRegistry.entries()) {
      const filtered = handlers.filter(h => h.pluginName !== pluginName);
      if (filtered.length === 0) {
        this.hookRegistry.delete(event);
      } else {
        this.hookRegistry.set(event, filtered);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Triggers
  // -------------------------------------------------------------------------

  getHttpTriggers(): Array<{ pluginName: string; definition: TriggerDefinition }> {
    const triggers: Array<{ pluginName: string; definition: TriggerDefinition }> = [];
    for (const loaded of this.plugins.values()) {
      if (!loaded.enabled) continue;
      for (const t of loaded.triggers) {
        if (t.type === 'http') {
          triggers.push({ pluginName: loaded.manifest.name, definition: t });
        }
      }
    }
    return triggers;
  }

  getTriggerSources(): Array<{ pluginName: string; definition: TriggerDefinition }> {
    const sources: Array<{ pluginName: string; definition: TriggerDefinition }> = [];
    for (const loaded of this.plugins.values()) {
      if (!loaded.enabled) continue;
      for (const t of loaded.triggers) {
        sources.push({ pluginName: loaded.manifest.name, definition: t });
      }
    }
    return sources;
  }

  async startTriggers(): Promise<void> {
    for (const loaded of this.plugins.values()) {
      if (!loaded.enabled) continue;
      await this.startTriggersForPlugin(loaded);
    }
  }

  async stopTriggers(): Promise<void> {
    for (const w of this.watchers) {
      w.stopped = true;
      w.process?.kill('SIGTERM');
    }
    this.watchers = [];
  }

  private async startTriggersForPlugin(loaded: LoadedPlugin): Promise<void> {
    for (const trigger of loaded.triggers) {
      if (trigger.type !== 'watcher') continue;
      if (!trigger.config.command) continue;

      const command = this.substitutePluginRoot(trigger.config.command, loaded.absolutePath);
      const watcher: WatcherProcess = {
        pluginName: loaded.manifest.name,
        triggerName: trigger.name,
        process: null,
        failures: 0,
        backoffMs: 1000,
        stopped: false,
      };
      this.watchers.push(watcher);
      this.spawnWatcher(watcher, command);
    }
  }

  private async stopTriggersForPlugin(pluginName: string): Promise<void> {
    const toStop = this.watchers.filter(w => w.pluginName === pluginName);
    for (const w of toStop) {
      w.stopped = true;
      w.process?.kill('SIGTERM');
    }
    this.watchers = this.watchers.filter(w => w.pluginName !== pluginName);
  }

  private spawnWatcher(watcher: WatcherProcess, command: string): void {
    if (watcher.stopped) return;

    const parts = command.split(/\s+/);
    const cmd = parts[0]!;
    const args = parts.slice(1);

    const proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    watcher.process = proc;

    let buffer = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          // Reset failure count on successful event
          watcher.failures = 0;
          watcher.backoffMs = 1000;

          log.debug(`Watcher event from ${watcher.pluginName}/${watcher.triggerName}:`, event);
          // TODO: Enqueue tick via heartbeat when integration is wired (WP4)
        } catch {
          log.warn(`Invalid JSON from watcher ${watcher.pluginName}/${watcher.triggerName}: ${trimmed}`);
        }
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      log.warn(`Watcher ${watcher.pluginName}/${watcher.triggerName} stderr:`, chunk.toString().trim());
    });

    proc.on('exit', (code) => {
      if (watcher.stopped) return;

      watcher.failures++;
      if (watcher.failures >= 5) {
        log.error(`Watcher ${watcher.pluginName}/${watcher.triggerName} failed ${watcher.failures} times — marking as failed`);
        return;
      }

      log.warn(`Watcher ${watcher.pluginName}/${watcher.triggerName} exited (code ${code}), restarting in ${watcher.backoffMs}ms`);
      setTimeout(() => {
        watcher.backoffMs = Math.min(watcher.backoffMs * 2, 60_000);
        this.spawnWatcher(watcher, command);
      }, watcher.backoffMs);
    });
  }

  // -------------------------------------------------------------------------
  // MCP Config
  // -------------------------------------------------------------------------

  getMcpConfigs(): Record<string, PluginMcpServer> {
    const configs: Record<string, PluginMcpServer> = {};
    for (const loaded of this.plugins.values()) {
      if (!loaded.enabled) continue;
      for (const [serverName, serverConfig] of Object.entries(loaded.mcpServers)) {
        const namespacedKey = `${loaded.manifest.name}__${serverName}`;
        const pluginConfig = this.getDecryptedConfig(loaded.manifest.name);

        const resolveConfigVars = (str: string): string => {
          if (!pluginConfig) return str;
          return str.replace(
            /\$\{config\.([^}]+)\}/g,
            (_, configKey: string) => {
              const val = pluginConfig[configKey];
              return typeof val === 'string' ? val : '';
            },
          );
        };

        // Resolve ${config.*} placeholders in env, url, and header values
        const resolvedEnv = Object.fromEntries(
          Object.entries(serverConfig.env).map(([k, v]) => [k, resolveConfigVars(v)])
        );
        const resolvedUrl = serverConfig.url ? resolveConfigVars(serverConfig.url) : undefined;
        const resolvedHeaders = Object.fromEntries(
          Object.entries(serverConfig.headers).map(([k, v]) => [k, resolveConfigVars(v)])
        );

        configs[namespacedKey] = {
          ...serverConfig,
          env: resolvedEnv,
          ...(resolvedUrl !== undefined ? { url: resolvedUrl } : {}),
          headers: resolvedHeaders,
        };
      }
    }
    return configs;
  }

  /**
   * Convert resolved plugin MCP configs into the format the Claude SDK expects.
   * Returns mcpServers config objects and wildcard allowedTools patterns.
   */
  getPluginMcpServersForSdk(): {
    mcpServers: Record<string, Record<string, unknown>>;
    allowedTools: string[];
  } {
    const resolved = this.getMcpConfigs();
    const mcpServers: Record<string, Record<string, unknown>> = {};
    const allowedTools: string[] = [];

    for (const [key, config] of Object.entries(resolved)) {
      if (config.url) {
        mcpServers[key] = { type: 'http', url: config.url, headers: config.headers };
      } else if (config.command) {
        mcpServers[key] = { command: config.command, args: config.args, env: config.env };
      }
      allowedTools.push(`mcp__${key}__*`);
    }

    return { mcpServers, allowedTools };
  }

  /**
   * Build a credential manifest listing all secret config fields across
   * enabled plugins. Used to inform the mind what credentials are available
   * for `run_with_credentials` without exposing raw values.
   */
  getCredentialManifest(): Array<{
    ref: string;       // "nano-banana-pro.GEMINI_API_KEY"
    label: string;     // "Gemini API Key"
    plugin: string;    // "nano-banana-pro"
    envVar: string;    // "GEMINI_API_KEY"
    hint: string;      // "...a1b2" or "(not set)"
  }> {
    const manifest: Array<{
      ref: string;
      label: string;
      plugin: string;
      envVar: string;
      hint: string;
    }> = [];

    for (const loaded of this.plugins.values()) {
      if (!loaded.enabled || !loaded.configSchema) continue;
      const config = this.getDecryptedConfig(loaded.manifest.name);

      for (const field of loaded.configSchema.fields) {
        if (field.type !== 'secret') continue;

        const value = config?.[field.key];
        const hint = typeof value === 'string' && value.length >= 4
          ? `...${value.slice(-4)}`
          : '(not set)';

        manifest.push({
          ref: `${loaded.manifest.name}.${field.key}`,
          label: field.label,
          plugin: loaded.manifest.name,
          envVar: field.key,
          hint,
        });
      }
    }

    return manifest;
  }

  // -------------------------------------------------------------------------
  // Agent Templates
  // -------------------------------------------------------------------------

  getAgentCatalog(): Array<{ name: string; description: string; pluginName: string }> {
    const catalog: Array<{ name: string; description: string; pluginName: string }> = [];
    for (const loaded of this.plugins.values()) {
      if (!loaded.enabled) continue;
      for (const agent of loaded.agents) {
        catalog.push({
          name: agent.frontmatter.name,
          description: agent.frontmatter.description,
          pluginName: loaded.manifest.name,
        });
      }
    }
    return catalog;
  }

  getAgentTemplate(name: string): { prompt: string; tools: string[]; maxTurns?: number } | undefined {
    for (const loaded of this.plugins.values()) {
      if (!loaded.enabled) continue;
      const agent = loaded.agents.find(a => a.frontmatter.name === name);
      if (agent) {
        const result: { prompt: string; tools: string[]; maxTurns?: number } = {
          prompt: agent.prompt,
          tools: agent.frontmatter.tools,
        };
        if (agent.frontmatter.maxTurns !== undefined) {
          result.maxTurns = agent.frontmatter.maxTurns;
        }
        return result;
      }
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Context Sources
  // -------------------------------------------------------------------------

  getStaticContextSources(): Array<{ name: string; content: string; priority: number }> {
    const sources: Array<{ name: string; content: string; priority: number }> = [];
    for (const loaded of this.plugins.values()) {
      if (!loaded.enabled) continue;
      for (const cs of loaded.contextSources) {
        if (cs.type !== 'static') continue;
        const cached = this.staticContentCache.get(`${loaded.manifest.name}:${cs.name}`);
        if (cached) {
          sources.push({ name: cs.name, content: cached, priority: cs.priority });
        }
      }
    }
    return sources;
  }

  async getRetrievalContextSources(
    tickContext: unknown,
  ): Promise<Array<{ name: string; content: string; priority: number }>> {
    const sources: Array<{ name: string; content: string; priority: number }> = [];
    const promises: Promise<void>[] = [];

    for (const loaded of this.plugins.values()) {
      if (!loaded.enabled) continue;
      for (const cs of loaded.contextSources) {
        if (cs.type !== 'retrieval' || !cs.provider) continue;

        const command = this.substitutePluginRoot(
          `${cs.provider.command} ${cs.provider.args.join(' ')}`,
          loaded.absolutePath,
        );
        const config = this.getDecryptedConfig(loaded.manifest.name);

        promises.push(
          this.executeHandler(command, { event: tickContext, config }, 10_000).then(result => {
            if (result.success && result.result) {
              sources.push({
                name: cs.name,
                content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
                priority: cs.priority,
              });
            }
          }).catch(err => {
            log.warn(`Context retrieval failed for ${cs.name} (${loaded.manifest.name}):`, err);
          })
        );
      }
    }

    await Promise.allSettled(promises);
    return sources;
  }

  // -------------------------------------------------------------------------
  // Config Management
  // -------------------------------------------------------------------------

  /**
   * Get plugin config with secret fields masked for frontend display.
   * Secret values are replaced with '••••••••' — never sent to the client.
   */
  getPluginConfigMasked(name: string): Record<string, unknown> | null {
    const config = this.getDecryptedConfig(name);
    if (!config) return null;

    const loaded = this.plugins.get(name);
    if (!loaded?.configSchema) return config;

    const secretKeys = new Set(
      loaded.configSchema.fields
        .filter(f => f.type === 'secret')
        .map(f => f.key),
    );

    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      masked[key] = secretKeys.has(key) && value ? '••••••••' : value;
    }
    return masked;
  }

  /**
   * Get fully decrypted plugin config (for internal use / handler injection).
   */
  getPluginConfig(name: string): Record<string, unknown> | null {
    return this.getDecryptedConfig(name);
  }

  getPluginConfigSchema(name: string): ConfigSchema | null {
    return this.plugins.get(name)?.configSchema ?? null;
  }

  setPluginConfig(name: string, config: Record<string, unknown>): void {
    const db = getSystemDb();
    const encrypted = encrypt(JSON.stringify(config));
    pluginStore.updatePluginConfig(db, name, encrypted);

    getEventBus().emit('plugin:config_updated', { pluginName: name });
    log.info(`Updated config for plugin: ${name}`);
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  getPlugin(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }

  getAllPlugins(): Array<{ name: string; manifest: PluginManifest; source: PluginSource; enabled: boolean }> {
    return Array.from(this.plugins.values()).map(p => ({
      name: p.manifest.name,
      manifest: p.manifest,
      source: p.source,
      enabled: p.enabled,
    }));
  }

  /**
   * Check whether a plugin has all required config fields filled.
   * Mirrors ChannelManager.hasRequiredConfig().
   */
  hasRequiredConfig(name: string): boolean {
    const loaded = this.plugins.get(name);
    if (!loaded?.configSchema) return true; // no schema = no requirements

    const requiredFields = loaded.configSchema.fields.filter(f => f.required);
    if (requiredFields.length === 0) return true;

    const config = this.getDecryptedConfig(name);
    return !requiredFields.some(f =>
      !config || config[f.key] === undefined || config[f.key] === '' || config[f.key] === null
    );
  }

  // -------------------------------------------------------------------------
  // Directory Scanning
  // -------------------------------------------------------------------------

  private async scanAllDirectories(): Promise<Array<[string, PluginManifest, PluginSource]>> {
    const results: Array<[string, PluginManifest, PluginSource]> = [];

    // 1. Built-in plugins (relative to project root)
    const builtInDir = path.join(PROJECT_ROOT, 'packages', 'backend', 'plugins');
    const builtIn = await this.scanDirectory(builtInDir, 'built-in');
    results.push(...builtIn);

    // 2. Downloaded plugins (~/.animus/plugins/)
    const userDir = path.join(os.homedir(), '.animus', 'plugins');
    const downloaded = await this.scanDirectory(userDir, 'local');
    results.push(...downloaded);

    // 3. Registered paths from DB (picks up plugins at arbitrary paths)
    const discoveredPaths = new Set(results.map(([p]) => p));
    const db = getSystemDb();
    const dbPlugins = pluginStore.getAllPlugins(db);
    for (const record of dbPlugins) {
      if (discoveredPaths.has(record.path)) continue;
      try {
        const manifest = await this.readManifest(record.path);
        results.push([record.path, manifest, record.source]);
      } catch {
        log.warn(`Could not load registered plugin at ${record.path}`);
      }
    }

    return results;
  }

  private async scanDirectory(
    dir: string,
    source: PluginSource,
  ): Promise<Array<[string, PluginManifest, PluginSource]>> {
    const results: Array<[string, PluginManifest, PluginSource]> = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pluginDir = path.join(dir, entry.name);
        try {
          const manifest = await this.readManifest(pluginDir);
          results.push([pluginDir, manifest, source]);
        } catch (err) {
          log.debug(`Skipping ${pluginDir}: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch {
      // Directory doesn't exist — that's fine
      log.debug(`Plugin directory does not exist: ${dir}`);
    }

    return results;
  }

  private async readManifest(pluginDir: string): Promise<PluginManifest> {
    const manifestPath = path.join(pluginDir, 'plugin.json');
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const json = JSON.parse(raw);
    return PluginManifestSchema.parse(json);
  }

  // -------------------------------------------------------------------------
  // Component Loading
  // -------------------------------------------------------------------------

  private async loadComponents(loaded: LoadedPlugin): Promise<void> {
    const { manifest, absolutePath } = loaded;
    const comps = manifest.components;

    // Config schema
    if (manifest.configSchema) {
      loaded.configSchema = await this.loadConfigSchema(absolutePath, manifest.configSchema);
    }

    // Icon
    if (manifest.icon) {
      try {
        const iconPath = path.resolve(absolutePath, manifest.icon);
        loaded.iconSvg = await fs.readFile(iconPath, 'utf-8');
      } catch {
        log.debug(`No icon found for ${manifest.name}`);
      }
    }

    // Skills
    if (comps.skills) {
      loaded.skills = await this.loadSkills(absolutePath, comps.skills);
    }

    // Tools (MCP servers)
    if (comps.tools) {
      loaded.mcpServers = await this.loadMcpServers(absolutePath, comps.tools);
    }

    // Context sources
    if (comps.context) {
      loaded.contextSources = await this.loadContextSources(absolutePath, comps.context);
    }

    // Hooks
    if (comps.hooks) {
      loaded.hooks = await this.loadHooks(absolutePath, comps.hooks);
    }

    // Decisions
    if (comps.decisions) {
      loaded.decisionTypes = await this.loadDecisionTypes(absolutePath, comps.decisions);
    }

    // Triggers
    if (comps.triggers) {
      loaded.triggers = await this.loadTriggers(absolutePath, comps.triggers);
    }

    // Agents
    if (comps.agents) {
      loaded.agents = await this.loadAgents(absolutePath, comps.agents);
    }

    // Cache static context source content
    for (const cs of loaded.contextSources) {
      if (cs.type === 'static' && cs.content) {
        try {
          const contentPath = this.substitutePluginRoot(cs.content, absolutePath);
          const content = await fs.readFile(contentPath, 'utf-8');
          this.staticContentCache.set(`${manifest.name}:${cs.name}`, content);
        } catch (err) {
          log.warn(`Failed to cache static content for ${cs.name} (${manifest.name}):`, err);
        }
      }
    }
  }

  private async loadConfigSchema(
    pluginDir: string,
    schemaPath: string,
  ): Promise<ConfigSchema | null> {
    const filePath = path.resolve(pluginDir, schemaPath);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const json = JSON.parse(raw);
      return configSchemaSchema.parse(json);
    } catch (err) {
      log.warn(`Failed to load config schema from ${filePath}:`, err);
      return null;
    }
  }

  private async loadSkills(
    pluginDir: string,
    skillsPath: string,
  ): Promise<Array<{ name: string; absolutePath: string }>> {
    const skills: Array<{ name: string; absolutePath: string }> = [];
    const dir = path.resolve(pluginDir, skillsPath);
    log.debug(`Loading skills from: ${dir}`);

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      log.debug(`Found ${entries.length} entries in skills dir: ${entries.map(e => `${e.name}(${e.isDirectory() ? 'dir' : 'file'})`).join(', ')}`);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillDir = path.join(dir, entry.name);
        // Check for SKILL.md
        try {
          await fs.access(path.join(skillDir, 'SKILL.md'));
          skills.push({ name: entry.name, absolutePath: skillDir });
          log.debug(`Found skill: ${entry.name} at ${skillDir}`);
        } catch {
          log.debug(`No SKILL.md in ${skillDir}, skipping`);
        }
      }
    } catch (err) {
      log.debug(`Skills directory not found: ${dir}`, err);
    }

    log.debug(`Loaded ${skills.length} skills total`);
    return skills;
  }

  private async loadMcpServers(
    pluginDir: string,
    toolsPath: string,
  ): Promise<Record<string, PluginMcpServer>> {
    const filePath = path.resolve(pluginDir, toolsPath);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const json = JSON.parse(raw) as Record<string, unknown>;
      const servers: Record<string, PluginMcpServer> = {};

      for (const [name, config] of Object.entries(json)) {
        const parsed = PluginMcpServerSchema.parse(config);
        if (parsed.url) {
          // HTTP transport
          servers[name] = {
            ...parsed,
            url: this.substitutePluginRoot(parsed.url, pluginDir),
            headers: Object.fromEntries(
              Object.entries(parsed.headers).map(([k, v]) => [k, this.substitutePluginRoot(v, pluginDir)])
            ),
          };
        } else if (parsed.command) {
          // Stdio transport
          servers[name] = {
            ...parsed,
            command: this.substitutePluginRoot(parsed.command, pluginDir),
            args: parsed.args.map(a => this.substitutePluginRoot(a, pluginDir)),
            env: Object.fromEntries(
              Object.entries(parsed.env).map(([k, v]) => [k, this.substitutePluginRoot(v, pluginDir)])
            ),
          };
        }
      }

      return servers;
    } catch (err) {
      log.warn(`Failed to load MCP servers from ${filePath}:`, err);
      return {};
    }
  }

  private async loadContextSources(
    pluginDir: string,
    contextPath: string,
  ): Promise<ContextSource[]> {
    const filePath = path.resolve(pluginDir, contextPath);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const json = JSON.parse(raw);
      const sourcesRaw = json.sources ?? json;
      const arr = Array.isArray(sourcesRaw) ? sourcesRaw : [sourcesRaw];
      return arr.map((s: unknown) => ContextSourceSchema.parse(s));
    } catch (err) {
      log.warn(`Failed to load context sources from ${filePath}:`, err);
      return [];
    }
  }

  private async loadHooks(pluginDir: string, hooksPath: string): Promise<HookDefinition[]> {
    const filePath = path.resolve(pluginDir, hooksPath);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const json = JSON.parse(raw);
      const hooksRaw = json.hooks ?? json;
      const arr = Array.isArray(hooksRaw) ? hooksRaw : [hooksRaw];
      return arr.map((h: unknown) => HookDefinitionSchema.parse(h));
    } catch (err) {
      log.warn(`Failed to load hooks from ${filePath}:`, err);
      return [];
    }
  }

  private async loadDecisionTypes(
    pluginDir: string,
    decisionsPath: string,
  ): Promise<DecisionTypeDefinition[]> {
    const filePath = path.resolve(pluginDir, decisionsPath);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const json = JSON.parse(raw);
      const typesRaw = json.types ?? json;
      const arr = Array.isArray(typesRaw) ? typesRaw : [typesRaw];
      return arr.map((d: unknown) => DecisionTypeSchema.parse(d));
    } catch (err) {
      log.warn(`Failed to load decision types from ${filePath}:`, err);
      return [];
    }
  }

  private async loadTriggers(
    pluginDir: string,
    triggersPath: string,
  ): Promise<TriggerDefinition[]> {
    const filePath = path.resolve(pluginDir, triggersPath);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const json = JSON.parse(raw);
      const triggersRaw = json.triggers ?? json;
      const arr = Array.isArray(triggersRaw) ? triggersRaw : [triggersRaw];
      return arr.map((t: unknown) => TriggerDefinitionSchema.parse(t));
    } catch (err) {
      log.warn(`Failed to load triggers from ${filePath}:`, err);
      return [];
    }
  }

  private async loadAgents(
    pluginDir: string,
    agentsPath: string,
  ): Promise<Array<{ frontmatter: AgentFrontmatter; prompt: string }>> {
    const agents: Array<{ frontmatter: AgentFrontmatter; prompt: string }> = [];
    const dir = path.resolve(pluginDir, agentsPath);

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        try {
          const content = await fs.readFile(path.join(dir, entry.name), 'utf-8');
          const parsed = this.parseAgentFrontmatter(content);
          if (parsed) {
            agents.push(parsed);
          }
        } catch (err) {
          log.warn(`Failed to parse agent ${entry.name}:`, err);
        }
      }
    } catch {
      log.debug(`Agents directory not found: ${dir}`);
    }

    return agents;
  }

  // -------------------------------------------------------------------------
  // YAML Frontmatter Parsing (simple regex-based)
  // -------------------------------------------------------------------------

  private parseAgentFrontmatter(content: string): { frontmatter: AgentFrontmatter; prompt: string } | null {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) return null;

    const [, yamlBlock, body] = match;
    if (!yamlBlock || body === undefined) return null;

    // Simple YAML parser for the flat frontmatter we expect
    const data: Record<string, unknown> = {};
    let currentKey = '';
    let listValues: string[] | null = null;

    for (const line of yamlBlock.split('\n')) {
      const listItem = line.match(/^\s+-\s+(.+)$/);
      if (listItem && currentKey) {
        if (!listValues) listValues = [];
        listValues.push(listItem[1]!.trim());
        continue;
      }

      // Flush any pending list
      if (listValues && currentKey) {
        data[currentKey] = listValues;
        listValues = null;
      }

      const kvMatch = line.match(/^(\w+):\s*(.*)$/);
      if (!kvMatch) continue;
      currentKey = kvMatch[1]!;
      const value = kvMatch[2]!.trim();

      if (value === '' || value === '[]') {
        // Could be a list starting on next line, or empty
        listValues = value === '[]' ? [] : null;
        if (value === '[]') {
          data[currentKey] = [];
          listValues = null;
        }
      } else {
        // Scalar value — try number, then string
        const num = Number(value);
        data[currentKey] = !isNaN(num) && value !== '' ? num : value;
      }
    }

    // Flush final list
    if (listValues && currentKey) {
      data[currentKey] = listValues;
    }

    try {
      const frontmatter = AgentFrontmatterSchema.parse(data);
      return { frontmatter, prompt: body.trim() };
    } catch (err) {
      log.warn(`Invalid agent frontmatter:`, err);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Handler Execution (subprocess protocol)
  // -------------------------------------------------------------------------

  private executeHandler(
    command: string,
    input: unknown,
    timeoutMs: number,
  ): Promise<HandlerResult> {
    return new Promise((resolve) => {
      const parts = command.split(/\s+/);
      const cmd = parts[0]!;
      const args = parts.slice(1);

      const proc = spawn(cmd, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill('SIGTERM');
          resolve({ success: false, error: `Handler timed out after ${timeoutMs}ms` });
        }
      }, timeoutMs);

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ success: false, error: `Handler spawn error: ${err.message}` });
        }
      });

      proc.on('exit', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (code !== 0) {
          resolve({ success: false, error: stderr.trim() || `Handler exited with code ${code}` });
          return;
        }

        try {
          const result = JSON.parse(stdout.trim()) as HandlerResult;
          resolve(result);
        } catch {
          // If stdout isn't valid JSON, treat the raw output as the result
          resolve({ success: true, result: stdout.trim() });
        }
      });

      // Send input via stdin
      proc.stdin?.write(JSON.stringify(input));
      proc.stdin?.end();
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private findSkillOwner(skillName: string, excludePlugin: string): string {
    for (const loaded of this.plugins.values()) {
      if (loaded.manifest.name === excludePlugin) continue;
      if (loaded.skills.some(s => s.name === skillName)) {
        return loaded.manifest.name;
      }
    }
    return 'unknown';
  }

  private substitutePluginRoot(value: string, pluginPath: string): string {
    return value.replace(/\$\{PLUGIN_ROOT\}/g, pluginPath);
  }

  private getDecryptedConfig(pluginName: string): Record<string, unknown> | null {
    const db = getSystemDb();
    const record = pluginStore.getPlugin(db, pluginName);
    if (!record?.configEncrypted) return null;

    try {
      const decrypted = decrypt(record.configEncrypted);
      return JSON.parse(decrypted) as Record<string, unknown>;
    } catch (err) {
      log.error(`Failed to decrypt config for plugin ${pluginName}:`, err);
      return null;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: PluginManager | null = null;

export function getPluginManager(): PluginManager {
  if (!instance) {
    instance = new PluginManager();
  }
  return instance;
}

/** Reset singleton for testing. */
export function resetPluginManager(): void {
  instance = null;
}
