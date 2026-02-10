/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input } from '../../components/ui';
import { useOnboardingStore } from '../../store';

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
      <div>
        <h2
          css={css`
            font-size: ${theme.typography.fontSize['2xl']};
            font-weight: ${theme.typography.fontWeight.light};
            margin-bottom: ${theme.spacing[2]};
          `}
        >
          Tell your Animus who you are
        </h2>
        <p css={css`color: ${theme.colors.text.secondary};`}>
          This is how your Animus will know you across every channel.
        </p>
      </div>

      <Input
        label="What should your Animus call you?"
        value={fullName}
        onChange={(e) => setFullName((e.target as HTMLInputElement).value)}
        placeholder="Your name"
        autoFocus
      />

      <div css={css`display: flex; justify-content: space-between; margin-top: ${theme.spacing[4]};`}>
        <Button variant="ghost" onClick={handleBack}>Back</Button>
        <Button onClick={handleContinue} disabled={!fullName.trim()}>Continue</Button>
      </div>
    </div>
  );
}
