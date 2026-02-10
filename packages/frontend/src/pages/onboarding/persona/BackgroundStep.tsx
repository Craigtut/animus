/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input } from '../../../components/ui';
import { useOnboardingStore } from '../../../store';

export function BackgroundStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep, personaDraft, updatePersonaDraft } = useOnboardingStore();

  const [personalityNotes, setPersonalityNotes] = useState(personaDraft.personalityNotes);
  const [background, setBackground] = useState(personaDraft.background);

  const handleContinue = () => {
    updatePersonaDraft({ personalityNotes, background });
    markStepComplete('persona_background');
    setCurrentStep('persona_review');
    navigate('/onboarding/persona/review');
  };

  const handleBack = () => navigate('/onboarding/persona/values');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div>
        <h2 css={css`font-size: ${theme.typography.fontSize['2xl']}; font-weight: ${theme.typography.fontWeight.light}; margin-bottom: ${theme.spacing[2]};`}>
          Give them depth
        </h2>
        <p css={css`color: ${theme.colors.text.secondary};`}>
          Structure gets you far, but the details make it real.
        </p>
      </div>

      <Input
        multiline
        label="Anything else that makes them who they are?"
        value={personalityNotes}
        onChange={(e) => setPersonalityNotes((e.target as HTMLTextAreaElement).value)}
        placeholder="Quirks, speech patterns, habits, contradictions, hidden depths..."
        helperText='E.g., "Uses cooking metaphors when explaining things. Gets genuinely excited about obscure facts."'
      />

      <Input
        multiline
        label="What shaped who they are?"
        value={background}
        onChange={(e) => setBackground((e.target as HTMLTextAreaElement).value)}
        placeholder="Background, backstory, defining experiences..."
        helperText="What was their early life like? What do they carry with them?"
      />

      <div css={css`display: flex; justify-content: space-between; margin-top: ${theme.spacing[4]};`}>
        <Button variant="ghost" onClick={handleBack}>Back</Button>
        <Button onClick={handleContinue}>Continue</Button>
      </div>
    </div>
  );
}
