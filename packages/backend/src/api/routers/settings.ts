/**
 * Settings Router — tRPC procedures for system and personality settings.
 */

import { z } from 'zod';
import {
  updateSystemSettingsInputSchema,
  updatePersonalitySettingsInputSchema,
} from '@animus/shared';
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
      systemStore.updateSystemSettings(getSystemDb(), input);
      return systemStore.getSystemSettings(getSystemDb());
    }),

  getPersonalitySettings: protectedProcedure.query(() => {
    return personaStore.getPersonalitySettings(getPersonaDb());
  }),

  updatePersonalitySettings: protectedProcedure
    .input(updatePersonalitySettingsInputSchema)
    .mutation(({ input }) => {
      personaStore.updatePersonalitySettings(getPersonaDb(), input);
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
