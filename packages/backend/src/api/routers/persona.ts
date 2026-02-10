/**
 * Persona Router — tRPC procedures for persona (personality) management.
 *
 * Supports progressive save during onboarding, finalization with
 * emotion baseline computation, and post-creation updates.
 */

import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb } from '../../db/index.js';
import * as systemStore from '../../db/stores/system-store.js';
import {
  startHeartbeat,
  recompilePersona,
  recomputeEmotionBaselines,
} from '../../heartbeat/index.js';
import {
  personaDraftInputSchema,
  personaUpdateInputSchema,
} from '@animus/shared';
import type { Persona } from '@animus/shared';
import type { PersonaDimensions } from '../../heartbeat/emotion-engine.js';

type DraftFields = Partial<Omit<Persona, 'isFinalized' | 'communicationStyle'>>;

/**
 * Build a store-compatible draft object from Zod-parsed input.
 * Strips keys whose value is undefined so we satisfy exactOptionalPropertyTypes.
 */
function buildDraft(input: Record<string, unknown>): DraftFields {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) result[k] = v;
  }
  return result as DraftFields;
}

/**
 * Map shared PersonalityDimensions (confidence) to emotion-engine
 * PersonaDimensions (confidence_dim).
 */
function toEmotionDimensions(dims: Persona['personalityDimensions']): PersonaDimensions {
  return {
    extroversion: dims.extroversion,
    trust: dims.trust,
    leadership: dims.leadership,
    optimism: dims.optimism,
    confidence_dim: dims.confidence,
    empathy: dims.empathy,
    cautious: dims.cautious,
    patience: dims.patience,
    orderly: dims.orderly,
    altruism: dims.altruism,
  };
}

export const personaRouter = router({
  /**
   * Get full persona data.
   */
  get: protectedProcedure.query(() => {
    return systemStore.getPersona(getSystemDb());
  }),

  /**
   * Save partial persona during onboarding (progressive save).
   * Does not finalize — persona remains a draft.
   */
  saveDraft: protectedProcedure
    .input(personaDraftInputSchema)
    .mutation(({ input }) => {
      const db = getSystemDb();
      systemStore.savePersonaDraft(db, buildDraft(input));
      return systemStore.getPersona(db);
    }),

  /**
   * Finalize persona — compiles prompt, computes emotion baselines,
   * marks onboarding complete, and starts the heartbeat.
   */
  finalize: protectedProcedure.mutation(() => {
    const db = getSystemDb();

    // Mark persona as finalized
    systemStore.finalizePersona(db);

    // Mark onboarding as complete
    systemStore.updateOnboardingState(db, { isComplete: true, currentStep: 8 });

    // Recompile persona prompt
    recompilePersona();

    // Compute emotion baselines from personality dimensions
    const persona = systemStore.getPersona(db);
    recomputeEmotionBaselines(toEmotionDimensions(persona.personalityDimensions));

    // Start the heartbeat — the moment of "birth"
    startHeartbeat();

    return persona;
  }),

  /**
   * Update persona post-creation. Triggers recompilation and
   * baseline recomputation.
   */
  update: protectedProcedure
    .input(personaUpdateInputSchema)
    .mutation(({ input }) => {
      const db = getSystemDb();
      systemStore.savePersonaDraft(db, buildDraft(input));

      // Recompile persona prompt
      recompilePersona();

      // Recompute emotion baselines if dimensions changed
      if (input.personalityDimensions) {
        const persona = systemStore.getPersona(db);
        recomputeEmotionBaselines(toEmotionDimensions(persona.personalityDimensions));
      }

      return systemStore.getPersona(db);
    }),
});
