/**
 * Channels Router -- tRPC procedures for channel package management.
 *
 * Manages installable channel packages: list, install, configure,
 * enable/disable, restart, and real-time status subscriptions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb } from '../../db/index.js';
import * as systemStore from '../../db/stores/system-store.js';
import { getChannelManager } from '../../channels/channel-manager.js';
import { getEventBus } from '../../lib/event-bus.js';
import type { AnimusEventMap } from '@animus/shared';

export const channelsRouter = router({
  /**
   * List all installed channel packages with status.
   */
  listPackages: protectedProcedure.query(() => {
    const channelManager = getChannelManager();
    return channelManager.getInstalledChannels();
  }),

  /**
   * Get a single channel package details.
   */
  getPackage: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .query(({ input }) => {
      const pkg = systemStore.getChannelPackage(getSystemDb(), input.name);
      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel package not found' });
      }
      const channelManager = getChannelManager();
      const manifest = channelManager.getChannelManifest(pkg.channelType);
      return { ...pkg, manifest };
    }),

  /**
   * Serve a channel's icon image.
   */
  getIcon: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .query(({ input }) => {
      const db = getSystemDb();
      const pkg = systemStore.getChannelPackage(db, input.name);
      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel package not found' });
      }
      const channelManager = getChannelManager();
      const manifest = channelManager.getChannelManifest(pkg.channelType);
      if (!manifest) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel manifest not loaded' });
      }

      const iconPath = path.join(pkg.path, manifest.icon);
      try {
        const iconData = fs.readFileSync(iconPath);
        // Return as base64-encoded string for tRPC transport
        return {
          data: iconData.toString('base64'),
          mimeType: manifest.icon.endsWith('.svg') ? 'image/svg+xml' : 'image/png',
        };
      } catch {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Icon file not found' });
      }
    }),

  /**
   * Install a channel package from a directory path.
   */
  install: protectedProcedure
    .input(z.object({ path: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const channelManager = getChannelManager();
      return channelManager.installFromPath(input.path);
    }),

  /**
   * Uninstall a channel package.
   */
  uninstall: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const channelManager = getChannelManager();
      await channelManager.uninstall(input.name);
      return { success: true };
    }),

  /**
   * Enable a channel (start its child process).
   */
  enable: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const channelManager = getChannelManager();
      await channelManager.enable(input.name);
      return { success: true };
    }),

  /**
   * Disable a channel (stop its child process).
   */
  disable: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const channelManager = getChannelManager();
      await channelManager.disable(input.name);
      return { success: true };
    }),

  /**
   * Restart a channel.
   */
  restart: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const channelManager = getChannelManager();
      await channelManager.restart(input.name);
      return { success: true };
    }),

  /**
   * Get config schema for a channel (from config.schema.json).
   */
  getConfigSchema: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .query(({ input }) => {
      const pkg = systemStore.getChannelPackage(getSystemDb(), input.name);
      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel package not found' });
      }
      const channelManager = getChannelManager();
      return channelManager.getConfigSchema(pkg.channelType) ?? { fields: [] };
    }),

  /**
   * Get channel config (secrets masked for display).
   */
  getConfig: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .query(({ input }) => {
      const db = getSystemDb();
      const pkg = systemStore.getChannelPackage(db, input.name);
      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel package not found' });
      }
      const channelManager = getChannelManager();
      const configSchema = channelManager.getConfigSchema(pkg.channelType);
      const secretKeys = configSchema?.fields
        .filter(f => f.type === 'secret')
        .map(f => f.key) ?? [];

      const config = systemStore.getChannelPackageConfig(db, input.name, secretKeys);

      // Mask secret values for display
      if (config) {
        for (const key of secretKeys) {
          if (config[key]) {
            config[key] = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
          }
        }
      }

      return config ?? {};
    }),

  /**
   * Save channel configuration.
   */
  configure: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      config: z.record(z.unknown()),
    }))
    .mutation(async ({ input }) => {
      const db = getSystemDb();
      const pkg = systemStore.getChannelPackage(db, input.name);
      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel package not found' });
      }

      const channelManager = getChannelManager();
      const configSchema = channelManager.getConfigSchema(pkg.channelType);
      const secretKeys = configSchema?.fields
        .filter(f => f.type === 'secret')
        .map(f => f.key) ?? [];

      // If a secret field has the masked value, preserve the existing value
      const existingConfig = systemStore.getChannelPackageConfig(db, input.name, secretKeys) ?? {};
      const configToSave = { ...input.config };
      for (const key of secretKeys) {
        if (configToSave[key] === '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022') {
          configToSave[key] = existingConfig[key];
        }
      }

      // Validate required fields
      if (configSchema) {
        for (const field of configSchema.fields) {
          if (field.required && !configToSave[field.key]) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Required field: ${field.label}`,
            });
          }
        }
      }

      systemStore.setChannelPackageConfig(db, input.name, configToSave, secretKeys);

      // Auto-restart if the channel is currently running so it picks up new config
      if (pkg.enabled && channelManager.getProcess(pkg.channelType)) {
        await channelManager.restart(input.name);
      }

      return { success: true };
    }),

  /**
   * Subscription for real-time channel status updates.
   */
  onStatusChange: protectedProcedure.subscription(() => {
    type StatusEvent = AnimusEventMap['channel:status_changed'];
    return observable<StatusEvent>((emit) => {
      const eventBus = getEventBus();
      const handler = (event: StatusEvent) => {
        emit.next(event);
      };
      eventBus.on('channel:status_changed', handler);
      return () => {
        eventBus.off('channel:status_changed', handler);
      };
    });
  }),
});
