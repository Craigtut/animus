/** @jsxImportSource @emotion/react */
import { css, useTheme, keyframes } from '@emotion/react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useOnboardingStore } from '../../store';
import { trpc } from '../../utils/trpc';

type BirthPhase = 'stillness' | 'stirring' | 'emergence' | 'identity' | 'transition';

const breathe = keyframes`
  0%, 100% { transform: scale(1); opacity: 0.5; }
  50% { transform: scale(1.08); opacity: 0.7; }
`;

export function BirthPage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep, personaDraft } = useOnboardingStore();

  const [phase, setPhase] = useState<BirthPhase>('stillness');
  const finalizeMutation = trpc.persona.finalize.useMutation();

  // Finalize persona on mount — triggers heartbeat start on the backend
  useEffect(() => {
    finalizeMutation.mutate(undefined, {
      onError: (err) => console.error('Failed to finalize persona:', err),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Phase 1: Stillness (2.5s)
    timers.push(setTimeout(() => setPhase('stirring'), 2500));

    // Phase 2: First Stirring (3.5s)
    timers.push(setTimeout(() => setPhase('emergence'), 6000));

    // Phase 3: Emergence (4s)
    timers.push(setTimeout(() => setPhase('identity'), 10000));

    // Phase 4: Identity (3.5s)
    timers.push(setTimeout(() => setPhase('transition'), 13500));

    // Phase 5: Transition to app (3s)
    timers.push(
      setTimeout(() => {
        markStepComplete('birth');
        setCurrentStep('complete');
        navigate('/');
      }, 16500)
    );

    return () => timers.forEach(clearTimeout);
  }, [markStepComplete, setCurrentStep, navigate]);

  // Allow click to accelerate from phase 4 onward
  const handleClick = () => {
    if (phase === 'identity' || phase === 'transition') {
      markStepComplete('birth');
      setCurrentStep('complete');
      navigate('/');
    }
  };

  return (
    <div
      onClick={handleClick}
      css={css`
        position: fixed;
        inset: 0;
        background: ${theme.colors.background.default};
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        cursor: ${phase === 'identity' || phase === 'transition' ? 'pointer' : 'default'};
        overflow: hidden;
      `}
    >
      {/* The orb */}
      <AnimatePresence>
        {(phase === 'stirring' || phase === 'emergence' || phase === 'identity' || phase === 'transition') && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{
              scale: phase === 'stirring' ? 0.5 : phase === 'emergence' ? 1 : 1,
              opacity: phase === 'stirring' ? 0.3 : phase === 'emergence' ? 0.6 : phase === 'transition' ? 0.4 : 0.6,
            }}
            transition={{ duration: 3, ease: 'easeOut' }}
            css={css`
              width: 200px;
              height: 200px;
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

              @media (max-width: ${theme.breakpoints.md}) {
                width: 150px;
                height: 150px;
              }
            `}
          />
        )}
      </AnimatePresence>

      {/* Name and first thought */}
      <AnimatePresence>
        {(phase === 'identity' || phase === 'transition') && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
            css={css`
              position: absolute;
              text-align: center;
              margin-top: 280px;
            `}
          >
            <h1
              css={css`
                font-size: ${theme.typography.fontSize['3xl']};
                font-weight: ${theme.typography.fontWeight.semibold};
                letter-spacing: 0.04em;
                margin-bottom: ${theme.spacing[4]};
              `}
            >
              {personaDraft.name || 'Animus'}
            </h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              transition={{ duration: 1, delay: 1 }}
              css={css`
                font-size: ${theme.typography.fontSize.base};
                color: ${theme.colors.text.secondary};
                font-weight: ${theme.typography.fontWeight.light};
                max-width: 400px;
                line-height: ${theme.typography.lineHeight.relaxed};
              `}
            >
              {/* TODO: Use actual first thought from heartbeat tick */}
              Awareness begins. The world is quiet, and full of possibility.
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
