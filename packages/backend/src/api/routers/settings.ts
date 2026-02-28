/**
 * Settings Router - tRPC procedures for system and personality settings.
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  updateSystemSettingsInputSchema,
  updatePersonalitySettingsInputSchema,
} from '@animus-labs/shared';
import { router, protectedProcedure } from '../trpc.js';
import * as systemStore from '../../db/stores/system-store.js';
import * as memoryStore from '../../db/stores/memory-store.js';
import { getSystemDb, getMemoryDb } from '../../db/index.js';
import { isConfigured, verifyEncryptionKey } from '../../lib/encryption-service.js';
import { DATA_DIR } from '../../utils/env.js';
import { getChannelManager } from '../../channels/channel-manager.js';
import { getSettingsService } from '../../services/settings-service.js';

// ============================================================================
// Health Check Types & Implementation
// ============================================================================

export interface HealthCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  severity: 'critical' | 'warning' | 'info';
  detail?: string;
}

function runHealthChecks(): { status: 'healthy' | 'degraded' | 'unhealthy'; checks: HealthCheck[] } {
  const checks: HealthCheck[] = [];
  const systemDb = getSystemDb();

  // 1. Encryption key configured and sentinel passes
  try {
    if (!isConfigured()) {
      checks.push({ id: 'encryption_key', label: 'Encryption key', status: 'fail', severity: 'critical', detail: 'No encryption key configured' });
    } else {
      try {
        verifyEncryptionKey(systemDb);
        checks.push({ id: 'encryption_key', label: 'Encryption key', status: 'pass', severity: 'critical' });
      } catch {
        checks.push({ id: 'encryption_key', label: 'Encryption key', status: 'fail', severity: 'critical', detail: 'Encryption key does not match stored sentinel' });
      }
    }
  } catch (err) {
    checks.push({ id: 'encryption_key', label: 'Encryption key', status: 'fail', severity: 'critical', detail: String(err) });
  }

  // 2. Secrets file permissions
  try {
    const secretsPath = path.join(DATA_DIR, '.secrets');
    const stats = fs.statSync(secretsPath);
    const mode = stats.mode & 0o777;
    if (mode === 0o600) {
      checks.push({ id: 'secrets_permissions', label: 'Secrets file permissions', status: 'pass', severity: 'critical' });
    } else {
      checks.push({ id: 'secrets_permissions', label: 'Secrets file permissions', status: 'warn', severity: 'critical', detail: `File mode is ${mode.toString(8)}, expected 600` });
    }
  } catch {
    // .secrets might not exist yet (first run) -- not a failure
    checks.push({ id: 'secrets_permissions', label: 'Secrets file permissions', status: 'pass', severity: 'critical', detail: 'Secrets file not yet created' });
  }

  // 3. User registered
  try {
    const userCount = systemStore.getUserCount(systemDb);
    if (userCount > 0) {
      checks.push({ id: 'user_registered', label: 'User registered', status: 'pass', severity: 'critical' });
    } else {
      checks.push({ id: 'user_registered', label: 'User registered', status: 'fail', severity: 'critical', detail: 'No user account exists' });
    }
  } catch (err) {
    checks.push({ id: 'user_registered', label: 'User registered', status: 'fail', severity: 'critical', detail: String(err) });
  }

  // 4. Provider configured (credentials table or env vars)
  try {
    const providers = ['claude', 'codex', 'opencode'];
    const hasCredential = providers.some(p => systemStore.getCredential(systemDb, p) !== null);
    const hasEnvKey = !!(process.env['ANTHROPIC_API_KEY'] || process.env['CLAUDE_CODE_OAUTH_TOKEN'] || process.env['OPENAI_API_KEY']);
    if (hasCredential || hasEnvKey) {
      checks.push({ id: 'provider_configured', label: 'Agent provider', status: 'pass', severity: 'critical' });
    } else {
      checks.push({ id: 'provider_configured', label: 'Agent provider', status: 'fail', severity: 'critical', detail: 'No API key configured for any provider' });
    }
  } catch (err) {
    checks.push({ id: 'provider_configured', label: 'Agent provider', status: 'fail', severity: 'critical', detail: String(err) });
  }

  // 5. Sensitive tools not set to always_allow
  try {
    const toolPerms = systemStore.getToolPermissions(systemDb);
    const badTools = toolPerms.filter(t => t.riskTier === 'sensitive' && t.mode === 'always_allow');
    if (badTools.length === 0) {
      checks.push({ id: 'sensitive_tools_review', label: 'Tool permissions', status: 'pass', severity: 'warning' });
    } else {
      checks.push({ id: 'sensitive_tools_review', label: 'Tool permissions', status: 'warn', severity: 'warning', detail: `${badTools.length} sensitive tool(s) set to always allow: ${badTools.map(t => t.displayName || t.toolName).join(', ')}` });
    }
  } catch {
    checks.push({ id: 'sensitive_tools_review', label: 'Tool permissions', status: 'pass', severity: 'warning' });
  }

  // 6. Channel health
  try {
    const channelManager = getChannelManager();
    const channels = channelManager.getInstalledChannels();
    const unhealthy = channels.filter(c => c.enabled && c.status === 'error');
    if (unhealthy.length === 0) {
      checks.push({ id: 'channel_health', label: 'Channel health', status: 'pass', severity: 'warning' });
    } else {
      checks.push({ id: 'channel_health', label: 'Channel health', status: 'warn', severity: 'warning', detail: `${unhealthy.length} channel(s) in error state: ${unhealthy.map(c => c.displayName || c.channelType).join(', ')}` });
    }
  } catch {
    // Channel manager not initialized yet -- skip
    checks.push({ id: 'channel_health', label: 'Channel health', status: 'pass', severity: 'warning' });
  }

  // 7. Memory pool usage
  try {
    const memoryDb = getMemoryDb();
    const settings = systemStore.getSystemSettings(systemDb);
    const count = memoryStore.getLongTermMemoryCount(memoryDb);
    const maxSize = settings.memoryPoolMaxSize;
    const usage = count / maxSize;
    if (usage < 0.9) {
      checks.push({ id: 'memory_pool_usage', label: 'Memory pool', status: 'pass', severity: 'info', detail: `${count.toLocaleString()} / ${maxSize.toLocaleString()} memories (${Math.round(usage * 100)}%)` });
    } else {
      checks.push({ id: 'memory_pool_usage', label: 'Memory pool', status: 'warn', severity: 'info', detail: `${count.toLocaleString()} / ${maxSize.toLocaleString()} memories (${Math.round(usage * 100)}%). Nearing capacity.` });
    }
  } catch {
    checks.push({ id: 'memory_pool_usage', label: 'Memory pool', status: 'pass', severity: 'info' });
  }

  // 8. Disk space (best-effort)
  try {
    const stats = fs.statfsSync(DATA_DIR);
    const freeGB = (stats.bavail * stats.bsize) / (1024 * 1024 * 1024);
    if (freeGB > 1) {
      checks.push({ id: 'disk_space', label: 'Disk space', status: 'pass', severity: 'info', detail: `${freeGB.toFixed(1)} GB free` });
    } else {
      checks.push({ id: 'disk_space', label: 'Disk space', status: 'warn', severity: 'info', detail: `Only ${freeGB.toFixed(2)} GB free` });
    }
  } catch {
    // statfsSync might not be available on all platforms
    checks.push({ id: 'disk_space', label: 'Disk space', status: 'pass', severity: 'info' });
  }

  const overallStatus = checks.some(c => c.status === 'fail') ? 'unhealthy' as const
    : checks.some(c => c.status === 'warn') ? 'degraded' as const
    : 'healthy' as const;

  return { status: overallStatus, checks };
}

export const settingsRouter = router({
  healthCheck: protectedProcedure.query(() => {
    return runHealthChecks();
  }),

  getSystemSettings: protectedProcedure.query(() => {
    return getSettingsService().getSystemSettings();
  }),

  updateSystemSettings: protectedProcedure
    .input(updateSystemSettingsInputSchema)
    .mutation(({ input }) => {
      return getSettingsService().updateSystemSettings(input);
    }),

  getPersonalitySettings: protectedProcedure.query(() => {
    return getSettingsService().getPersonalitySettings();
  }),

  updatePersonalitySettings: protectedProcedure
    .input(updatePersonalitySettingsInputSchema)
    .mutation(({ input }) => {
      return getSettingsService().updatePersonalitySettings(input);
    }),

  getLogCategories: protectedProcedure.query(() => {
    return getSettingsService().getLogCategories();
  }),

  updateLogCategories: protectedProcedure
    .input(z.record(z.string(), z.boolean()))
    .mutation(({ input }) => {
      return getSettingsService().updateLogCategories(input);
    }),
});
