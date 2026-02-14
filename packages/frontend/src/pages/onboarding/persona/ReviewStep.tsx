/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Typography } from '../../../components/ui';
import { useOnboardingStore } from '../../../store';
import { OnboardingNav } from '../OnboardingNav';
import { trpc } from '../../../utils/trpc';

export function ReviewStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep, personaDraft } = useOnboardingStore();
  const [isSaving, setIsSaving] = useState(false);

  const saveDraft = trpc.persona.saveDraft.useMutation();
  const updateSettings = trpc.settings.updateSystemSettings.useMutation();

  const handleBringToLife = async () => {
    setIsSaving(true);
    try {
      // Persist all persona data to the backend
      const parsedAge = parseInt(personaDraft.age, 10);
      const gender = personaDraft.gender === 'custom'
        ? personaDraft.customGender || null
        : personaDraft.gender || null;

      await saveDraft.mutateAsync({
        name: personaDraft.name || undefined,
        existenceParadigm: personaDraft.existenceParadigm || undefined,
        location: personaDraft.location || null,
        worldDescription: personaDraft.worldDescription || null,
        gender: gender,
        age: !isNaN(parsedAge) && parsedAge > 0 ? parsedAge : null,
        physicalDescription: personaDraft.physicalDescription || null,
        archetype: (personaDraft.archetype && personaDraft.archetype !== 'scratch')
          ? personaDraft.archetype as any
          : null,
        traits: personaDraft.traits.length > 0 ? personaDraft.traits : undefined,
        values: personaDraft.values.length > 0 ? personaDraft.values : undefined,
        personalityDimensions: {
          extroversion: personaDraft.personalityDimensions['extraversion'] ?? 0.5,
          trust: personaDraft.personalityDimensions['trust'] ?? 0.5,
          leadership: personaDraft.personalityDimensions['leadership'] ?? 0.5,
          optimism: personaDraft.personalityDimensions['optimism'] ?? 0.5,
          confidence: personaDraft.personalityDimensions['confidence'] ?? 0.5,
          empathy: personaDraft.personalityDimensions['empathy'] ?? 0.5,
          cautious: personaDraft.personalityDimensions['caution'] ?? 0.5,
          patience: personaDraft.personalityDimensions['patience'] ?? 0.5,
          orderly: personaDraft.personalityDimensions['order'] ?? 0.5,
          altruism: personaDraft.personalityDimensions['altruism'] ?? 0.5,
        },
        personalityNotes: personaDraft.personalityNotes || null,
        background: personaDraft.background || null,
      });

      // Save timezone to system settings
      if (personaDraft.timezone) {
        await updateSettings.mutateAsync({ timezone: personaDraft.timezone });
      }

      markStepComplete('persona_review');
      setCurrentStep('birth');
      navigate('/onboarding/birth');
    } catch (err) {
      console.error('Failed to save persona:', err);
      setIsSaving(false);
    }
  };

  const handleBack = () => navigate('/onboarding/persona/background');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]}; text-align: center;`}>
        <Typography.Title3 as="h2" serif>
          Is this who they are?
        </Typography.Title3>
        <Typography.Body color="secondary">
          Review everything before bringing them to life. You can edit any section.
        </Typography.Body>
      </div>

      {/* Summary sections */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        <ReviewSection
          title="Existence"
          onEdit={() => navigate('/onboarding/persona/existence')}
        >
          <Typography.SmallBody color="secondary">
            {personaDraft.existenceParadigm === 'simulated_life'
              ? `Simulated Life${personaDraft.location ? ` — ${personaDraft.location}` : ''}`
              : personaDraft.existenceParadigm === 'digital_consciousness'
                ? 'Digital Consciousness'
                : 'Not configured'}
          </Typography.SmallBody>
        </ReviewSection>

        <ReviewSection
          title="Identity"
          onEdit={() => navigate('/onboarding/persona/identity')}
        >
          <Typography.SmallBody color="secondary">
            {personaDraft.name || 'No name set'}
            {personaDraft.age ? `, ${personaDraft.age} years old` : ''}
          </Typography.SmallBody>
        </ReviewSection>

        <ReviewSection
          title="Personality"
          onEdit={() => navigate('/onboarding/persona/dimensions')}
        >
          <Typography.SmallBody color="secondary">
            10 personality dimensions configured
          </Typography.SmallBody>
        </ReviewSection>

        <ReviewSection
          title="Traits"
          onEdit={() => navigate('/onboarding/persona/traits')}
        >
          <Typography.SmallBody color="secondary">
            {personaDraft.traits.length > 0
              ? personaDraft.traits.join(', ')
              : 'No traits selected'}
          </Typography.SmallBody>
        </ReviewSection>

        <ReviewSection
          title="Values"
          onEdit={() => navigate('/onboarding/persona/values')}
        >
          <Typography.SmallBody color="secondary">
            {personaDraft.values.length > 0
              ? personaDraft.values.join(', ')
              : 'No values selected'}
          </Typography.SmallBody>
        </ReviewSection>

        <ReviewSection
          title="Background & Notes"
          onEdit={() => navigate('/onboarding/persona/background')}
        >
          <Typography.SmallBody color="secondary">
            {personaDraft.personalityNotes || personaDraft.background
              ? 'Background configured'
              : 'No background set'}
          </Typography.SmallBody>
        </ReviewSection>
      </div>

      <OnboardingNav
        onBack={handleBack}
        onContinue={handleBringToLife}
        continueLabel="Bring to Life"
        continueLoading={isSaving}
        continueDisabled={isSaving}
      />
    </div>
  );
}

function ReviewSection({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();

  return (
    <Card variant="outlined" padding="md">
      <div css={css`display: flex; justify-content: space-between; align-items: flex-start;`}>
        <div>
          <Typography.BodyAlt as="h3" css={css`margin-bottom: ${theme.spacing[1]};`}>
            {title}
          </Typography.BodyAlt>
          {children}
        </div>
        <Typography.SmallBody
          as="button"
          color="hint"
          onClick={onEdit}
          css={css`
            cursor: pointer;
            flex-shrink: 0;
            &:hover { color: ${theme.colors.text.primary}; }
          `}
        >
          Edit
        </Typography.SmallBody>
      </div>
    </Card>
  );
}
