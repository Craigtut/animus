/**
 * Channel Manager — singleton that orchestrates all channel process hosts.
 *
 * Responsible for loading, installing, enabling/disabling, and managing
 * the lifecycle of installable channel packages.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createLogger } from '../lib/logger.js';
import { getEventBus } from '../lib/event-bus.js';
import { getSystemDb } from '../db/index.js';
import * as systemStore from '../db/stores/system-store.js';
import { ChannelProcessHost } from './process-host.js';
import { getChannelRouter } from './channel-router.js';
import type {
  ChannelManifest,
  ChannelPackage,
  ChannelInfo,
  ConfigSchema,
  ChannelPackageStatus,
} from '@animus/shared';
import { channelManifestSchema, configSchemaSchema } from '@animus/shared';

const log = createLogger('ChannelManager', 'channels');

export class ChannelManager {
  private processes = new Map<string, ChannelProcessHost>();
  private manifests = new Map<string, ChannelManifest>();
  private configSchemas = new Map<string, ConfigSchema>();
  /** Built-in channels (like web) that run in-process, not as child processes. */
  private builtInSenders = new Map<string, (contactId: string, content: string, metadata?: Record<string, unknown>) => Promise<void>>();

  /**
   * Register a built-in channel (always in-process, not a package).
   * The web channel uses this — its "send" is a no-op because tRPC
   * subscriptions push messages to the frontend via EventBus.
   */
  registerBuiltIn(
    channelType: string,
    sendFn: (contactId: string, content: string, metadata?: Record<string, unknown>) => Promise<void>,
  ): void {
    this.builtInSenders.set(channelType, sendFn);
    log.info(`Registered built-in channel: ${channelType}`);
  }

  /**
   * Load all channel packages from DB, validate manifests, and start enabled ones.
   */
  async loadAll(): Promise<void> {
    const db = getSystemDb();
    const packages = systemStore.getChannelPackages(db);

    for (const pkg of packages) {
      try {
        const manifest = this.loadManifest(pkg.path);
        this.manifests.set(pkg.channelType, manifest);

        const configSchema = this.loadConfigSchema(pkg.path);
        if (configSchema) this.configSchemas.set(pkg.channelType, configSchema);

        // Verify adapter checksum
        const adapterPath = path.join(pkg.path, manifest.adapter);
        const currentChecksum = this.computeChecksum(adapterPath);
        if (currentChecksum !== pkg.checksum) {
          log.warn(`Checksum mismatch for ${pkg.name} — adapter file modified since install`);
          systemStore.updateChannelPackageStatus(db, pkg.name, 'error', 'Adapter checksum mismatch');
          continue;
        }

        if (pkg.enabled) {
          await this.startProcess(pkg, manifest);
        }
      } catch (err) {
        log.error(`Failed to load channel package ${pkg.name}:`, err);
        systemStore.updateChannelPackageStatus(db, pkg.name, 'error', String(err));
      }
    }

    log.info(`Loaded ${this.manifests.size} channel packages (${this.processes.size} running)`);
  }

  /**
   * Stop all running channel processes.
   */
  async stopAll(): Promise<void> {
    const stopPromises = [...this.processes.entries()].map(async ([type, host]) => {
      try {
        await host.stop();
        log.info(`Stopped channel: ${type}`);
      } catch (err) {
        log.error(`Error stopping channel ${type}:`, err);
      }
    });
    await Promise.all(stopPromises);
    this.processes.clear();
  }

  /**
   * Install a channel package from a directory path.
   */
  async installFromPath(dirPath: string): Promise<ChannelManifest> {
    // Read and validate manifest
    const manifest = this.loadManifest(dirPath);

    // Check engine version compatibility if specified
    if (manifest.engine) {
      const engineVersion = this.parseVersion(manifest.engine);
      const appVersion = this.parseVersion(this.getAppVersion());
      if (appVersion && engineVersion && this.compareVersions(appVersion, engineVersion) < 0) {
        throw new Error(
          `Channel "${manifest.name}" requires engine version ${manifest.engine} but current version is ${this.getAppVersion()}`
        );
      }
    }

    // Read and validate config schema
    const configSchema = this.loadConfigSchema(dirPath);

    // Check adapter file exists
    const adapterPath = path.join(dirPath, manifest.adapter);
    if (!fs.existsSync(adapterPath)) {
      throw new Error(`Adapter file not found: ${manifest.adapter}`);
    }

    // Check icon file exists
    const iconPath = path.join(dirPath, manifest.icon);
    if (!fs.existsSync(iconPath)) {
      throw new Error(`Icon file not found: ${manifest.icon}`);
    }

    // Check channel type not already installed
    const db = getSystemDb();
    const existing = systemStore.getChannelPackageByType(db, manifest.type);
    if (existing) {
      throw new Error(`Channel type "${manifest.type}" is already installed as "${existing.name}"`);
    }

    // Compute checksum
    const checksum = this.computeChecksum(adapterPath);

    // Insert into DB
    systemStore.createChannelPackage(db, {
      name: manifest.name,
      channelType: manifest.type,
      version: manifest.version,
      path: dirPath,
      checksum,
    });

    // Store in memory
    this.manifests.set(manifest.type, manifest);
    if (configSchema) this.configSchemas.set(manifest.type, configSchema);

    getEventBus().emit('channel:installed', { name: manifest.name, channelType: manifest.type });
    log.info(`Installed channel package: ${manifest.name} (${manifest.type}) v${manifest.version}`);
    return manifest;
  }

  /**
   * Uninstall a channel package.
   */
  async uninstall(name: string): Promise<void> {
    const db = getSystemDb();
    const pkg = systemStore.getChannelPackage(db, name);
    if (!pkg) {
      throw new Error(`Channel package "${name}" not found`);
    }

    // Stop process if running
    const host = this.processes.get(pkg.channelType);
    if (host) {
      await host.stop();
      this.processes.delete(pkg.channelType);
    }

    // Clean up contact_channels for this channel type
    const removedChannels = systemStore.deleteContactChannelsByChannel(db, pkg.channelType);
    if (removedChannels > 0) {
      log.info(`Removed ${removedChannels} contact channel(s) for type: ${pkg.channelType}`);
    }

    // Remove from DB
    systemStore.deleteChannelPackage(db, name);

    // Clean up maps
    this.manifests.delete(pkg.channelType);
    this.configSchemas.delete(pkg.channelType);

    getEventBus().emit('channel:uninstalled', { name: pkg.name, channelType: pkg.channelType });
    log.info(`Uninstalled channel package: ${name}`);
  }

  /**
   * Check whether a channel has all required config fields filled.
   */
  private hasRequiredConfig(pkg: ChannelPackage): boolean {
    const configSchema = this.configSchemas.get(pkg.channelType);
    if (!configSchema) return true; // no schema = no requirements

    const requiredFields = configSchema.fields.filter(f => f.required);
    if (requiredFields.length === 0) return true;

    const config = pkg.config as Record<string, unknown> | null;
    return !requiredFields.some(f =>
      !config || config[f.key] === undefined || config[f.key] === '' || config[f.key] === null
    );
  }

  /**
   * Enable a channel (start its process).
   */
  async enable(name: string): Promise<void> {
    const db = getSystemDb();
    const pkg = systemStore.getChannelPackage(db, name);
    if (!pkg) {
      throw new Error(`Channel package "${name}" not found`);
    }

    // Block enable when required config fields are missing
    if (!this.hasRequiredConfig(pkg)) {
      throw new Error(`Channel "${name}" is missing required configuration. Configure it before enabling.`);
    }

    // Guard: don't start a duplicate process
    if (this.processes.has(pkg.channelType)) {
      log.warn(`Channel ${name} is already running`);
      return;
    }

    const manifest = this.manifests.get(pkg.channelType);
    if (!manifest) {
      throw new Error(`Manifest not loaded for channel type "${pkg.channelType}"`);
    }

    await this.startProcess(pkg, manifest);

    systemStore.updateChannelPackage(db, name, { enabled: true });
  }

  /**
   * Disable a channel (stop its process).
   */
  async disable(name: string): Promise<void> {
    const db = getSystemDb();
    const pkg = systemStore.getChannelPackage(db, name);
    if (!pkg) {
      throw new Error(`Channel package "${name}" not found`);
    }

    const host = this.processes.get(pkg.channelType);
    if (host) {
      await host.stop();
      this.processes.delete(pkg.channelType);
    }

    systemStore.updateChannelPackage(db, name, { enabled: false, status: 'disabled' });
    this.emitStatusChange(pkg.name, pkg.channelType, 'disabled');
    log.info(`Disabled channel: ${name}`);
  }

  /**
   * Restart a channel.
   */
  async restart(name: string): Promise<void> {
    await this.disable(name);
    await this.enable(name);
  }

  /**
   * Send a message through any channel (built-in or package).
   */
  async sendToChannel(
    channelType: string,
    contactId: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<boolean> {
    // Check built-in channels first (e.g., web)
    const builtIn = this.builtInSenders.get(channelType);
    if (builtIn) {
      try {
        await builtIn(contactId, content, metadata);
        return true;
      } catch (err) {
        log.error(`Failed to send via built-in channel ${channelType}:`, err);
        return false;
      }
    }

    // Then check package channels
    const host = this.processes.get(channelType);
    if (!host || !host.isRunning) {
      log.error(`Cannot send to channel ${channelType}: not running`);
      return false;
    }
    return host.send(contactId, content, metadata);
  }

  /**
   * Check if a channel type is available (built-in or running package).
   */
  isChannelAvailable(channelType: string): boolean {
    return this.builtInSenders.has(channelType) ||
      (this.processes.get(channelType)?.isRunning ?? false);
  }

  /**
   * Get a process host (for catch-all route forwarding).
   */
  getProcess(channelType: string): ChannelProcessHost | undefined {
    return this.processes.get(channelType);
  }

  /**
   * Get all installed channels with status info.
   */
  getInstalledChannels(): ChannelInfo[] {
    const db = getSystemDb();
    const packages = systemStore.getChannelPackages(db);
    return packages.map((pkg) => {
      const manifest = this.manifests.get(pkg.channelType);
      const configSchema = this.configSchemas.get(pkg.channelType);

      // Override status to 'unconfigured' when required config fields are missing
      let effectiveStatus = pkg.status;
      if (!this.hasRequiredConfig(pkg)) {
        effectiveStatus = 'unconfigured';
      }

      return {
        name: pkg.name,
        channelType: pkg.channelType,
        displayName: manifest?.displayName ?? pkg.name,
        description: manifest?.description ?? '',
        version: pkg.version,
        author: manifest?.author ?? { name: 'Unknown' },
        icon: manifest?.icon ?? '',
        capabilities: manifest?.capabilities ?? [],
        identity: manifest?.identity ?? { identifierLabel: 'ID' },
        enabled: pkg.enabled,
        status: effectiveStatus,
        lastError: pkg.lastError,
        installedAt: pkg.installedAt,
      };
    });
  }

  /**
   * Get manifest for a channel type.
   */
  getChannelManifest(channelType: string): ChannelManifest | undefined {
    return this.manifests.get(channelType);
  }

  /**
   * Get config schema for a channel type.
   */
  getConfigSchema(channelType: string): ConfigSchema | undefined {
    return this.configSchemas.get(channelType);
  }

  /**
   * Get all available channel types (built-in + installed packages).
   */
  getChannelTypes(): string[] {
    return [...new Set([...this.builtInSenders.keys(), ...this.manifests.keys()])];
  }

  // ---- Internal ----

  private async startProcess(pkg: ChannelPackage, manifest: ChannelManifest): Promise<void> {
    const db = getSystemDb();
    systemStore.updateChannelPackageStatus(db, pkg.name, 'starting');
    this.emitStatusChange(pkg.name, pkg.channelType, 'starting');

    // Get secret keys from config schema
    const configSchema = this.configSchemas.get(pkg.channelType);
    const secretKeys = configSchema?.fields
      .filter((f) => f.type === 'secret')
      .map((f) => f.key) ?? [];

    // Decrypt config
    const decryptedConfig = systemStore.getChannelPackageConfig(db, pkg.name, secretKeys) ?? {};

    const host = new ChannelProcessHost({
      pkg,
      manifest,
      decryptedConfig,
      onIncoming: (msg) => {
        const router = getChannelRouter();
        router.handleIncoming({
          channel: pkg.channelType as Parameters<typeof router.handleIncoming>[0]['channel'],
          identifier: msg.identifier,
          content: msg.content,
          ...(msg.conversationId ? { conversationId: msg.conversationId } : {}),
          ...(msg.media ? { media: msg.media } : {}),
          ...(msg.metadata ? { metadata: msg.metadata } : {}),
        });
      },
      onStatusChange: (status, error) => {
        systemStore.updateChannelPackageStatus(db, pkg.name, status as ChannelPackageStatus, error ?? null);
        this.emitStatusChange(pkg.name, pkg.channelType, status as ChannelPackageStatus, error);
      },
      onRouteRegister: (method, routePath) => {
        log.info(`Channel ${pkg.name} registered route: ${method} ${routePath}`);
      },
      resolveContact: async (contactId) => {
        const channels = systemStore.getContactChannelsByContactId(db, contactId);
        const match = channels.find((c) => c.channel === pkg.channelType);
        if (!match) return null;
        const contact = systemStore.getContact(db, contactId);
        const result: { identifier: string; displayName?: string } = {
          identifier: match.identifier,
        };
        if (contact?.fullName) result.displayName = contact.fullName;
        return result;
      },
      downloadMedia: async (params) => {
        const ext = params.filename?.split('.').pop() ?? 'bin';
        const id = crypto.randomUUID();
        const localPath = path.join('data', 'media', `${id}.${ext}`);

        fs.mkdirSync(path.dirname(localPath), { recursive: true });

        const fetchOptions: RequestInit = {};
        if (params.auth) {
          if (params.auth.type === 'basic') {
            fetchOptions.headers = {
              'Authorization': `Basic ${Buffer.from(`${params.auth.username}:${params.auth.password}`).toString('base64')}`,
            };
          } else {
            fetchOptions.headers = { 'Authorization': `Bearer ${params.auth.token}` };
          }
        }

        const resp = await fetch(params.url, fetchOptions);
        if (!resp.ok) {
          throw new Error(`Media download failed: ${resp.status} ${resp.statusText}`);
        }
        const buffer = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(localPath, buffer);

        return { localPath, sizeBytes: buffer.length };
      },
    });

    try {
      await host.start();
      this.processes.set(pkg.channelType, host);
      systemStore.updateChannelPackageStatus(db, pkg.name, 'connected');
      this.emitStatusChange(pkg.name, pkg.channelType, 'connected');
      log.info(`Channel ${pkg.name} (${pkg.channelType}) started successfully`);
    } catch (err) {
      log.error(`Failed to start channel ${pkg.name}:`, err);
      // Kill the child process if it was forked but failed to become ready
      try { await host.stop(); } catch { /* ignore cleanup errors */ }
      systemStore.updateChannelPackageStatus(db, pkg.name, 'error', String(err));
      this.emitStatusChange(pkg.name, pkg.channelType, 'error', String(err));
    }
  }

  private emitStatusChange(
    name: string,
    channelType: string,
    status: ChannelPackageStatus | string,
    lastError?: string
  ): void {
    getEventBus().emit('channel:status_changed', {
      name,
      channelType,
      status,
      lastError: lastError ?? null,
    });
  }

  private loadManifest(pkgPath: string): ChannelManifest {
    const manifestPath = path.join(pkgPath, 'channel.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`channel.json not found at ${manifestPath}`);
    }
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return channelManifestSchema.parse(raw);
  }

  private loadConfigSchema(pkgPath: string): ConfigSchema | null {
    const schemaPath = path.join(pkgPath, 'config.schema.json');
    if (!fs.existsSync(schemaPath)) return null;
    const raw = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    return configSchemaSchema.parse(raw);
  }

  private computeChecksum(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private appVersion: string = '';

  private getAppVersion(): string {
    if (!this.appVersion) {
      try {
        // Walk up from this file to find root package.json
        let dir = path.dirname(new URL(import.meta.url).pathname);
        for (let i = 0; i < 6; i++) {
          const pkgPath = path.join(dir, 'package.json');
          if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            if (pkg.workspaces) {
              this.appVersion = (pkg.version as string) ?? '0.0.0';
              return this.appVersion;
            }
          }
          dir = path.dirname(dir);
        }
        this.appVersion = '0.0.0';
      } catch {
        this.appVersion = '0.0.0';
      }
    }
    return this.appVersion;
  }

  private parseVersion(ver: string): [number, number, number] | null {
    // Strip leading >= or ~ or ^ if present
    const cleaned = ver.replace(/^[>=~^]+/, '');
    const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match || !match[1] || !match[2] || !match[3]) return null;
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
  }

  private compareVersions(a: [number, number, number], b: [number, number, number]): number {
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[1] !== b[1]) return a[1] - b[1];
    return a[2] - b[2];
  }
}

// ============================================================================
// Singleton
// ============================================================================

let manager: ChannelManager | null = null;

export function getChannelManager(): ChannelManager {
  if (!manager) {
    manager = new ChannelManager();
  }
  return manager;
}
