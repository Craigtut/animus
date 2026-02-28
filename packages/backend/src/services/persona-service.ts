/**
 * Persona Service - business logic for persona (personality) management.
 *
 * Encapsulates draft building, finalization with emotion baseline computation,
 * and post-creation updates with recompilation.
 * The router layer handles auth and input validation; this layer owns the logic.
 */

import { createLogger } from '../lib/logger.js';
import { getSystemDb, getPersonaDb } from '../db/index.js';
import * as systemStore from '../db/stores/system-store.js';
import * as personaStore from '../db/stores/persona-store.js';
import {
  startHeartbeat,
  recompilePersona,
  recomputeEmotionBaselines,
} from '../heartbeat/index.js';
import type { Persona } from '@animus-labs/shared';
import type { PersonaDimensions } from '../heartbeat/emotion-engine.js';

const log = createLogger('PersonaService', 'heartbeat');

// ============================================================================
// Types
// ============================================================================

type DraftFields = Partial<Omit<Persona, 'isFinalized' | 'communicationStyle'>>;

// ============================================================================
// Service
// ============================================================================

class PersonaService {
  /**
   * Get the full persona data.
   */
  get(): Persona {
    return personaStore.getPersona(getPersonaDb());
  }

  /**
   * Save partial persona during onboarding (progressive save).
   * Does not finalize; persona remains a draft.
   */
  saveDraft(input: Record<string, unknown>): Persona {
    const db = getPersonaDb();
    personaStore.savePersonaDraft(db, this.buildDraft(input));
    return personaStore.getPersona(db);
  }

  /**
   * Update persona post-creation. Triggers recompilation and
   * baseline recomputation if dimensions changed.
   */
  update(input: Record<string, unknown>): Persona {
    const db = getPersonaDb();
    personaStore.savePersonaDraft(db, this.buildDraft(input));

    // Recompile persona prompt
    recompilePersona();

    // Recompute emotion baselines if dimensions changed
    if (input['personalityDimensions']) {
      const persona = personaStore.getPersona(db);
      recomputeEmotionBaselines(this.toEmotionDimensions(persona.personalityDimensions));
    }

    return personaStore.getPersona(db);
  }

  /**
   * Finalize persona: compiles prompt, computes emotion baselines,
   * marks onboarding complete, and starts the heartbeat.
   */
  finalize(): Persona {
    const db = getPersonaDb();

    // Mark persona as finalized
    personaStore.finalizePersona(db);

    // Mark onboarding as complete
    systemStore.updateOnboardingState(getSystemDb(), { isComplete: true, currentStep: 8 });

    // Recompile persona prompt
    recompilePersona();

    // Compute emotion baselines from personality dimensions
    const persona = personaStore.getPersona(db);
    recomputeEmotionBaselines(this.toEmotionDimensions(persona.personalityDimensions));

    // Start the heartbeat (the moment of "birth")
    startHeartbeat();

    // Trigger speech model downloads (fire-and-forget)
    import('../downloads/index.js').then(({ getDownloadManager, getSpeechAssets }) => {
      try {
        const dm = getDownloadManager();
        const missing = getSpeechAssets().filter((a) => !dm.isAssetPresent(a));
        if (missing.length > 0) dm.enqueue(missing);
      } catch {
        // Download manager may not be initialized yet in tests
      }
    }).catch(() => {});

    log.info('Persona finalized, heartbeat started');
    return persona;
  }

  /**
   * Build a store-compatible draft object from Zod-parsed input.
   * Strips keys whose value is undefined so we satisfy exactOptionalPropertyTypes.
   */
  private buildDraft(input: Record<string, unknown>): DraftFields {
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
  private toEmotionDimensions(dims: Persona['personalityDimensions']): PersonaDimensions {
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
}

// ============================================================================
// Singleton
// ============================================================================

let instance: PersonaService | null = null;

export function getPersonaService(): PersonaService {
  if (!instance) instance = new PersonaService();
  return instance;
}

export function resetPersonaService(): void {
  instance = null;
}
