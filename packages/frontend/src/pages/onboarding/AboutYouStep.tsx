/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Typography } from '../../components/ui';
import { useOnboardingStore } from '../../store';
import { OnboardingNav } from './OnboardingNav';

export function AboutYouStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep } = useOnboardingStore();

  const [notes, setNotes] = useState('');
  const charCount = notes.length;

  const handleContinue = () => {
    markStepComplete('about_you');
    setCurrentStep('persona_existence');
    navigate('/onboarding/persona/existence');
  };

  const handleBack = () => navigate('/onboarding/identity');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        <Typography.Body color="secondary" serif css={css`
          font-style: italic;
        `}>
          The things you'd share on day one
        </Typography.Body>
        <Typography.Title3 as="h2" css={css`
          font-weight: ${theme.typography.fontWeight.medium};
        `}>
          What should your Animus know about you?
        </Typography.Title3>
      </div>

      <Input
        multiline
        value={notes}
        onChange={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
        placeholder="What do you do? What are you passionate about? How do you like to communicate?"
      />

      {charCount > 1800 && (
        <Typography.Caption as="p" color="hint">
          Your Animus always carries this context, so keeping it concise helps it stay focused.
          You can always add more detail later.
        </Typography.Caption>
      )}

      <OnboardingNav
        onBack={handleBack}
        onContinue={handleContinue}
        onSkip={handleContinue}
      />
    </div>
  );
}
