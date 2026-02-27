/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Slider, Typography } from '../../../components/ui';
import { useOnboardingStore } from '../../../store';
import { OnboardingNav } from '../OnboardingNav';

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
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[5]};`}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        <Typography.Body color="secondary" serif css={css`font-style: italic;`}>
          The spectrum of who they are
        </Typography.Body>
        <Typography.Title3 as="h2" css={css`
          font-weight: ${theme.typography.fontWeight.medium};
        `}>
          Shape who they are across ten dimensions of personality
        </Typography.Title3>
      </div>

      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        {dimensionGroups.map((group) => (
          <div
            key={group.title}
            css={css`
              background: ${theme.colors.background.paper};
              border: 1px solid ${theme.colors.border.default};
              border-radius: ${theme.borderRadius.lg};
              padding: ${theme.spacing[4]} ${theme.spacing[5]};
              display: flex;
              flex-direction: column;
              gap: ${theme.spacing[4]};
            `}
          >
            <Typography.Caption as="h3" color="hint" css={css`
              text-transform: uppercase;
              letter-spacing: 0.08em;
              font-weight: ${theme.typography.fontWeight.medium};
            `}>
              {group.title}
            </Typography.Caption>
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
      </div>

      <OnboardingNav
        onBack={handleBack}
        onContinue={handleContinue}
      />
    </div>
  );
}
