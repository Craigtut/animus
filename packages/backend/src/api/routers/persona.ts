/**
 * Persona Router - tRPC procedures for persona (personality) management.
 *
 * Supports progressive save during onboarding, finalization with
 * emotion baseline computation, and post-creation updates.
 */

import { router, protectedProcedure } from '../trpc.js';
import { getPersonaService } from '../../services/persona-service.js';
import {
  personaDraftInputSchema,
  personaUpdateInputSchema,
} from '@animus-labs/shared';

export const personaRouter = router({
  /**
   * Get full persona data.
   */
  get: protectedProcedure.query(() => {
    return getPersonaService().get();
  }),

  /**
   * Save partial persona during onboarding (progressive save).
   * Does not finalize; persona remains a draft.
   */
  saveDraft: protectedProcedure
    .input(personaDraftInputSchema)
    .mutation(({ input }) => {
      return getPersonaService().saveDraft(input);
    }),

  /**
   * Finalize persona: compiles prompt, computes emotion baselines,
   * marks onboarding complete, and starts the heartbeat.
   */
  finalize: protectedProcedure.mutation(() => {
    return getPersonaService().finalize();
  }),

  /**
   * Update persona post-creation. Triggers recompilation and
   * baseline recomputation.
   */
  update: protectedProcedure
    .input(personaUpdateInputSchema)
    .mutation(({ input }) => {
      return getPersonaService().update(input);
    }),
});
