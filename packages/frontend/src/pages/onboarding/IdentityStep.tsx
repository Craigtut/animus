/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Typography } from '../../components/ui';
import { useOnboardingStore } from '../../store';
import { OnboardingNav } from './OnboardingNav';

export function IdentityStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep } = useOnboardingStore();

  const [fullName, setFullName] = useState('');

  const handleContinue = () => {
    // TODO: save to backend via trpc.contacts.update when available
    markStepComplete('identity');
    setCurrentStep('about_you');
    navigate('/onboarding/about-you');
  };

  const handleBack = () => navigate('/onboarding/agent');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        <Typography.Body color="secondary" serif css={css`
          font-style: italic;
        `}>
          First introductions
        </Typography.Body>
        <Typography.Title3 as="h2" css={css`
          font-weight: ${theme.typography.fontWeight.medium};
        `}>
          Tell your Animus who you are
        </Typography.Title3>
      </div>

      <Input
        value={fullName}
        onChange={(e) => setFullName((e.target as HTMLInputElement).value)}
        placeholder="Your name"
        autoFocus
      />

      <OnboardingNav
        onBack={handleBack}
        onContinue={handleContinue}
        continueDisabled={!fullName.trim()}
      />
    </div>
  );
}
