/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input } from '../../../components/ui';
import { useOnboardingStore } from '../../../store';

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
      <div>
        <h2 css={css`font-size: ${theme.typography.fontSize['2xl']}; font-weight: ${theme.typography.fontWeight.light}; margin-bottom: ${theme.spacing[2]};`}>
          Who are they?
        </h2>
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
          <label css={css`font-size: ${theme.typography.fontSize.sm}; font-weight: ${theme.typography.fontWeight.medium}; color: ${theme.colors.text.secondary};`}>
            Gender
          </label>
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            css={css`
              padding: ${theme.spacing[3]};
              background: ${theme.colors.background.paper};
              border: 1px solid ${theme.colors.border.default};
              border-radius: ${theme.borderRadius.default};
              color: ${theme.colors.text.primary};
              font-size: ${theme.typography.fontSize.base};
              outline: none;
              &:focus { border-color: ${theme.colors.border.focus}; }
            `}
          >
            <option value="">Select...</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="nonbinary">Non-binary</option>
            <option value="custom">Custom</option>
          </select>
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
          helperText="This shapes their perspective -- a 25-year-old and a 60-year-old experience the world differently."
        />

        <Input
          multiline
          label="What do they look like?"
          value={physicalDescription}
          onChange={(e) => setPhysicalDescription((e.target as HTMLTextAreaElement).value)}
          placeholder="Physical description (optional)"
        />
      </div>

      <div css={css`display: flex; justify-content: space-between; margin-top: ${theme.spacing[4]};`}>
        <Button variant="ghost" onClick={handleBack}>Back</Button>
        <Button onClick={handleContinue} disabled={!name.trim()}>Continue</Button>
      </div>
    </div>
  );
}
