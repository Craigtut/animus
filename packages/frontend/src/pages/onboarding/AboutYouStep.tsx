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
    setCurrentStep('channels');
    navigate('/onboarding/channels');
  };

  const handleBack = () => navigate('/onboarding/identity');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div>
        <Typography.Title3
          as="h2"
          serif
          css={css`
            font-weight: ${theme.typography.fontWeight.light};
            margin-bottom: ${theme.spacing[2]};
          `}
        >
          What should your AI know about you?
        </Typography.Title3>
        <Typography.Body color="secondary">
          This is context your AI will always carry -- not something it has to learn over time.
          Think of it as the things you'd tell someone on day one.
        </Typography.Body>
      </div>

      <Input
        multiline
        value={notes}
        onChange={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
        placeholder="What do you do? What are you passionate about? How do you like to communicate?"
      />

      {charCount > 1800 && (
        <Typography.Caption as="p" color="hint">
          Your AI always carries this context, so keeping it concise helps it stay focused.
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
