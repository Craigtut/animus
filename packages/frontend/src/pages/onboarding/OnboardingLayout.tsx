/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import type { OnboardingStep } from '../../store';

const setupSteps: { step: OnboardingStep; label: string; path: string }[] = [
  { step: 'welcome', label: 'Welcome', path: '/onboarding/welcome' },
  { step: 'agent_provider', label: 'Agent', path: '/onboarding/agent' },
  { step: 'identity', label: 'You', path: '/onboarding/identity' },
  { step: 'about_you', label: 'About You', path: '/onboarding/about-you' },
  { step: 'channels', label: 'Channels', path: '/onboarding/channels' },
];

const personaSteps: { step: OnboardingStep; label: string; path: string }[] = [
  { step: 'persona_existence', label: 'Existence', path: '/onboarding/persona/existence' },
  { step: 'persona_identity', label: 'Identity', path: '/onboarding/persona/identity' },
  { step: 'persona_archetype', label: 'Archetype', path: '/onboarding/persona/archetype' },
  { step: 'persona_dimensions', label: 'Dimensions', path: '/onboarding/persona/dimensions' },
  { step: 'persona_traits', label: 'Traits', path: '/onboarding/persona/traits' },
  { step: 'persona_values', label: 'Values', path: '/onboarding/persona/values' },
  { step: 'persona_background', label: 'Background', path: '/onboarding/persona/background' },
  { step: 'persona_review', label: 'Review', path: '/onboarding/persona/review' },
];

export function OnboardingLayout() {
  const theme = useTheme();
  const location = useLocation();

  const isPersonaStep = location.pathname.includes('/persona/');
  const allSteps = isPersonaStep ? personaSteps : setupSteps;

  const currentIndex = allSteps.findIndex((s) => location.pathname === s.path);

  return (
    <div
      css={css`
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        background: ${theme.colors.background.default};
      `}
    >
      {/* Progress indicator */}
      <div
        css={css`
          display: flex;
          justify-content: center;
          padding: ${theme.spacing[6]} ${theme.spacing[4]};
          gap: ${theme.spacing[6]};
        `}
      >
        <ProgressGroup
          label="Setup"
          steps={setupSteps}
          currentPath={location.pathname}
          isGroupActive={!isPersonaStep}
        />
        <ProgressGroup
          label="Persona"
          steps={personaSteps}
          currentPath={location.pathname}
          isGroupActive={isPersonaStep}
        />
      </div>

      {/* Content */}
      <div
        css={css`
          flex: 1;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: ${theme.spacing[4]} ${theme.spacing[6]};
          padding-bottom: ${theme.spacing[12]};
        `}
      >
        <div
          css={css`
            width: 100%;
            max-width: 640px;

            @media (min-width: ${theme.breakpoints.lg}) {
              max-width: 720px;
            }
          `}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function ProgressGroup({
  label,
  steps,
  currentPath,
  isGroupActive,
}: {
  label: string;
  steps: { step: OnboardingStep; label: string; path: string }[];
  currentPath: string;
  isGroupActive: boolean;
}) {
  const theme = useTheme();
  const currentIndex = steps.findIndex((s) => currentPath === s.path);

  return (
    <div
      css={css`
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: ${theme.spacing[2]};
        opacity: ${isGroupActive ? 1 : 0.4};
        transition: opacity ${theme.transitions.normal};
      `}
    >
      <span
        css={css`
          font-size: ${theme.typography.fontSize.xs};
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${theme.colors.text.secondary};
          text-transform: uppercase;
          letter-spacing: 0.08em;
        `}
      >
        {label}
      </span>
      <div css={css`display: flex; gap: ${theme.spacing[1.5]};`}>
        {steps.map((s, i) => {
          const isCurrent = currentPath === s.path;
          const isComplete = isGroupActive && i < currentIndex;

          return (
            <div
              key={s.step}
              title={s.label}
              css={css`
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: ${isCurrent
                  ? theme.colors.accent
                  : isComplete
                    ? theme.colors.accent
                    : theme.colors.background.elevated};
                opacity: ${isCurrent ? 1 : isComplete ? 0.5 : 0.3};
                transition: all ${theme.transitions.fast};
              `}
            />
          );
        })}
      </div>
    </div>
  );
}
