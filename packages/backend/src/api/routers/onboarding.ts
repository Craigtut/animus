/**
 * Onboarding Router — tRPC procedures for onboarding state management.
 *
 * Tracks progress through the 8-step persona creation flow.
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb } from '../../db/index.js';
import * as systemStore from '../../db/stores/system-store.js';

export const onboardingRouter = router({
  /**
   * Get current onboarding state.
   */
  getState: protectedProcedure.query(() => {
    return systemStore.getOnboardingState(getSystemDb());
  }),

  /**
   * Update onboarding step progress.
   */
  updateStep: protectedProcedure
    .input(
      z.object({
        currentStep: z.number().int().min(0).max(8),
      })
    )
    .mutation(({ input }) => {
      const db = getSystemDb();
      systemStore.updateOnboardingState(db, { currentStep: input.currentStep });
      return systemStore.getOnboardingState(db);
    }),
});
