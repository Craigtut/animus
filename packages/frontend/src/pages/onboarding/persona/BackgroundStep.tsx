/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Typography } from '../../../components/ui';
import { useOnboardingStore } from '../../../store';
import { OnboardingNav } from '../OnboardingNav';

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
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
        <Typography.Title3 as="h2" serif>
          Give them depth
        </Typography.Title3>
        <Typography.Body color="secondary">
          Structure gets you far, but the details make it real.
        </Typography.Body>
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

      <OnboardingNav
        onBack={handleBack}
        onContinue={handleContinue}
      />
    </div>
  );
}
