/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { FluidBackground } from '../../components/effects/FluidBackground';
import { TauriDragRegion } from '../../components/layout/TauriDragRegion';
import { Typography } from '../../components/ui';
import type { OnboardingStep } from '../../store';

const setupSteps: { step: OnboardingStep; label: string; path: string }[] = [
  { step: 'welcome', label: 'Welcome', path: '/onboarding/welcome' },
  { step: 'agent_provider', label: 'Agent', path: '/onboarding/agent' },
  { step: 'identity', label: 'You', path: '/onboarding/identity' },
  { step: 'about_you', label: 'About You', path: '/onboarding/about-you' },
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

  const isPersona = location.pathname.includes('/persona/');
  const steps = isPersona ? personaSteps : setupSteps;
  const groupLabel = isPersona ? 'Persona' : 'Setup';
  const currentIndex = steps.findIndex((s) => location.pathname === s.path);
  const currentStepLabel = currentIndex >= 0 ? steps[currentIndex]!.label : '';

  return (
    <div
      css={css`
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        background: ${theme.colors.background.default};
      `}
    >
      <TauriDragRegion />

      {/* Fluid WebGL background — persists across all onboarding steps */}
      <FluidBackground mode={theme.mode} />

      {/* Progress indicator — transparent, sits on the WebGL background */}
      <nav
        css={css`
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: ${theme.spacing[5]} ${theme.spacing[4]} ${theme.spacing[2]};
          gap: 5px;
        `}
        aria-label="Onboarding progress"
      >
        {/* Group label */}
        <AnimatePresence mode="wait">
          <Typography.Caption
            as={motion.span}
            key={groupLabel}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 0.35, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            css={css`
              font-weight: ${theme.typography.fontWeight.medium};
              text-transform: uppercase;
              letter-spacing: 0.14em;
            `}
          >
            {groupLabel}
          </Typography.Caption>
        </AnimatePresence>

        {/* Dot track — only current group shown */}
        <LayoutGroup>
          <AnimatePresence mode="wait">
            <motion.div
              key={groupLabel}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
              css={css`
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 3px;
                height: 18px;
              `}
            >
              {steps.map((step, i) => (
                <StepDot
                  key={step.step}
                  state={
                    i < currentIndex
                      ? 'complete'
                      : i === currentIndex
                        ? 'current'
                        : 'upcoming'
                  }
                  distanceFromCurrent={i - currentIndex}
                />
              ))}
            </motion.div>
          </AnimatePresence>
        </LayoutGroup>

        {/* Current step name — deblurs into focus */}
        <AnimatePresence mode="wait">
          <Typography.Caption
            as={motion.span}
            key={currentStepLabel}
            initial={{ opacity: 0, y: 3, filter: 'blur(3px)' }}
            animate={{ opacity: 0.6, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -3, filter: 'blur(3px)' }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            css={css`
              font-weight: ${theme.typography.fontWeight.medium};
              letter-spacing: 0.01em;
            `}
          >
            {currentStepLabel}
          </Typography.Caption>
        </AnimatePresence>
      </nav>

      {/* Content */}
      <div
        css={css`
          position: relative;
          z-index: 1;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: ${theme.spacing[4]} ${theme.spacing[6]};
          padding-bottom: 7.5rem; /* ~120px clearance for the fixed OnboardingNav bar */
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

// ---------------------------------------------------------------------------
// StepDot — a single dot in the progress track
// ---------------------------------------------------------------------------

function StepDot({
  state,
  distanceFromCurrent,
}: {
  state: 'complete' | 'current' | 'upcoming';
  distanceFromCurrent: number;
}) {
  const theme = useTheme();

  return (
    <div
      css={css`
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 12px;
        height: 12px;
      `}
    >
      {/* Completed — pops in with spring */}
      {state === 'complete' && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{
            type: 'spring',
            stiffness: 500,
            damping: 22,
            mass: 0.8,
          }}
          css={css`
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background: ${theme.colors.text.primary};
            opacity: 0.5;
          `}
        />
      )}

      {/* Current — active pip with breathing ring */}
      {state === 'current' && (
        <>
          {/* Breathing ring — slow inhale/exhale */}
          <motion.div
            animate={{
              scale: [1, 2.4, 1],
              opacity: [0.2, 0, 0.2],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            css={css`
              position: absolute;
              width: 7px;
              height: 7px;
              border-radius: 50%;
              border: 1px solid ${theme.colors.text.primary};
            `}
          />
          {/* Core pip — slides between positions via layoutId */}
          <motion.div
            layoutId="step-pip"
            css={css`
              width: 7px;
              height: 7px;
              border-radius: 50%;
              background: ${theme.colors.text.primary};
            `}
            transition={{
              type: 'spring',
              stiffness: 350,
              damping: 28,
            }}
          />
        </>
      )}

      {/* Upcoming — faint, progressively dimmer */}
      {state === 'upcoming' && (
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{
            scale: 1,
            opacity: Math.max(0.12, 0.28 - distanceFromCurrent * 0.035),
          }}
          transition={{
            delay: distanceFromCurrent * 0.04,
            duration: 0.35,
            ease: 'easeOut',
          }}
          css={css`
            width: 3px;
            height: 3px;
            border-radius: 50%;
            background: ${theme.colors.text.primary};
          `}
        />
      )}
    </div>
  );
}
