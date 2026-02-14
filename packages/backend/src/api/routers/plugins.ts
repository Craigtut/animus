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
import { PluginManifestSchema, pluginSourceSchema } from '@animus/shared';

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
      return {
        name: p.name,
        version: p.manifest.version,
        description: p.manifest.description,
        source: p.source,
        enabled: p.enabled,
        components: {
          skills: loaded?.skills.length ?? 0,
          tools: loaded ? Object.keys(loaded.mcpServers).length : 0,
          contextSources: loaded?.contextSources.length ?? 0,
          hooks: loaded?.hooks.length ?? 0,
          decisionTypes: loaded?.decisionTypes.length ?? 0,
          triggers: loaded?.triggers.length ?? 0,
          agents: loaded?.agents.length ?? 0,
        },
        hasConfig: comps.tools !== undefined || p.manifest.configSchema !== undefined,
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
        version: loaded.manifest.version,
        description: loaded.manifest.description,
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
   * Get plugin config (decrypted).
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
      return pm.getPluginConfig(input.name);
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
});
