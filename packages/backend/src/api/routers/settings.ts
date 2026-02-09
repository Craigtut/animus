/**
 * Settings Router — tRPC procedures for system and personality settings.
 */

import {
  updateSystemSettingsInputSchema,
  updatePersonalitySettingsInputSchema,
} from '@animus/shared';
import { router, protectedProcedure } from '../trpc.js';
import * as systemStore from '../../db/stores/system-store.js';
import { getSystemDb } from '../../db/index.js';

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
    return systemStore.getPersonalitySettings(getSystemDb());
  }),

  updatePersonalitySettings: protectedProcedure
    .input(updatePersonalitySettingsInputSchema)
    .mutation(({ input }) => {
      systemStore.updatePersonalitySettings(getSystemDb(), input);
      return systemStore.getPersonalitySettings(getSystemDb());
    }),
});
