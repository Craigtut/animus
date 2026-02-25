/**
 * Onboarding Store
 *
 * Tracks onboarding wizard progress client-side.
 * Persisted so users can resume if they leave mid-flow.
 * Also holds the persona draft data collected across steps.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type OnboardingStep =
  | 'welcome'
  | 'agent_provider'
  | 'identity'
  | 'about_you'
  | 'persona_existence'
  | 'persona_identity'
  | 'persona_archetype'
  | 'persona_dimensions'
  | 'persona_traits'
  | 'persona_values'
  | 'persona_background'
  | 'persona_review'
  | 'birth'
  | 'complete';

/** Persona draft data collected across onboarding steps */
export interface PersonaDraft {
  // ExistenceStep
  existenceParadigm: 'simulated_life' | 'digital_consciousness' | null;
  location: string;
  worldDescription: string;

  // IdentityStep
  name: string;
  gender: string;
  customGender: string;
  age: string;
  physicalDescription: string;

  // ArchetypeStep
  archetype: string | null;

  // DimensionsStep
  personalityDimensions: Record<string, number>;

  // TraitsStep
  traits: string[];

  // ValuesStep
  values: string[];

  // BackgroundStep
  personalityNotes: string;
  background: string;

  // Timezone (auto-detected or city-derived)
  timezone: string;
}

const defaultPersonaDraft: PersonaDraft = {
  existenceParadigm: null,
  location: '',
  worldDescription: '',
  name: '',
  gender: '',
  customGender: '',
  age: '',
  physicalDescription: '',
  archetype: null,
  personalityDimensions: {
    extraversion: 0.5,
    trust: 0.5,
    leadership: 0.5,
    optimism: 0.5,
    confidence: 0.5,
    empathy: 0.5,
    caution: 0.5,
    patience: 0.5,
    order: 0.5,
    altruism: 0.5,
  },
  traits: [],
  values: [],
  personalityNotes: '',
  background: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

interface OnboardingState {
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  personaDraft: PersonaDraft;
  setCurrentStep: (step: OnboardingStep) => void;
  markStepComplete: (step: OnboardingStep) => void;
  updatePersonaDraft: (updates: Partial<PersonaDraft>) => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      currentStep: 'welcome',
      completedSteps: [],
      personaDraft: { ...defaultPersonaDraft },
      setCurrentStep: (step) => set({ currentStep: step }),
      markStepComplete: (step) =>
        set((state) => ({
          completedSteps: state.completedSteps.includes(step)
            ? state.completedSteps
            : [...state.completedSteps, step],
        })),
      updatePersonaDraft: (updates) =>
        set((state) => ({
          personaDraft: { ...state.personaDraft, ...updates },
        })),
      reset: () =>
        set({
          currentStep: 'welcome',
          completedSteps: [],
          personaDraft: { ...defaultPersonaDraft },
        }),
    }),
    {
      name: 'animus-onboarding',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
