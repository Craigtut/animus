/**
 * Onboarding Router — tRPC procedures for onboarding state management.
 *
 * Tracks progress through the 8-step persona creation flow.
 */

import { z } from 'zod/v3';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb, getPersonaDb } from '../../db/index.js';
import * as systemStore from '../../db/stores/system-store.js';
import * as personaStore from '../../db/stores/persona-store.js';

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

  /**
   * Mark onboarding complete after a save restore.
   *
   * Verifies that the restored persona is finalized before allowing
   * the user to skip the persona creation steps.
   */
  completeFromRestore: protectedProcedure.mutation(() => {
    const persona = personaStore.getPersona(getPersonaDb());
    if (!persona.isFinalized) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Restored persona is not finalized. Cannot skip onboarding.',
      });
    }
    systemStore.updateOnboardingState(getSystemDb(), { isComplete: true, currentStep: 8 });
  }),
});
