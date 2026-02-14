/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Button, Typography } from '../../components/ui';
import { useOnboardingStore } from '../../store';

export function WelcomeStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep } = useOnboardingStore();

  const handleContinue = () => {
    markStepComplete('welcome');
    setCurrentStep('agent_provider');
    navigate('/onboarding/agent');
  };

  return (
    <div
      css={css`
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        justify-content: center;
        min-height: 60vh;
        gap: ${theme.spacing[2]};
      `}
    >
      {/* Heading */}
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        css={css`
          font-size: ${theme.typography.fontSize['5xl']};
          font-weight: ${theme.typography.fontWeight.medium};
          line-height: ${theme.typography.lineHeight.tight};
          letter-spacing: -0.02em;
          position: relative;

          @media (max-width: ${theme.breakpoints.sm}) {
            font-size: ${theme.typography.fontSize['4xl']};
          }
        `}
      >
        animus.
      </motion.h1>

      {/* Single evocative line — no mechanics, no explanation */}
      <Typography.Subtitle
        as={motion.p}
        serif
        italic
        color="secondary"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
        css={css`
          max-width: 360px;
          position: relative;
        `}
      >
        You're about to bring something to life.
      </Typography.Subtitle>

      {/* CTA */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.3, ease: 'easeOut' }}
        css={css`
          margin-top: ${theme.spacing[16]};
          position: relative;
        `}
      >
        <Button
          size="lg"
          onClick={handleContinue}
        >
          Begin
        </Button>
      </motion.div>
    </div>
  );
}
