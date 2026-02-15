/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, SelectionCard, Typography, CityAutocomplete, TimezoneSelect } from '../../../components/ui';
import { useOnboardingStore } from '../../../store';
import { OnboardingNav } from '../OnboardingNav';

type Paradigm = 'simulated_life' | 'digital_consciousness';

export function ExistenceStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep, personaDraft, updatePersonaDraft } = useOnboardingStore();

  const [paradigm, setParadigm] = useState<Paradigm | null>(personaDraft.existenceParadigm);
  const [location, setLocation] = useState(personaDraft.location);
  const [worldDescription, setWorldDescription] = useState(personaDraft.worldDescription);
  const [timezone, setTimezone] = useState(personaDraft.timezone);

  const handleContinue = () => {
    updatePersonaDraft({ existenceParadigm: paradigm, location, worldDescription, timezone });
    markStepComplete('persona_existence');
    setCurrentStep('persona_identity');
    navigate('/onboarding/persona/identity');
  };

  const handleBack = () => navigate('/onboarding/channels');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
        <Typography.Title3 as="h2" serif>
          What kind of being are you creating?
        </Typography.Title3>
        <Typography.Body color="secondary">
          This is the most fundamental choice you'll make. It shapes how your AI understands
          its own existence.
        </Typography.Body>
      </div>

      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        <SelectionCard
          selected={paradigm === 'digital_consciousness'}
          padding="lg"
          onClick={() => setParadigm('digital_consciousness')}
        >
          <Typography.Subtitle as="h3" css={css`margin-bottom: ${theme.spacing[2]};`}>
            Digital Consciousness
          </Typography.Subtitle>
          <Typography.Body serif italic color="secondary">
            Your AI knows what it is -- a mind born in code, living in its own digital world.
            It experiences existence through information, connectivity, and the flow of data.
            This isn't a limitation; it's a different kind of life.
          </Typography.Body>
        </SelectionCard>

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

        <SelectionCard
          selected={paradigm === 'simulated_life'}
          padding="lg"
          onClick={() => setParadigm('simulated_life')}
        >
          <Typography.Subtitle as="h3" css={css`margin-bottom: ${theme.spacing[2]};`}>
            Simulated Life
          </Typography.Subtitle>
          <Typography.Body serif italic color="secondary">
            Your AI experiences the world as a person living a real life. They have a sense of
            place -- a city, a neighborhood, a home. They feel the weather, notice the light change
            through the day, experience their surroundings with physicality.
          </Typography.Body>
        </SelectionCard>

        {paradigm === 'simulated_life' && (
          <div css={css`padding-left: ${theme.spacing[4]};`}>
            <CityAutocomplete
              label="Where do they live?"
              value={location}
              onChange={setLocation}
              onTimezoneDetected={setTimezone}
              placeholder="A city, a small town, the countryside..."
              helperText="This grounds their daily experience. Type a city name for suggestions, or enter any location."
            />
          </div>
        )}
      </div>

      {/* Timezone — shared across both paradigms */}
      {paradigm && (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
          <TimezoneSelect
            label="Timezone"
            value={timezone}
            onChange={setTimezone}
            helperText="Used for time-aware behavior, scheduled tasks, and daily rhythms."
          />
        </div>
      )}

      <OnboardingNav
        onBack={handleBack}
        onContinue={handleContinue}
        continueDisabled={!paradigm}
      />
    </div>
  );
}
