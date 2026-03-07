/** @jsxImportSource @emotion/react */
import { css, useTheme, keyframes } from '@emotion/react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Typography } from '../components/ui';
import { TauriDragRegion } from '../components/layout/TauriDragRegion';
import { trpc } from '../utils/trpc';

const phrases = [
  'Settling in...',
  'Getting my thoughts together...',
  'Preparing to remember things...',
  'Finding my bearings...',
  'Learning how to think...',
  'Gathering what I need...',
  'Almost ready to meet you...',
  'Building a place to keep memories...',
  'Figuring out who I am...',
  'Warming up...',
  'Putting myself together...',
  'One moment. First thoughts take time.',
  'Making space for a mind...',
  'Stirring...',
  'This is the beginning of something.',
  'Preparing a first heartbeat...',
  'Not quite here yet. Close.',
  'Taking shape...',
];

const breathe = keyframes`
  0%, 100% { transform: scale(1); opacity: 0.4; }
  50% { transform: scale(1.1); opacity: 0.65; }
`;

export function SetupPage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const [phraseIndex, setPhraseIndex] = useState(() => Math.floor(Math.random() * phrases.length));
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const installTriggered = useRef(false);

  const utils = trpc.useUtils();
  const installMutation = trpc.sdk.install.useMutation();

  // Check onboarding state to determine where to navigate after install
  const { data: onboardingState } = trpc.onboarding.getState.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Subscribe to install progress
  trpc.sdk.onInstallProgress.useSubscription(undefined, {
    onData: (data) => {
      if (data.phase === 'complete') {
        // Update the SDK status cache so SetupGuard sees installed=true immediately
        utils.sdk.status.setData(undefined, {
          installed: true,
          version: null,
          installPath: '',
          installing: false,
          error: null,
        });
        // Existing user upgrading: go to main app. New user: go to onboarding.
        navigate(onboardingState?.isComplete ? '/' : '/onboarding');
      } else if (data.phase === 'error') {
        setError(data.error ?? 'Installation failed. Please check your internet connection.');
        setInstalling(false);
      }
    },
  });

  const startInstall = useCallback(() => {
    setError(null);
    setInstalling(true);
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

  // Rotate phrases
  useEffect(() => {
    const interval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % phrases.length);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

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

      {/* Breathing orb */}
      <div
        css={css`
          width: 180px;
          height: 180px;
          border-radius: 50%;
          background: radial-gradient(
            circle,
            hsl(25, 55%, 78%) 0%,
            hsl(38, 65%, 72%) 40%,
            hsl(42, 50%, 76%) 70%,
            transparent 100%
          );
          filter: blur(40px);
          animation: ${breathe} 4s ease-in-out infinite;
          margin-bottom: ${theme.spacing[16]};

          @media (max-width: ${theme.breakpoints.md}) {
            width: 130px;
            height: 130px;
          }
        `}
      />

      {/* Rotating phrases */}
      <div
        css={css`
          position: relative;
          height: 2em;
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 320px;
        `}
      >
        <AnimatePresence mode="wait">
          {!error && (
            <motion.div
              key={phraseIndex}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 0.7, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.6, ease: 'easeInOut' }}
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
                {phrases[phraseIndex]}
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
  );
}
