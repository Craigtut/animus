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
      {/* Logo + Word Mark */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        css={css`
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: ${theme.spacing[3]};
          position: relative;
        `}
      >
        <img
          src="/favicon.svg"
          alt=""
          css={css`
            width: 40px;
            height: 40px;
          `}
        />
        <Typography.Title
          as="h1"
          color="#927768"
          style={{
            fontSize: 40,
            fontWeight: theme.typography.fontWeight.light,
            letterSpacing: '-0.02em',
          }}
        >
          animus
        </Typography.Title>
      </motion.div>

      {/* Single evocative line — no mechanics, no explanation */}
      <Typography.Subtitle
        as={motion.p}
        serif
        italic
        color="secondary"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
        style={{ fontSize: 20 }}
        css={css`
          max-width: 480px;
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
          margin-top: ${theme.spacing[12]};
          position: relative;

          & > button {
            border-radius: 9999px !important;
            padding-left: 48px !important;
            padding-right: 48px !important;
          }
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
