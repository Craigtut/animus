/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card } from '../../../components/ui';
import { useOnboardingStore } from '../../../store';
import { trpc } from '../../../utils/trpc';

export function ReviewStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep, personaDraft } = useOnboardingStore();
  const [isSaving, setIsSaving] = useState(false);

  const saveDraft = trpc.persona.saveDraft.useMutation();

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
      <div css={css`text-align: center;`}>
        <h2 css={css`font-size: ${theme.typography.fontSize['2xl']}; font-weight: ${theme.typography.fontWeight.light}; margin-bottom: ${theme.spacing[2]};`}>
          Is this who they are?
        </h2>
        <p css={css`color: ${theme.colors.text.secondary};`}>
          Review everything before bringing them to life. You can edit any section.
        </p>
      </div>

      {/* Summary sections */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        <ReviewSection
          title="Existence"
          onEdit={() => navigate('/onboarding/persona/existence')}
        >
          <p css={css`color: ${theme.colors.text.secondary}; font-size: ${theme.typography.fontSize.sm};`}>
            {personaDraft.existenceParadigm === 'simulated_life'
              ? `Simulated Life${personaDraft.location ? ` — ${personaDraft.location}` : ''}`
              : personaDraft.existenceParadigm === 'digital_consciousness'
                ? 'Digital Consciousness'
                : 'Not configured'}
          </p>
        </ReviewSection>

        <ReviewSection
          title="Identity"
          onEdit={() => navigate('/onboarding/persona/identity')}
        >
          <p css={css`color: ${theme.colors.text.secondary}; font-size: ${theme.typography.fontSize.sm};`}>
            {personaDraft.name || 'No name set'}
            {personaDraft.age ? `, ${personaDraft.age} years old` : ''}
          </p>
        </ReviewSection>

        <ReviewSection
          title="Personality"
          onEdit={() => navigate('/onboarding/persona/dimensions')}
        >
          <p css={css`color: ${theme.colors.text.secondary}; font-size: ${theme.typography.fontSize.sm};`}>
            10 personality dimensions configured
          </p>
        </ReviewSection>

        <ReviewSection
          title="Traits"
          onEdit={() => navigate('/onboarding/persona/traits')}
        >
          <p css={css`color: ${theme.colors.text.secondary}; font-size: ${theme.typography.fontSize.sm};`}>
            {personaDraft.traits.length > 0
              ? personaDraft.traits.join(', ')
              : 'No traits selected'}
          </p>
        </ReviewSection>

        <ReviewSection
          title="Values"
          onEdit={() => navigate('/onboarding/persona/values')}
        >
          <p css={css`color: ${theme.colors.text.secondary}; font-size: ${theme.typography.fontSize.sm};`}>
            {personaDraft.values.length > 0
              ? personaDraft.values.join(', ')
              : 'No values selected'}
          </p>
        </ReviewSection>

        <ReviewSection
          title="Background & Notes"
          onEdit={() => navigate('/onboarding/persona/background')}
        >
          <p css={css`color: ${theme.colors.text.secondary}; font-size: ${theme.typography.fontSize.sm};`}>
            {personaDraft.personalityNotes || personaDraft.background
              ? 'Background configured'
              : 'No background set'}
          </p>
        </ReviewSection>
      </div>

      <div css={css`display: flex; justify-content: space-between; margin-top: ${theme.spacing[6]};`}>
        <Button variant="ghost" onClick={handleBack}>Back</Button>
        <Button size="lg" onClick={handleBringToLife} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Bring to Life'}
        </Button>
      </div>
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
          <h3 css={css`
            font-size: ${theme.typography.fontSize.base};
            font-weight: ${theme.typography.fontWeight.semibold};
            margin-bottom: ${theme.spacing[1]};
          `}>
            {title}
          </h3>
          {children}
        </div>
        <button
          onClick={onEdit}
          css={css`
            font-size: ${theme.typography.fontSize.sm};
            color: ${theme.colors.text.hint};
            cursor: pointer;
            flex-shrink: 0;
            &:hover { color: ${theme.colors.text.primary}; }
          `}
        >
          Edit
        </button>
      </div>
    </Card>
  );
}
