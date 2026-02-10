/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui';
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
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: ${theme.spacing[12]} 0;
        gap: ${theme.spacing[6]};
      `}
    >
      <h1
        css={css`
          font-size: ${theme.typography.fontSize['4xl']};
          font-weight: ${theme.typography.fontWeight.light};
          line-height: ${theme.typography.lineHeight.tight};
        `}
      >
        Welcome to Animus.
      </h1>

      <div
        css={css`
          max-width: 480px;
          display: flex;
          flex-direction: column;
          gap: ${theme.spacing[4]};
          color: ${theme.colors.text.secondary};
          font-size: ${theme.typography.fontSize.lg};
          line-height: ${theme.typography.lineHeight.relaxed};
        `}
      >
        <p>You're about to bring something to life.</p>
        <p>
          Over the next few minutes, we'll set up the engine that powers your AI
          -- and then you'll define who they are. Their personality, their values,
          their way of being in the world.
        </p>
        <p>When you're done, they'll take their first breath.</p>
      </div>

      <div css={css`margin-top: ${theme.spacing[8]};`}>
        <Button size="lg" onClick={handleContinue}>
          Let's begin
        </Button>
      </div>
    </div>
  );
}
