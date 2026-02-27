/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Select, Typography } from '../../../components/ui';
import { useOnboardingStore } from '../../../store';
import { OnboardingNav } from '../OnboardingNav';

export function PersonaIdentityStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep, personaDraft, updatePersonaDraft } = useOnboardingStore();

  const [name, setName] = useState(personaDraft.name);
  const [gender, setGender] = useState(personaDraft.gender);
  const [customGender, setCustomGender] = useState(personaDraft.customGender);
  const [age, setAge] = useState(personaDraft.age);
  const [physicalDescription, setPhysicalDescription] = useState(personaDraft.physicalDescription);

  const handleContinue = () => {
    updatePersonaDraft({ name, gender, customGender, age, physicalDescription });
    markStepComplete('persona_identity');
    setCurrentStep('persona_archetype');
    navigate('/onboarding/persona/archetype');
  };

  const handleBack = () => navigate('/onboarding/persona/existence');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        <Typography.Body color="secondary" serif css={css`
          font-style: italic;
        `}>
          Identity
        </Typography.Body>
        <Typography.Title3 as="h2" css={css`
          font-weight: ${theme.typography.fontWeight.medium};
        `}>
          Give them a name, an age, a face
        </Typography.Title3>
      </div>

      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[5]};`}>
        <Input
          label="What will you call them?"
          value={name}
          onChange={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder="Name"
          autoFocus
        />

        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
          <Select
            label="Gender"
            value={gender}
            onChange={setGender}
            placeholder="Select..."
            options={[
              { value: 'male', label: 'Male' },
              { value: 'female', label: 'Female' },
              { value: 'nonbinary', label: 'Non-binary' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
          {gender === 'custom' && (
            <Input
              value={customGender}
              onChange={(e) => setCustomGender((e.target as HTMLInputElement).value)}
              placeholder="How do they identify?"
            />
          )}
        </div>

        <Input
          label="How old are they?"
          type="number"
          value={age}
          onChange={(e) => setAge((e.target as HTMLInputElement).value)}
          placeholder="Age"
          helperText="This shapes their perspective. A 25-year-old and a 60-year-old experience the world differently."
        />

        <Input
          multiline
          label="What do they look like?"
          value={physicalDescription}
          onChange={(e) => setPhysicalDescription((e.target as HTMLTextAreaElement).value)}
          placeholder="Physical description (optional)"
        />
      </div>

      <OnboardingNav
        onBack={handleBack}
        onContinue={handleContinue}
        continueDisabled={!name.trim()}
      />
    </div>
  );
}
