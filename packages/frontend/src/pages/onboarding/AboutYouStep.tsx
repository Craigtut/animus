/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input } from '../../components/ui';
import { useOnboardingStore } from '../../store';

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
        <h2
          css={css`
            font-size: ${theme.typography.fontSize['2xl']};
            font-weight: ${theme.typography.fontWeight.light};
            margin-bottom: ${theme.spacing[2]};
          `}
        >
          What should your Animus know about you?
        </h2>
        <p css={css`color: ${theme.colors.text.secondary};`}>
          This is context your Animus will always carry -- not something it has to learn over time.
          Think of it as the things you'd tell someone on day one.
        </p>
      </div>

      <Input
        multiline
        value={notes}
        onChange={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
        placeholder="What do you do? What are you passionate about? How do you like to communicate?"
      />

      {charCount > 1800 && (
        <p css={css`font-size: ${theme.typography.fontSize.xs}; color: ${theme.colors.text.hint};`}>
          Your Animus always carries this context, so keeping it concise helps it stay focused.
          You can always add more detail later.
        </p>
      )}

      <div css={css`display: flex; justify-content: space-between; margin-top: ${theme.spacing[4]};`}>
        <Button variant="ghost" onClick={handleBack}>Back</Button>
        <div css={css`display: flex; gap: ${theme.spacing[3]};`}>
          <Button variant="ghost" onClick={handleContinue}>Skip</Button>
          <Button onClick={handleContinue}>Continue</Button>
        </div>
      </div>
    </div>
  );
}
