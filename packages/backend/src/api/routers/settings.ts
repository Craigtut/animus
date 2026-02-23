/**
 * Settings Router — tRPC procedures for system and personality settings.
 */

import { z } from 'zod';
import {
  updateSystemSettingsInputSchema,
  updatePersonalitySettingsInputSchema,
} from '@animus-labs/shared';
import type { SystemSettings, PersonalitySettings } from '@animus-labs/shared';
import { router, protectedProcedure } from '../trpc.js';
import * as systemStore from '../../db/stores/system-store.js';
import * as personaStore from '../../db/stores/persona-store.js';
import { getSystemDb, getPersonaDb } from '../../db/index.js';
import { updateCategoryCache } from '../../lib/logger.js';

export const settingsRouter = router({
  getSystemSettings: protectedProcedure.query(() => {
    return systemStore.getSystemSettings(getSystemDb());
  }),

  updateSystemSettings: protectedProcedure
    .input(updateSystemSettingsInputSchema)
    .mutation(({ input }) => {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) {
        if (v !== undefined) clean[k] = v;
      }
      systemStore.updateSystemSettings(getSystemDb(), clean as Partial<SystemSettings>);
      return systemStore.getSystemSettings(getSystemDb());
    }),

  getPersonalitySettings: protectedProcedure.query(() => {
    return personaStore.getPersonalitySettings(getPersonaDb());
  }),

  updatePersonalitySettings: protectedProcedure
    .input(updatePersonalitySettingsInputSchema)
    .mutation(({ input }) => {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) {
        if (v !== undefined) clean[k] = v;
      }
      personaStore.updatePersonalitySettings(getPersonaDb(), clean as Partial<PersonalitySettings>);
      return personaStore.getPersonalitySettings(getPersonaDb());
    }),

  getLogCategories: protectedProcedure.query(() => {
    return systemStore.getLogCategories(getSystemDb());
  }),

  updateLogCategories: protectedProcedure
    .input(z.record(z.string(), z.boolean()))
    .mutation(({ input }) => {
      const updated = systemStore.updateLogCategories(getSystemDb(), input);
      updateCategoryCache(updated);
      return updated;
    }),
});
