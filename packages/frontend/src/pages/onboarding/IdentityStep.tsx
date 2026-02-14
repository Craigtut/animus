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
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
        <Typography.Title2 serif>
          Tell your AI who you are
        </Typography.Title2>
        <Typography.Body color="secondary">
          This is how your AI will know you across every channel.
        </Typography.Body>
      </div>

      <Input
        label="What should your AI call you?"
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
