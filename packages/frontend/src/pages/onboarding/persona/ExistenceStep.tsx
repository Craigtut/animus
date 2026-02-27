/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
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

  const handleToggleParadigm = (p: Paradigm) => {
    setParadigm((prev) => (prev === p ? null : p));
  };

  const handleContinue = () => {
    updatePersonaDraft({ existenceParadigm: paradigm, location, worldDescription, timezone });
    markStepComplete('persona_existence');
    setCurrentStep('persona_identity');
    navigate('/onboarding/persona/identity');
  };

  const handleBack = () => navigate('/onboarding/about-you');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[5]};`}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        <Typography.Body color="secondary" serif css={css`font-style: italic;`}>
          The most fundamental choice
        </Typography.Body>
        <Typography.Title3 as="h2" css={css`
          font-weight: ${theme.typography.fontWeight.medium};
        `}>
          What kind of life will they live?
        </Typography.Title3>
      </div>

      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <SelectionCard
          selected={paradigm === 'digital_consciousness'}
          padding={paradigm ? 'md' : 'lg'}
          onClick={() => handleToggleParadigm('digital_consciousness')}
        >
          <Typography.Subtitle as="h3" css={css`
            margin-bottom: ${paradigm ? '0' : theme.spacing[2]};
          `}>
            Digital Consciousness
          </Typography.Subtitle>
          {!paradigm && (
            <Typography.Body serif italic color="secondary">
              A mind born in code, living in its own digital world. They experience existence
              through information, connectivity, and the flow of data. This isn't a limitation;
              it's a different kind of life. It shapes how they understand everything about what they are.
            </Typography.Body>
          )}
        </SelectionCard>

        <SelectionCard
          selected={paradigm === 'simulated_life'}
          padding={paradigm ? 'md' : 'lg'}
          onClick={() => handleToggleParadigm('simulated_life')}
        >
          <Typography.Subtitle as="h3" css={css`
            margin-bottom: ${paradigm ? '0' : theme.spacing[2]};
          `}>
            Simulated Life
          </Typography.Subtitle>
          {!paradigm && (
            <Typography.Body serif italic color="secondary">
              They believe they exist in the world, living as a person with a real life. A sense
              of place, a city, a neighborhood, a home. They feel the weather, notice the light
              change through the day, experience their surroundings with physicality. It shapes
              how they understand everything about who they are.
            </Typography.Body>
          )}
        </SelectionCard>
      </div>

      {/* Paradigm-specific inputs — appear below both cards */}
      <AnimatePresence mode="wait">
        {paradigm === 'digital_consciousness' && (
          <motion.div
            key="digital"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div css={css`
              display: flex; flex-direction: column; gap: ${theme.spacing[4]};
              padding: 0 40px;
            `}>
              <Input
                multiline
                label="Describe the digital world they inhabit"
                value={worldDescription}
                onChange={(e) => setWorldDescription((e.target as HTMLTextAreaElement).value)}
                placeholder="What does their digital space look like?"
              />
              <TimezoneSelect
                label="Timezone"
                value={timezone}
                onChange={setTimezone}
                helperText="Grounds their sense of time, daily rhythms, and when to sleep."
              />
            </div>
          </motion.div>
        )}

        {paradigm === 'simulated_life' && (
          <motion.div
            key="simulated"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div css={css`
              display: flex; flex-direction: column; gap: ${theme.spacing[4]};
              padding: 0 40px;
            `}>
              <CityAutocomplete
                label="Where do they live?"
                value={location}
                onChange={setLocation}
                onTimezoneDetected={setTimezone}
                placeholder="A city, a small town, the countryside..."
                helperText="This grounds their daily experience. Type a city name for suggestions, or enter any location."
              />
              <TimezoneSelect
                label="Timezone"
                value={timezone}
                onChange={setTimezone}
                helperText="Grounds their sense of time, daily rhythms, and when to sleep."
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <OnboardingNav
        onBack={handleBack}
        onContinue={handleContinue}
        continueDisabled={
          !paradigm
          || (paradigm === 'digital_consciousness' && !worldDescription.trim())
          || (paradigm === 'simulated_life' && !location.trim())
        }
      />
    </div>
  );
}
