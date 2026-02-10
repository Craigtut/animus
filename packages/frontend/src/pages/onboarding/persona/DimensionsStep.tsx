/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/ui';
import { Slider } from '../../../components/ui/Slider';
import { useOnboardingStore } from '../../../store';

interface Dimension {
  id: string;
  leftLabel: string;
  rightLabel: string;
}

const dimensionGroups: { title: string; dimensions: Dimension[] }[] = [
  {
    title: 'Social Orientation',
    dimensions: [
      { id: 'extraversion', leftLabel: 'Introverted', rightLabel: 'Extroverted' },
      { id: 'trust', leftLabel: 'Suspicious', rightLabel: 'Trusting' },
      { id: 'leadership', leftLabel: 'Follower', rightLabel: 'Leader' },
    ],
  },
  {
    title: 'Emotional Temperament',
    dimensions: [
      { id: 'optimism', leftLabel: 'Pessimistic', rightLabel: 'Optimistic' },
      { id: 'confidence', leftLabel: 'Insecure', rightLabel: 'Confident' },
      { id: 'empathy', leftLabel: 'Uncompassionate', rightLabel: 'Empathetic' },
    ],
  },
  {
    title: 'Decision Style',
    dimensions: [
      { id: 'caution', leftLabel: 'Reckless', rightLabel: 'Cautious' },
      { id: 'patience', leftLabel: 'Impulsive', rightLabel: 'Patient' },
      { id: 'order', leftLabel: 'Chaotic', rightLabel: 'Orderly' },
    ],
  },
  {
    title: 'Moral Compass',
    dimensions: [
      { id: 'altruism', leftLabel: 'Selfish', rightLabel: 'Altruistic' },
    ],
  },
];

export function DimensionsStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep, personaDraft, updatePersonaDraft } = useOnboardingStore();

  const [values, setValues] = useState<Record<string, number>>(() => {
    // Initialize from store if available, otherwise default to 0.5
    const stored = personaDraft.personalityDimensions;
    const initial: Record<string, number> = {};
    dimensionGroups.forEach((g) =>
      g.dimensions.forEach((d) => {
        initial[d.id] = stored[d.id] ?? 0.5;
      })
    );
    return initial;
  });

  const handleChange = (id: string, val: number) => {
    setValues((prev) => ({ ...prev, [id]: val }));
  };

  const handleContinue = () => {
    updatePersonaDraft({ personalityDimensions: values });
    markStepComplete('persona_dimensions');
    setCurrentStep('persona_traits');
    navigate('/onboarding/persona/traits');
  };

  const handleBack = () => navigate('/onboarding/persona/archetype');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div>
        <h2 css={css`font-size: ${theme.typography.fontSize['2xl']}; font-weight: ${theme.typography.fontWeight.light}; margin-bottom: ${theme.spacing[2]};`}>
          Shape their personality
        </h2>
        <p css={css`color: ${theme.colors.text.secondary};`}>
          Slide each dimension to define who they are. Leave anything in the middle if it's not distinctive.
        </p>
      </div>

      {dimensionGroups.map((group) => (
        <div key={group.title} css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <h3 css={css`
            font-size: ${theme.typography.fontSize.sm};
            font-weight: ${theme.typography.fontWeight.medium};
            color: ${theme.colors.text.hint};
            text-transform: uppercase;
            letter-spacing: 0.06em;
          `}>
            {group.title}
          </h3>
          {group.dimensions.map((dim) => (
            <Slider
              key={dim.id}
              value={values[dim.id] ?? 0.5}
              onChange={(v) => handleChange(dim.id, v)}
              leftLabel={dim.leftLabel}
              rightLabel={dim.rightLabel}
              showNeutral
            />
          ))}
        </div>
      ))}

      <div css={css`display: flex; justify-content: space-between; margin-top: ${theme.spacing[4]};`}>
        <Button variant="ghost" onClick={handleBack}>Back</Button>
        <Button onClick={handleContinue}>Continue</Button>
      </div>
    </div>
  );
}
