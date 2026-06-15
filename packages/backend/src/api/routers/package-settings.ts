/**
 * Package settings router — ongoing settings and host-rendered surfaces.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v3';
import { TRPCError } from '@trpc/server';
import {
  configSchemaSchema,
  packageSettingsManifestSchema,
  packageTypeSchema,
  type ConfigSchema,
  type PackageSettingsSurface,
  type PackageType,
} from '@animus-labs/shared';
import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb } from '../../db/index.js';
import * as systemStore from '../../db/stores/system-store.js';
import * as packageSettingsStore from '../../db/stores/package-settings-store.js';
import { getPluginManager } from '../../plugins/index.js';
import { getChannelManager } from '../../channels/channel-manager.js';

const packageRefSchema = z.object({
  packageType: packageTypeSchema,
  name: z.string().min(1),
});

function resolvePackagePath(rootPath: string, relativePath: string, label: string): string {
  if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid package path for ${label}`);
  }

  const root = path.resolve(rootPath);
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Package path for ${label} escapes package root`);
  }
  return resolved;
}

async function loadConfigSchema(rootPath: string, schemaPath: string | undefined): Promise<ConfigSchema | null> {
  if (!schemaPath) return null;
  const fullPath = resolvePackagePath(rootPath, schemaPath, 'settings schema');
  const raw = await fs.readFile(fullPath, 'utf-8');
  return configSchemaSchema.parse(JSON.parse(raw));
}

async function loadSurfaces(rootPath: string, surfacesPath: string | undefined): Promise<PackageSettingsSurface[]> {
  if (!surfacesPath) return [];
  const fullPath = resolvePackagePath(rootPath, surfacesPath, 'settings surfaces');
  const raw = await fs.readFile(fullPath, 'utf-8');
  const json = JSON.parse(raw);
  const manifest = packageSettingsManifestSchema.parse(Array.isArray(json) ? { surfaces: json } : json);
  return manifest.surfaces;
}

function formSurface(schema: ConfigSchema | null): PackageSettingsSurface[] {
  if (!schema || schema.fields.length === 0) return [];
  return [{
    id: 'settings',
    label: 'Settings',
    type: 'form',
    settingsKey: 'settings',
    configSchema: schema,
    actions: {},
  }];
}

function assertPackageExists(packageType: PackageType, name: string): void {
  if (packageType === 'plugin') {
    if (!getPluginManager().getPlugin(name)) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Plugin not found' });
    }
    return;
  }

  const pkg = systemStore.getChannelPackage(getSystemDb(), name);
  if (!pkg) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel package not found' });
  }
}

async function getChannelSurfaces(name: string): Promise<PackageSettingsSurface[]> {
  const db = getSystemDb();
  const pkg = systemStore.getChannelPackage(db, name);
  if (!pkg) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel package not found' });
  }

  const manifest = getChannelManager().getChannelManifest(pkg.channelType);
  if (!manifest) return [];

  const [settingsSchema, surfaces] = await Promise.all([
    loadConfigSchema(pkg.path, manifest.settingsSchema),
    loadSurfaces(pkg.path, manifest.surfaces),
  ]);
  return [...formSurface(settingsSchema), ...surfaces];
}

export const packageSettingsRouter = router({
  getSurfaces: protectedProcedure
    .input(packageRefSchema)
    .query(async ({ input }) => {
      assertPackageExists(input.packageType, input.name);

      if (input.packageType === 'plugin') {
        const pm = getPluginManager();
        return [
          ...formSurface(pm.getPluginSettingsSchema(input.name)),
          ...pm.getPluginSettingsSurfaces(input.name),
        ];
      }

      return getChannelSurfaces(input.name);
    }),

  getSettings: protectedProcedure
    .input(packageRefSchema)
    .query(({ input }) => {
      assertPackageExists(input.packageType, input.name);
      return packageSettingsStore.getPackageSettings(getSystemDb(), input.packageType, input.name);
    }),

  setSetting: protectedProcedure
    .input(packageRefSchema.extend({
      key: z.string().min(1),
      value: z.unknown(),
    }))
    .mutation(({ input }) => {
      assertPackageExists(input.packageType, input.name);
      packageSettingsStore.setPackageSetting(
        getSystemDb(),
        input.packageType,
        input.name,
        input.key,
        input.value,
      );
      return { success: true };
    }),

  setSettings: protectedProcedure
    .input(packageRefSchema.extend({
      settings: z.record(z.unknown()),
    }))
    .mutation(({ input }) => {
      assertPackageExists(input.packageType, input.name);
      packageSettingsStore.setPackageSettings(
        getSystemDb(),
        input.packageType,
        input.name,
        input.settings,
      );
      return { success: true };
    }),

  callAction: protectedProcedure
    .input(packageRefSchema.extend({
      surfaceId: z.string().min(1),
      actionId: z.string().min(1),
      params: z.unknown().optional(),
    }))
    .mutation(async ({ input }) => {
      assertPackageExists(input.packageType, input.name);

      if (input.packageType !== 'plugin') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This package does not support settings actions yet.',
        });
      }

      try {
        return await getPluginManager().callSettingsAction(
          input.name,
          input.surfaceId,
          input.actionId,
          input.params ?? {},
        );
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'Settings action failed',
        });
      }
    }),
});
