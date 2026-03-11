/** @jsxImportSource @emotion/react */
import { css, useTheme, keyframes } from '@emotion/react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Typography } from '../components/ui';
import { TauriDragRegion } from '../components/layout/TauriDragRegion';
import { ParticleRing } from '../components/effects/ParticleRing';
import { trpc } from '../utils/trpc';

// Phrases organized by install phase. Within each phase we pick randomly,
// but the overall tone progresses from "starting" to "almost done."
const PHRASES = {
  early: [
    'Setting things up.',
    'Preparing your Animus.',
    'Getting everything in order.',
    'One moment.',
  ],
  mid: [
    'Laying the groundwork.',
    'Building the foundation.',
    'Putting things in place.',
    'Making room.',
  ],
  late: [
    'Nearly there.',
    'Just about ready.',
    'Finishing up.',
    'Almost there.',
  ],
};

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

export function SetupPage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const [phraseIndex, setPhraseIndex] = useState(() => Math.floor(Math.random() * PHRASES.early.length));
  const [phrasePhase, setPhrasePhase] = useState<'early' | 'mid' | 'late'>('early');
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const installTriggered = useRef(false);

  const utils = trpc.useUtils();
  const installMutation = trpc.sdk.install.useMutation();

  const { data: onboardingState } = trpc.onboarding.getState.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const navigateAway = useCallback(() => {
    utils.sdk.status.setData(undefined, {
      installed: true,
      version: null,
      installPath: '',
      installing: false,
      error: null,
    });
    navigate(onboardingState?.isComplete ? '/' : '/onboarding');
  }, [utils, navigate, onboardingState]);

  // Subscribe to install progress
  trpc.sdk.onInstallProgress.useSubscription(undefined, {
    onData: (data) => {
      if (data.phase === 'complete') {
        navigateAway();
      } else if (data.phase === 'error') {
        setError(data.error ?? 'Something went wrong. Please check your internet connection.');
        setInstalling(false);
      } else if (data.phase === 'downloading') {
        setPhrasePhase('mid');
      } else if (data.phase === 'installing') {
        setPhrasePhase('late');
      }
    },
  });

  // Fallback: poll SDK status in case the subscription misses the complete event
  // (e.g., install finishes before the WebSocket connects)
  const { data: sdkStatus } = trpc.sdk.status.useQuery(undefined, {
    refetchInterval: installing ? 3000 : false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (installing && sdkStatus?.installed) {
      navigateAway();
    }
  }, [installing, sdkStatus, navigateAway]);

  const startInstall = useCallback(() => {
    setError(null);
    setInstalling(true);
    setPhrasePhase('early');
    installMutation.mutate(undefined, {
      onError: (err) => {
        setError(err.message);
        setInstalling(false);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-trigger install on mount
  useEffect(() => {
    if (!installTriggered.current) {
      installTriggered.current = true;
      startInstall();
    }
  }, [startInstall]);

  // Rotate phrases with slightly varied timing (3-5s)
  useEffect(() => {
    const tick = () => {
      const currentPhrases = PHRASES[phrasePhase];
      setPhraseIndex((prev) => {
        let next = Math.floor(Math.random() * currentPhrases.length);
        if (next === prev && currentPhrases.length > 1) {
          next = (next + 1) % currentPhrases.length;
        }
        return next;
      });
      // Varied timing: 3-5 seconds
      const delay = 3000 + Math.random() * 2000;
      timer = window.setTimeout(tick, delay);
    };
    let timer = window.setTimeout(tick, 3500);
    return () => clearTimeout(timer);
  }, [phrasePhase]);

  const currentPhrase = PHRASES[phrasePhase][phraseIndex % PHRASES[phrasePhase].length];

  return (
    <div
      css={css`
        position: fixed;
        inset: 0;
        background: ${theme.colors.background.default};
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      `}
    >
      <TauriDragRegion />

      {/* Particle ring */}
      <ParticleRing mode={theme.mode} />

      {/* Center content — overlaid on the ring */}
      <div
        css={css`
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          animation: ${fadeIn} 1.2s ease-out;
        `}
      >
        {/* Rotating phrases */}
        <div
          css={css`
            position: relative;
            height: 2em;
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 280px;
          `}
        >
          <AnimatePresence mode="wait">
            {!error && (
              <motion.div
                key={`${phrasePhase}-${phraseIndex}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 0.65, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.7, ease: 'easeInOut' }}
                css={css`
                  position: absolute;
                  text-align: center;
                  width: 100%;
                `}
              >
                <Typography.Body
                  serif
                  italic
                  color="secondary"
                  css={css`
                    font-size: ${theme.typography.fontSize.lg};
                    font-weight: ${theme.typography.fontWeight.light};
                  `}
                >
                  {currentPhrase}
                </Typography.Body>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error state */}
          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              css={css`
                text-align: center;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: ${theme.spacing[4]};
                pointer-events: auto;
              `}
            >
              <Typography.Body
                color="secondary"
                css={css`
                  font-size: ${theme.typography.fontSize.sm};
                  max-width: 400px;
                  line-height: ${theme.typography.lineHeight.relaxed};
                `}
              >
                {error}
              </Typography.Body>
              <button
                onClick={() => {
                  installTriggered.current = false;
                  startInstall();
                }}
                disabled={installing}
                css={css`
                  padding: ${theme.spacing[2]} ${theme.spacing[6]};
                  border: 1px solid ${theme.colors.border.default};
                  border-radius: ${theme.borderRadius.md};
                  background: ${theme.colors.background.paper};
                  color: ${theme.colors.text.primary};
                  font-family: ${theme.typography.fontFamily.sans};
                  font-size: ${theme.typography.fontSize.sm};
                  cursor: pointer;
                  transition: background 0.15s;

                  &:hover:not(:disabled) {
                    background: ${theme.colors.background.elevated};
                  }
                  &:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                  }
                `}
              >
                Try again
              </button>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
