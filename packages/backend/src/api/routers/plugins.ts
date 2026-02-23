/**
 * Plugins Router — tRPC procedures for plugin management.
 *
 * All procedures are protected (require auth). Delegates to the
 * PluginManager singleton for lifecycle operations.
 */

import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { getPluginManager } from '../../services/plugin-manager.js';
import { verifyPackage } from '../../services/package-verifier.js';
import { PluginManifestSchema, pluginSourceSchema } from '@animus-labs/shared';

export const pluginsRouter = router({
  /**
   * List all plugins with status and component counts.
   */
  list: protectedProcedure.query(() => {
    const pm = getPluginManager();
    const plugins = pm.getAllPlugins();

    return plugins.map((p) => {
      const loaded = pm.getPlugin(p.name);
      const comps = p.manifest.components;

      // Compute status dynamically (mirrors channel pattern)
      let status: 'active' | 'unconfigured' | 'disabled';
      if (p.enabled) {
        status = 'active';
      } else if (!pm.hasRequiredConfig(p.name)) {
        status = 'unconfigured';
      } else {
        status = 'disabled';
      }

      return {
        name: p.name,
        displayName: p.manifest.displayName,
        version: p.manifest.version,
        description: p.manifest.description,
        iconSvg: loaded?.iconSvg ?? null,
        source: p.source,
        enabled: p.enabled,
        status,
        components: {
          skills: loaded?.skills.length ?? 0,
          tools: loaded ? Object.keys(loaded.mcpServers).length : 0,
          contextSources: loaded?.contextSources.length ?? 0,
          hooks: loaded?.hooks.length ?? 0,
          decisionTypes: loaded?.decisionTypes.length ?? 0,
          triggers: loaded?.triggers.length ?? 0,
          agents: loaded?.agents.length ?? 0,
        },
        hasConfig: comps.tools !== undefined || pm.getPluginConfigSchema(p.name) !== null,
      };
    });
  }),

  /**
   * Get full plugin details including manifest and component names.
   */
  get: protectedProcedure
    .input(z.object({ name: z.string() }))
    .query(({ input }) => {
      const pm = getPluginManager();
      const loaded = pm.getPlugin(input.name);
      if (!loaded) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Plugin "${input.name}" not found`,
        });
      }

      return {
        name: loaded.manifest.name,
        displayName: loaded.manifest.displayName,
        version: loaded.manifest.version,
        description: loaded.manifest.description,
        iconSvg: loaded.iconSvg,
        author: loaded.manifest.author,
        license: loaded.manifest.license,
        source: loaded.source,
        enabled: loaded.enabled,
        manifest: loaded.manifest,
        components: {
          skills: loaded.skills.map((s) => s.name),
          tools: Object.keys(loaded.mcpServers),
          contextSources: loaded.contextSources.map((cs) => cs.name),
          hooks: loaded.hooks.map((h) => h.event),
          decisionTypes: loaded.decisionTypes.map((d) => d.name),
          triggers: loaded.triggers.map((t) => t.name),
          agents: loaded.agents.map((a) => a.frontmatter.name),
        },
      };
    }),

  /**
   * Install a plugin from a source path.
   */
  install: protectedProcedure
    .input(
      z.object({
        source: pluginSourceSchema.exclude(['built-in', 'store']),
        path: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const pm = getPluginManager();
      try {
        const manifest = await pm.install({ type: input.source, path: input.path });
        return manifest;
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'Failed to install plugin',
        });
      }
    }),

  /**
   * Uninstall a plugin by name.
   */
  uninstall: protectedProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input }) => {
      const pm = getPluginManager();
      try {
        await pm.uninstall(input.name);
        return { success: true };
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'Failed to uninstall plugin',
        });
      }
    }),

  /**
   * Enable a plugin.
   */
  enable: protectedProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input }) => {
      const pm = getPluginManager();
      try {
        await pm.enable(input.name);
        return { success: true };
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'Failed to enable plugin',
        });
      }
    }),

  /**
   * Disable a plugin.
   */
  disable: protectedProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input }) => {
      const pm = getPluginManager();
      try {
        await pm.disable(input.name);
        return { success: true };
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'Failed to disable plugin',
        });
      }
    }),

  /**
   * Get plugin config (secret fields masked) and config schema for form rendering.
   */
  getConfig: protectedProcedure
    .input(z.object({ name: z.string() }))
    .query(({ input }) => {
      const pm = getPluginManager();
      const loaded = pm.getPlugin(input.name);
      if (!loaded) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Plugin "${input.name}" not found`,
        });
      }
      return {
        values: pm.getPluginConfigMasked(input.name),
        schema: pm.getPluginConfigSchema(input.name),
      };
    }),

  /**
   * Set plugin config (will be encrypted at rest).
   */
  setConfig: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        config: z.record(z.unknown()),
      })
    )
    .mutation(({ input }) => {
      const pm = getPluginManager();
      const loaded = pm.getPlugin(input.name);
      if (!loaded) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Plugin "${input.name}" not found`,
        });
      }
      pm.setPluginConfig(input.name, input.config);
      return { success: true };
    }),

  /**
   * Validate a path contains a valid plugin manifest.
   */
  validatePath: protectedProcedure
    .input(z.object({ path: z.string() }))
    .query(async ({ input }) => {
      try {
        const manifestPath = path.join(input.path, 'plugin.json');
        const raw = await fs.readFile(manifestPath, 'utf-8');
        const json = JSON.parse(raw);
        const result = PluginManifestSchema.safeParse(json);
        if (result.success) {
          return { valid: true as const, manifest: result.data };
        }
        return {
          valid: false as const,
          error: result.error.issues.map((i) => i.message).join('; '),
        };
      } catch (err) {
        return {
          valid: false as const,
          error: err instanceof Error ? err.message : 'Failed to read plugin.json',
        };
      }
    }),

  /**
   * Verify an .anpk package file — returns verification result + manifest
   * for the consent UI. This is step 1 of the two-step install flow.
   */
  verifyPackage: protectedProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const result = await verifyPackage(input.filePath);
        if (result.manifest && result.manifest.packageType !== 'plugin') {
          return {
            ...result,
            valid: false,
            errors: [...result.errors, 'Package is not a plugin'],
          };
        }
        return result;
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'Failed to verify package',
        });
      }
    }),

  /**
   * Install a plugin from a verified .anpk package file.
   * This is step 2 of the two-step install flow — called after the user
   * reviews permissions and clicks "Install" in the consent dialog.
   */
  installFromPackage: protectedProcedure
    .input(
      z.object({
        filePath: z.string().min(1),
        grantedPermissions: z.array(z.string()).default([]),
      })
    )
    .mutation(async ({ input }) => {
      const pm = getPluginManager();
      try {
        const result = await pm.installFromPackage(
          input.filePath,
          input.grantedPermissions,
        );
        return result;
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'Failed to install plugin from package',
        });
      }
    }),

  /**
   * Rollback a plugin to its previous cached version.
   */
  rollback: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const pm = getPluginManager();
      try {
        const result = await pm.rollback(input.name);
        return result;
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'Failed to rollback plugin',
        });
      }
    }),
});
