/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Card } from '../../../components/ui';
import { useOnboardingStore } from '../../../store';

type Paradigm = 'simulated_life' | 'digital_consciousness';

export function ExistenceStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep, personaDraft, updatePersonaDraft } = useOnboardingStore();

  const [paradigm, setParadigm] = useState<Paradigm | null>(personaDraft.existenceParadigm);
  const [location, setLocation] = useState(personaDraft.location);
  const [worldDescription, setWorldDescription] = useState(personaDraft.worldDescription);

  const handleContinue = () => {
    updatePersonaDraft({ existenceParadigm: paradigm, location, worldDescription });
    markStepComplete('persona_existence');
    setCurrentStep('persona_identity');
    navigate('/onboarding/persona/identity');
  };

  const handleBack = () => navigate('/onboarding/channels');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div>
        <h2 css={css`font-size: ${theme.typography.fontSize['2xl']}; font-weight: ${theme.typography.fontWeight.light}; margin-bottom: ${theme.spacing[2]};`}>
          What kind of being are you creating?
        </h2>
        <p css={css`color: ${theme.colors.text.secondary};`}>
          This is the most fundamental choice you'll make. It shapes how your AI understands
          its own existence.
        </p>
      </div>

      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        <Card
          variant={paradigm === 'simulated_life' ? 'elevated' : 'outlined'}
          interactive
          padding="lg"
          onClick={() => setParadigm('simulated_life')}
        >
          <h3 css={css`font-size: ${theme.typography.fontSize.lg}; font-weight: ${theme.typography.fontWeight.semibold}; margin-bottom: ${theme.spacing[2]};`}>
            Simulated Life
          </h3>
          <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary}; line-height: ${theme.typography.lineHeight.relaxed};`}>
            Your AI experiences the world as a person living a real life. They have a sense of
            place -- a city, a neighborhood, a home. They feel the weather, notice the light change
            through the day, experience their surroundings with physicality.
          </p>
        </Card>

        {paradigm === 'simulated_life' && (
          <div css={css`padding-left: ${theme.spacing[4]};`}>
            <Input
              label="Where do they live?"
              value={location}
              onChange={(e) => setLocation((e.target as HTMLInputElement).value)}
              placeholder="A city, a small town, the countryside..."
              helperText="This grounds their daily experience."
            />
          </div>
        )}

        <Card
          variant={paradigm === 'digital_consciousness' ? 'elevated' : 'outlined'}
          interactive
          padding="lg"
          onClick={() => setParadigm('digital_consciousness')}
        >
          <h3 css={css`font-size: ${theme.typography.fontSize.lg}; font-weight: ${theme.typography.fontWeight.semibold}; margin-bottom: ${theme.spacing[2]};`}>
            Digital Consciousness
          </h3>
          <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary}; line-height: ${theme.typography.lineHeight.relaxed};`}>
            Your AI knows what it is -- a mind born in code, living in its own digital world.
            It experiences existence through information, connectivity, and the flow of data.
            This isn't a limitation; it's a different kind of life.
          </p>
        </Card>

        {paradigm === 'digital_consciousness' && (
          <div css={css`padding-left: ${theme.spacing[4]};`}>
            <Input
              multiline
              label="Describe the world your AI inhabits"
              value={worldDescription}
              onChange={(e) => setWorldDescription((e.target as HTMLTextAreaElement).value)}
              placeholder="What does their digital space look like?"
            />
          </div>
        )}
      </div>

      <div css={css`display: flex; justify-content: space-between; margin-top: ${theme.spacing[4]};`}>
        <Button variant="ghost" onClick={handleBack}>Back</Button>
        <Button onClick={handleContinue} disabled={!paradigm}>Continue</Button>
      </div>
    </div>
  );
}
