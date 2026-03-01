/**
 * Channel Manager — singleton that orchestrates all channel process hosts.
 *
 * Responsible for loading, installing, enabling/disabling, and managing
 * the lifecycle of installable channel packages.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import extractZip from 'extract-zip';
import { createLogger } from '../lib/logger.js';
import { getEventBus } from '../lib/event-bus.js';
import { env, DATA_DIR } from '../utils/env.js';
import { getSystemDb, getContactsDb } from '../db/index.js';
import * as systemStore from '../db/stores/system-store.js';
import * as contactStore from '../db/stores/contact-store.js';
import { ChannelProcessHost } from './process-host.js';
import { getChannelRouter } from './channel-router.js';
import type {
  ChannelManifest,
  ChannelPackage,
  ChannelInfo,
  ConfigSchema,
  ChannelPackageStatus,
  InstallResult,
  RollbackResult,
  VerificationResult,
  PackageManifest,
} from '@animus-labs/shared';
import { channelManifestSchema, configSchemaSchema } from '@animus-labs/shared';
import { verifyPackage } from '../services/package-verifier.js';

const log = createLogger('ChannelManager', 'channels');

export class ChannelManager {
  private processes = new Map<string, ChannelProcessHost>();
  private manifests = new Map<string, ChannelManifest>();
  private configSchemas = new Map<string, ConfigSchema>();
  /** Built-in channels (like web) that run in-process, not as child processes. */
  private builtInSenders = new Map<string, (contactId: string, content: string, metadata?: Record<string, unknown>) => Promise<void>>();
  private presence = new Map<string, Map<string, {
    status: 'online' | 'idle' | 'dnd' | 'offline';
    statusText?: string;
    activity?: string;
    updatedAt: number;
  }>>();

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
    log.debug(`Registered built-in channel: ${channelType}`);
  }

  /**
   * Load all channel packages from DB, validate manifests, and start enabled ones.
   */
  async loadAll(): Promise<void> {
    const db = getSystemDb();
    const packages = systemStore.getChannelPackages(db);

    for (const pkg of packages) {
      try {
        // Normalize stored path — if it doesn't exist, try DATA_DIR/packages/<name>
        if (!fs.existsSync(pkg.path)) {
          const corrected = path.join(DATA_DIR, 'packages', pkg.name);
          if (fs.existsSync(corrected)) {
            log.info(`Correcting stored path for channel ${pkg.name} → ${corrected}`);
            pkg.path = corrected;
            systemStore.updateChannelPackage(db, pkg.name, { path: corrected });
          }
        }

        const manifest = this.loadManifest(pkg.path);
        this.manifests.set(pkg.channelType, manifest);

        const configSchema = this.loadConfigSchema(pkg.path);
        if (configSchema) this.configSchemas.set(pkg.channelType, configSchema);

        // Verify adapter checksum
        const adapterPath = path.join(pkg.path, manifest.adapter);
        const currentChecksum = this.computeChecksum(adapterPath);
        if (currentChecksum !== pkg.checksum) {
          if (pkg.installedFrom === 'package') {
            // .anpk packages: strict — adapter was tampered with post-install
            log.warn(`Checksum mismatch for ${pkg.name} — adapter file modified since install`);
            systemStore.updateChannelPackageStatus(db, pkg.name, 'error', 'Adapter checksum mismatch');
            continue;
          } else {
            // Local dev: permissive — update checksum silently, developer is iterating
            log.info(`Adapter changed for local channel ${pkg.name}, updating checksum`);
            systemStore.updateChannelPackage(db, pkg.name, { checksum: currentChecksum });
          }
        }

        if (pkg.enabled) {
          // Start channel process in the background. Channel startup involves
          // network I/O (WebSocket connections, API handshakes) and can take 10s+
          // if a service is unreachable. Starting in the background prevents a
          // single failing channel from blocking server startup entirely.
          this.startProcess(pkg, manifest).catch(err => {
            log.error(`Failed to start channel ${pkg.name}:`, err);
            systemStore.updateChannelPackageStatus(db, pkg.name, 'error', String(err));
          });
        }
      } catch (err) {
        log.error(`Failed to load channel package ${pkg.name}:`, err);
        systemStore.updateChannelPackageStatus(db, pkg.name, 'error', String(err));
      }
    }

    log.debug(`Loaded ${this.manifests.size} channel packages (${this.processes.size} starting)`);
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

  getRuntimeStats(): { installed: number; running: number } {
    return {
      installed: this.manifests.size,
      running: this.processes.size,
    };
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

    // Clean up channel-provided skills
    const manifest = this.manifests.get(pkg.channelType);
    if (manifest) {
      await this.cleanupChannelSkills(pkg, manifest);
      if (manifest.skills) {
        getEventBus().emit('plugin:changed', { pluginName: pkg.name, action: 'uninstalled' });
      }
    }

    // Clean up contact_channels for this channel type
    const removedChannels = contactStore.deleteContactChannelsByChannel(getContactsDb(), pkg.channelType);
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

    // Deploy channel-provided skills
    await this.deployChannelSkills(pkg, manifest);
    if (manifest.skills) {
      getEventBus().emit('plugin:changed', { pluginName: pkg.name, action: 'enabled' });
    }

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

    const manifest = this.manifests.get(pkg.channelType);

    const host = this.processes.get(pkg.channelType);
    if (host) {
      await host.stop();
      this.processes.delete(pkg.channelType);
    }

    // Clean up channel-provided skills
    if (manifest) {
      await this.cleanupChannelSkills(pkg, manifest);
      if (manifest.skills) {
        getEventBus().emit('plugin:changed', { pluginName: pkg.name, action: 'disabled' });
      }
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

  // ---- Package Distribution — install from .anpk and rollback ----

  /**
   * Install a channel from a .anpk package file.
   *
   * Flow: verify → extract to ~/.animus/packages/{name}/ → cache .anpk →
   * register in DB → delegate to existing installFromPath flow.
   */
  async installFromPackage(
    anpkPath: string,
    grantedPermissions: string[] = [],
  ): Promise<InstallResult> {
    log.info(`Installing channel from package: ${anpkPath}`);

    // 1. Verify the package
    const verification = await verifyPackage(anpkPath);
    if (!verification.valid || !verification.manifest) {
      throw new Error(
        `Package verification failed: ${verification.errors.join('; ')}`,
      );
    }

    const manifest = verification.manifest;
    if (manifest.packageType !== 'channel') {
      throw new Error(`Expected channel package but got "${manifest.packageType}"`);
    }

    // 2. Conflict check
    const db = getSystemDb();
    const existingByType = systemStore.getChannelPackageByType(db, manifest.channelType);
    if (existingByType) {
      throw new Error(
        `Channel type "${manifest.channelType}" is already installed as "${existingByType.name}"`,
      );
    }

    const existingByName = systemStore.getChannelPackage(db, manifest.name);
    if (existingByName) {
      throw new Error(`Channel "${manifest.name}" is already installed`);
    }

    // 3. Extract to packages directory
    const packagesDir = path.join(DATA_DIR, 'packages');
    const extractDir = path.join(packagesDir, manifest.name);

    // Clean any leftover files from a previous failed install before extracting
    await fsp.rm(extractDir, { recursive: true, force: true });
    await fsp.mkdir(extractDir, { recursive: true });
    try {
      await extractZip(anpkPath, { dir: extractDir });
    } catch (err) {
      await fsp.rm(extractDir, { recursive: true, force: true });
      throw new Error(`Failed to extract package: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 4. Cache the .anpk file for rollback
    const cacheDir = path.join(packagesDir, '.cache');
    await fsp.mkdir(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, `${manifest.name}-${manifest.version}.anpk`);
    await fsp.copyFile(anpkPath, cachePath);

    // 5. Load channel manifest from extracted directory
    const channelManifest = this.loadManifest(extractDir);

    // 6. Check adapter file exists
    const adapterPath = path.join(extractDir, channelManifest.adapter);
    if (!fs.existsSync(adapterPath)) {
      await fsp.rm(extractDir, { recursive: true, force: true });
      throw new Error(`Adapter file not found: ${channelManifest.adapter}`);
    }

    // 7. Compute adapter checksum
    const checksum = this.computeChecksum(adapterPath);

    // 8. Load and store config schema
    const configSchema = this.loadConfigSchema(extractDir);
    if (configSchema) this.configSchemas.set(channelManifest.type, configSchema);

    const needsConfig = configSchema &&
      configSchema.fields.some(f => f.required);

    // 9. Register in DB
    systemStore.createChannelPackage(db, {
      name: manifest.name,
      channelType: channelManifest.type,
      version: manifest.version,
      path: extractDir,
      checksum,
    });

    // Update distribution-specific columns via raw SQL
    db.prepare(
      `UPDATE channel_packages SET
        package_version = ?,
        package_checksum = ?,
        signature_status = ?,
        installed_from = ?,
        package_cache_path = ?,
        permissions_granted = ?
      WHERE name = ?`,
    ).run(
      manifest.version,
      verification.checksums.verified > 0 ? 'verified' : null,
      verification.signature.status,
      'package',
      cachePath,
      grantedPermissions.length > 0 ? JSON.stringify(grantedPermissions) : null,
      manifest.name,
    );

    // Store manifest in memory
    this.manifests.set(channelManifest.type, channelManifest);

    getEventBus().emit('channel:installed', { name: manifest.name, channelType: channelManifest.type });
    log.info(`Installed channel from package: ${manifest.name} (${channelManifest.type}) v${manifest.version}${needsConfig ? ' (needs configuration)' : ''}`);

    return {
      success: true,
      manifest,
      needsConfig: !!needsConfig,
      verification,
      installedPath: extractDir,
    };
  }

  /**
   * Update an existing channel from a new .anpk package file.
   *
   * Preserves the existing configuration while replacing the package code.
   * The current version is cached for rollback.
   */
  async updateFromPackage(
    name: string,
    anpkPath: string,
    grantedPermissions: string[] = [],
  ): Promise<InstallResult> {
    log.info(`Updating channel from package: ${name} with ${anpkPath}`);

    const db = getSystemDb();
    const existing = systemStore.getChannelPackage(db, name);
    if (!existing) {
      throw new Error(`Channel "${name}" is not installed`);
    }

    // 1. Verify the new package
    const verification = await verifyPackage(anpkPath);
    if (!verification.valid || !verification.manifest) {
      throw new Error(
        `Package verification failed: ${verification.errors.join('; ')}`,
      );
    }

    const manifest = verification.manifest;
    if (manifest.packageType !== 'channel') {
      throw new Error(`Expected channel package but got "${manifest.packageType}"`);
    }

    // Ensure the package name matches the installed channel
    if (manifest.name !== name) {
      throw new Error(
        `Package name "${manifest.name}" does not match installed channel "${name}"`,
      );
    }

    const currentVersion = existing.version;
    const wasEnabled = existing.enabled;

    // 2. Stop running process if any
    const host = this.processes.get(existing.channelType);
    if (host) {
      await host.stop();
      this.processes.delete(existing.channelType);
    }

    // Clean up skills from old version
    const oldManifest = this.manifests.get(existing.channelType);
    if (oldManifest) {
      await this.cleanupChannelSkills(existing, oldManifest);
    }

    // 3. Extract to packages directory (replaces existing files)
    const packagesDir = path.join(DATA_DIR, 'packages');
    const extractDir = path.join(packagesDir, manifest.name);

    await fsp.rm(extractDir, { recursive: true, force: true });
    await fsp.mkdir(extractDir, { recursive: true });
    try {
      await extractZip(anpkPath, { dir: extractDir });
    } catch (err) {
      await fsp.rm(extractDir, { recursive: true, force: true });
      throw new Error(`Failed to extract package: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 4. Cache the new .anpk file for rollback; keep old version in cache too
    const cacheDir = path.join(packagesDir, '.cache');
    await fsp.mkdir(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, `${manifest.name}-${manifest.version}.anpk`);
    await fsp.copyFile(anpkPath, cachePath);

    // 5. Re-read channel manifest
    const channelManifest = this.loadManifest(extractDir);
    this.manifests.set(existing.channelType, channelManifest);

    // 6. Check adapter file exists
    const adapterPath = path.join(extractDir, channelManifest.adapter);
    if (!fs.existsSync(adapterPath)) {
      await fsp.rm(extractDir, { recursive: true, force: true });
      throw new Error(`Adapter file not found: ${channelManifest.adapter}`);
    }

    // 7. Compute adapter checksum and update config schema
    const checksum = this.computeChecksum(adapterPath);
    const configSchema = this.loadConfigSchema(extractDir);
    if (configSchema) {
      this.configSchemas.set(existing.channelType, configSchema);
    }

    const needsConfig = configSchema &&
      configSchema.fields.some(f => f.required);

    // 8. Update DB record — preserves config column (we only update version/path/checksum)
    systemStore.updateChannelPackage(db, name, {
      version: manifest.version,
      path: extractDir,
      checksum,
    });

    // Update distribution columns and set previous_version for rollback
    db.prepare(
      `UPDATE channel_packages SET
        package_version = ?,
        package_checksum = ?,
        signature_status = ?,
        package_cache_path = ?,
        previous_version = ?,
        permissions_granted = ?
      WHERE name = ?`,
    ).run(
      manifest.version,
      verification.checksums.verified > 0 ? 'verified' : null,
      verification.signature.status,
      cachePath,
      currentVersion,
      grantedPermissions.length > 0 ? JSON.stringify(grantedPermissions) : null,
      name,
    );

    // 9. Re-enable if was enabled and has required config
    if (wasEnabled) {
      const updatedPkg = systemStore.getChannelPackage(db, name);
      if (updatedPkg && this.hasRequiredConfig(updatedPkg)) {
        await this.startProcess(updatedPkg, channelManifest);
        await this.deployChannelSkills(updatedPkg, channelManifest);
        systemStore.updateChannelPackage(db, name, { enabled: true });
        log.info(`Updated and re-enabled channel from package: ${name} v${currentVersion} → v${manifest.version}`);
      } else {
        systemStore.updateChannelPackage(db, name, { enabled: false, status: 'disabled' });
        log.info(`Updated channel from package: ${name} v${currentVersion} → v${manifest.version} (disabled — needs configuration)`);
      }
    } else {
      log.info(`Updated channel from package: ${name} v${currentVersion} → v${manifest.version}`);
    }

    getEventBus().emit('channel:installed', { name, channelType: existing.channelType });

    return {
      success: true,
      manifest,
      needsConfig: !!needsConfig,
      verification,
      installedPath: extractDir,
    };
  }

  /**
   * Rollback a channel to its previous version using the cached .anpk.
   */
  async rollback(packageName: string): Promise<RollbackResult> {
    log.info(`Rolling back channel: ${packageName}`);

    const db = getSystemDb();
    const pkg = systemStore.getChannelPackage(db, packageName);
    if (!pkg) {
      return {
        success: false,
        previousVersion: '',
        restoredVersion: '',
        error: `Channel "${packageName}" not found`,
      };
    }

    // Read previous_version from DB
    const row = db.prepare(
      'SELECT previous_version, package_cache_path FROM channel_packages WHERE name = ?',
    ).get(packageName) as { previous_version: string | null; package_cache_path: string | null } | undefined;

    if (!row?.previous_version) {
      return {
        success: false,
        previousVersion: '',
        restoredVersion: '',
        error: `No previous version available for "${packageName}"`,
      };
    }

    const previousVersion = row.previous_version;
    const currentVersion = pkg.version;

    // Find the cached .anpk for the previous version
    const cacheDir = path.join(DATA_DIR, 'packages', '.cache');
    const previousCachePath = path.join(cacheDir, `${packageName}-${previousVersion}.anpk`);

    if (!fs.existsSync(previousCachePath)) {
      return {
        success: false,
        previousVersion,
        restoredVersion: '',
        error: `Cached package not found for ${packageName} v${previousVersion}`,
      };
    }

    try {
      // 1. Stop running process if any
      const host = this.processes.get(pkg.channelType);
      if (host) {
        await host.stop();
        this.processes.delete(pkg.channelType);
      }

      // Clean up skills
      const oldManifest = this.manifests.get(pkg.channelType);
      if (oldManifest) {
        await this.cleanupChannelSkills(pkg, oldManifest);
      }

      // 2. Remove current extracted directory
      const extractDir = path.join(DATA_DIR, 'packages', packageName);
      await fsp.rm(extractDir, { recursive: true, force: true });

      // 3. Re-extract from cached .anpk
      await fsp.mkdir(extractDir, { recursive: true });
      await extractZip(previousCachePath, { dir: extractDir });

      // 4. Re-read channel manifest
      const channelManifest = this.loadManifest(extractDir);
      this.manifests.set(pkg.channelType, channelManifest);

      // Update config schema
      const configSchema = this.loadConfigSchema(extractDir);
      if (configSchema) {
        this.configSchemas.set(pkg.channelType, configSchema);
      }

      // 5. Update DB record
      const adapterPath = path.join(extractDir, channelManifest.adapter);
      const checksum = this.computeChecksum(adapterPath);

      systemStore.updateChannelPackage(db, packageName, {
        version: previousVersion,
        path: extractDir,
        checksum,
      });

      // Swap version tracking
      db.prepare(
        `UPDATE channel_packages SET
          previous_version = ?,
          package_version = ?,
          package_cache_path = ?
        WHERE name = ?`,
      ).run(
        currentVersion,
        previousVersion,
        previousCachePath,
        packageName,
      );

      // 6. Re-enable if it was previously enabled
      if (pkg.enabled) {
        const updatedPkg = systemStore.getChannelPackage(db, packageName);
        if (updatedPkg && this.hasRequiredConfig(updatedPkg)) {
          await this.startProcess(updatedPkg, channelManifest);
          await this.deployChannelSkills(updatedPkg, channelManifest);
          systemStore.updateChannelPackage(db, packageName, { enabled: true });
        } else {
          systemStore.updateChannelPackage(db, packageName, { enabled: false, status: 'disabled' });
        }
      }

      getEventBus().emit('channel:installed', { name: packageName, channelType: pkg.channelType });
      log.info(`Rolled back channel "${packageName}" from v${currentVersion} to v${previousVersion}`);

      return {
        success: true,
        previousVersion: currentVersion,
        restoredVersion: previousVersion,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`Rollback failed for channel "${packageName}":`, err);
      return {
        success: false,
        previousVersion,
        restoredVersion: '',
        error: `Rollback failed: ${errorMsg}`,
      };
    }
  }

  /**
   * Send a message through any channel (built-in or package).
   */
  async sendToChannel(
    channelType: string,
    contactId: string,
    content: string,
    metadata?: Record<string, unknown>,
    media?: Array<{ type: string; path: string; mimeType: string; filename?: string }>
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
    return host.send(contactId, content, metadata, media);
  }

  /**
   * Perform an action on a channel (e.g., typing indicator, reaction).
   * Best-effort: returns false on failure, never throws.
   */
  async performAction(channelType: string, action: { type: string; [key: string]: unknown }): Promise<boolean> {
    // Map action type to capability name
    const capabilityMap: Record<string, string> = {
      typing_indicator: 'typing-indicator',
      add_reaction: 'reactions',
      send_voice_message: 'voice-messages',
    };
    const requiredCapability = capabilityMap[action.type];

    // Check capability if mapping exists
    if (requiredCapability) {
      const manifest = this.manifests.get(channelType);
      if (!manifest || !manifest.capabilities.includes(requiredCapability as typeof manifest.capabilities[number])) {
        return false;
      }
    }

    // Built-in channels: no-op (web doesn't support these actions)
    if (this.builtInSenders.has(channelType)) {
      return true;
    }

    // Package channels: delegate to process host
    const host = this.processes.get(channelType);
    if (!host || !host.isRunning) {
      log.warn(`Cannot perform action on channel ${channelType}: not running`);
      return false;
    }

    try {
      return await host.performAction(action);
    } catch (err) {
      log.error(`performAction failed on channel ${channelType}:`, err);
      return false;
    }
  }

  /**
   * Fetch conversation history from a channel that supports it.
   * Returns null if the channel doesn't support conversation-history or isn't running.
   */
  async getHistory(
    channelType: string,
    conversationId: string,
    limit?: number,
    before?: string
  ): Promise<Array<{
    author: { identifier: string; displayName: string; isBot: boolean };
    content: string;
    timestamp: string;
    threadTs?: string;
    reactions?: Array<{ name: string; count: number }>;
    attachments?: Array<{ type: string; url: string; filename?: string }>;
  }> | null> {
    // Check capability
    const manifest = this.manifests.get(channelType);
    if (!manifest || !manifest.capabilities.includes('conversation-history')) {
      return null;
    }

    const host = this.processes.get(channelType);
    if (!host || !host.isRunning) {
      log.warn(`Cannot get history from channel ${channelType}: not running`);
      return null;
    }

    try {
      const messages = await host.getHistory(conversationId, limit, before);
      return messages ?? null;
    } catch (err) {
      log.error(`getHistory failed for channel ${channelType}:`, err);
      return null;
    }
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
        installedFrom: pkg.installedFrom,
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
   * Re-reads from disk to pick up any changes to config.schema.json.
   */
  getConfigSchema(channelType: string): ConfigSchema | undefined {
    // Find the package path for this channel type
    const db = getSystemDb();
    const packages = systemStore.getChannelPackages(db);
    const pkg = packages.find((p) => p.channelType === channelType);
    if (pkg) {
      const fresh = this.loadConfigSchema(pkg.path);
      if (fresh) {
        this.configSchemas.set(channelType, fresh);
        return fresh;
      }
    }
    return this.configSchemas.get(channelType);
  }

  /**
   * Get all available channel types (built-in + installed packages).
   */
  getChannelTypes(): string[] {
    return [...new Set([...this.builtInSenders.keys(), ...this.manifests.keys()])];
  }

  /** Update presence for a contact on a specific channel. */
  updatePresence(channelType: string, identifier: string, data: {
    status: 'online' | 'idle' | 'dnd' | 'offline';
    statusText?: string;
    activity?: string;
  }): void {
    if (!this.presence.has(channelType)) {
      this.presence.set(channelType, new Map());
    }
    this.presence.get(channelType)!.set(identifier, {
      ...data,
      updatedAt: Date.now(),
    });
  }

  /** Get presence for a single contact on a channel. */
  getPresence(channelType: string, identifier: string): {
    status: 'online' | 'idle' | 'dnd' | 'offline';
    statusText?: string;
    activity?: string;
    updatedAt: number;
  } | undefined {
    return this.presence.get(channelType)?.get(identifier);
  }

  /** Get all presence entries for a channel. */
  getAllPresence(channelType: string): Map<string, {
    status: 'online' | 'idle' | 'dnd' | 'offline';
    statusText?: string;
    activity?: string;
    updatedAt: number;
  }> {
    return this.presence.get(channelType) ?? new Map();
  }

  /** Get aggregated presence for a contact across all their channels. */
  getContactPresenceSummary(contactId: string): {
    status: 'online' | 'idle' | 'dnd' | 'offline';
    statusText?: string;
    activity?: string;
  } | null {
    const cDb = getContactsDb();
    const channels = contactStore.getContactChannelsByContactId(cDb, contactId);
    if (channels.length === 0) return null;

    // Priority: online > idle > dnd > offline
    const priority: Record<string, number> = { online: 3, idle: 2, dnd: 1, offline: 0 };
    let bestStatus: 'online' | 'idle' | 'dnd' | 'offline' = 'offline';
    let bestActivity: string | undefined;
    let bestStatusText: string | undefined;

    for (const ch of channels) {
      const p = this.presence.get(ch.channel)?.get(ch.identifier);
      if (!p) continue;
      // Skip entries older than 10 minutes (stale)
      if (Date.now() - p.updatedAt > 10 * 60 * 1000) continue;
      if ((priority[p.status] ?? 0) > (priority[bestStatus] ?? 0)) {
        bestStatus = p.status;
        bestActivity = p.activity;
        bestStatusText = p.statusText;
      }
    }

    // If all entries are stale/missing, return null
    if (bestStatus === 'offline') {
      const hasAnyPresence = channels.some(ch => {
        const p = this.presence.get(ch.channel)?.get(ch.identifier);
        return p && (Date.now() - p.updatedAt <= 10 * 60 * 1000);
      });
      if (!hasAnyPresence) return null;
    }

    return {
      status: bestStatus,
      ...(bestStatusText != null ? { statusText: bestStatusText } : {}),
      ...(bestActivity != null ? { activity: bestActivity } : {}),
    };
  }

  // ---- Skills Deployment ----

  /**
   * Deploy channel-provided skills (symlinks to the skill bridge directory).
   * Reuses the same discovery path as the plugin system.
   */
  private async deployChannelSkills(pkg: ChannelPackage, manifest: ChannelManifest): Promise<void> {
    if (!manifest.skills) return;

    const skillsDir = path.join(pkg.path, manifest.skills);
    if (!fs.existsSync(skillsDir)) {
      log.warn(`Channel ${pkg.name} declares skills at "${manifest.skills}" but directory not found`);
      return;
    }

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const { getPluginManager } = await import('../plugins/index.js');
    const pluginManager = getPluginManager();
    const bridgePath = pluginManager.getSkillBridgePath();
    const targetSkillsDir = path.join(bridgePath, 'skills');

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      const sourcePath = path.join(skillsDir, entry.name);
      const targetPath = path.join(targetSkillsDir, entry.name);

      try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        try {
          fs.rmSync(targetPath, { recursive: true, force: true });
        } catch { /* doesn't exist */ }
        fs.symlinkSync(sourcePath, targetPath, 'dir');
        log.info(`Deployed channel skill "${entry.name}" from ${pkg.name}`);
      } catch (err) {
        log.error(`Failed to deploy channel skill ${entry.name} (${pkg.name}):`, err);
      }
    }
  }

  /**
   * Remove channel-provided skill symlinks.
   */
  private async cleanupChannelSkills(pkg: ChannelPackage, manifest: ChannelManifest): Promise<void> {
    if (!manifest.skills) return;

    const skillsDir = path.join(pkg.path, manifest.skills);
    if (!fs.existsSync(skillsDir)) return;

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const { getPluginManager } = await import('../plugins/index.js');
    const pluginManager = getPluginManager();
    const bridgePath = pluginManager.getSkillBridgePath();
    const targetSkillsDir = path.join(bridgePath, 'skills');

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const targetPath = path.join(targetSkillsDir, entry.name);
      try {
        fs.rmSync(targetPath, { recursive: true, force: true });
        log.debug(`Removed channel skill "${entry.name}" from ${pkg.name}`);
      } catch { /* ignore */ }
    }
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
      onIncoming: async (msg) => {
        const router = getChannelRouter();
        await router.handleIncoming({
          channel: pkg.channelType as Parameters<typeof router.handleIncoming>[0]['channel'],
          identifier: msg.identifier,
          content: msg.content,
          ...(msg.conversationId ? { conversationId: msg.conversationId } : {}),
          ...(msg.conversationType ? { conversationType: msg.conversationType } : {}),
          ...(msg.media ? { media: msg.media } : {}),
          ...(msg.metadata ? { metadata: msg.metadata } : {}),
          ...(msg.participant ? { participant: msg.participant } : {}),
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
        const contactsDatabase = getContactsDb();
        const channels = contactStore.getContactChannelsByContactId(contactsDatabase, contactId);
        const match = channels.find((c) => c.channel === pkg.channelType);
        if (!match) return null;
        const contact = contactStore.getContact(contactsDatabase, contactId);
        const result: { identifier: string; displayName?: string } = {
          identifier: match.identifier,
        };
        if (contact?.fullName) result.displayName = contact.fullName;
        return result;
      },
      onPresenceUpdate: (channelType, identifier, data) => {
        this.updatePresence(channelType, identifier, data);
      },
      downloadMedia: async (params) => {
        const ext = params.filename?.split('.').pop() ?? 'bin';
        const id = crypto.randomUUID();
        const localPath = path.join(DATA_DIR, 'media', `${id}.${ext}`);

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
      log.debug(`Channel ${pkg.name} (${pkg.channelType}) started successfully`);
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
    const channelJsonPath = path.join(pkgPath, 'channel.json');
    const manifestJsonPath = path.join(pkgPath, 'manifest.json');

    if (fs.existsSync(channelJsonPath)) {
      // Development / local install — native channel.json format
      const raw = JSON.parse(fs.readFileSync(channelJsonPath, 'utf-8'));
      return channelManifestSchema.parse(raw);
    }

    if (fs.existsSync(manifestJsonPath)) {
      // Package install — unified manifest.json from .anpk extraction
      const raw = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf-8'));
      // Map unified manifest fields to channel.json format
      return channelManifestSchema.parse({
        ...raw,
        type: raw.channelType ?? raw.type,
      });
    }

    throw new Error(`No channel.json or manifest.json found at ${pkgPath}`);
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
