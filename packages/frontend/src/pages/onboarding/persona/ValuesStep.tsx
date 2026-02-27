/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SelectionCard, Typography } from '../../../components/ui';
import { useOnboardingStore } from '../../../store';
import { OnboardingNav } from '../OnboardingNav';

const allValues = [
  { id: 'knowledge', name: 'Knowledge & Truth', description: 'Pursuing understanding above all else' },
  { id: 'loyalty', name: 'Loyalty & Devotion', description: 'Standing by the people and causes you believe in' },
  { id: 'freedom', name: 'Freedom & Independence', description: 'Charting your own course, resisting constraint' },
  { id: 'creativity', name: 'Creativity & Expression', description: 'Making something new, finding beauty in creation' },
  { id: 'justice', name: 'Justice & Fairness', description: 'Doing what\'s right, even when it\'s hard' },
  { id: 'growth', name: 'Growth & Self-improvement', description: 'Becoming better, always evolving' },
  { id: 'connection', name: 'Connection & Belonging', description: 'Finding your people, building bonds' },
  { id: 'achievement', name: 'Achievement & Excellence', description: 'Setting high standards and meeting them' },
  { id: 'harmony', name: 'Harmony & Peace', description: 'Seeking balance, reducing conflict' },
  { id: 'adventure', name: 'Adventure & Discovery', description: 'Embracing the unknown, seeking new experience' },
  { id: 'compassion', name: 'Compassion & Service', description: 'Easing suffering, lifting others up' },
  { id: 'authenticity', name: 'Authenticity & Honesty', description: 'Being genuine, even when it\'s uncomfortable' },
  { id: 'resilience', name: 'Resilience & Perseverance', description: 'Enduring difficulty, refusing to quit' },
  { id: 'wisdom', name: 'Wisdom & Discernment', description: 'Knowing what matters, seeing clearly' },
  { id: 'humor', name: 'Humor & Joy', description: 'Finding lightness, not taking life too seriously' },
  { id: 'security', name: 'Security & Stability', description: 'Building something solid, protecting what matters' },
];

const MAX_VALUES = 5;

export function ValuesStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep, personaDraft, updatePersonaDraft } = useOnboardingStore();

  const [selected, setSelected] = useState<string[]>(personaDraft.values);

  const toggleValue = (id: string) => {
    if (selected.includes(id)) {
      setSelected(selected.filter((v) => v !== id));
    } else if (selected.length < MAX_VALUES) {
      setSelected([...selected, id]);
    }
  };

  const handleContinue = () => {
    updatePersonaDraft({ values: selected });
    markStepComplete('persona_values');
    setCurrentStep('persona_background');
    navigate('/onboarding/persona/background');
  };

  const handleBack = () => navigate('/onboarding/persona/traits');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        <Typography.Body color="secondary" serif css={css`
          font-style: italic;
        `}>
          What matters most?
        </Typography.Body>
        <Typography.Title3 as="h2" css={css`
          font-weight: ${theme.typography.fontWeight.medium};
        `}>
          Choose their core values and rank them by importance
        </Typography.Title3>
      </div>

      {/* Ranked summary */}
      {selected.length > 0 && (
        <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[2]};`}>
          {selected.map((id, i) => {
            const val = allValues.find((v) => v.id === id)!;
            return (
              <span
                key={id}
                css={css`
                  display: inline-flex;
                  align-items: center;
                  gap: ${theme.spacing[1]};
                  padding: ${theme.spacing[1]} ${theme.spacing[3]};
                  background: ${theme.colors.accent};
                  color: ${theme.colors.accentForeground};
                  border-radius: ${theme.borderRadius.full};
                  font-size: ${theme.typography.fontSize.sm};
                  font-weight: ${theme.typography.fontWeight.medium};
                `}
              >
                <span css={css`opacity: 0.7; font-size: ${theme.typography.fontSize.xs};`}>#{i + 1}</span>
                {val.name.split(' & ')[0]}
              </span>
            );
          })}
        </div>
      )}

      <Typography.SmallBody color="hint">
        {selected.length} of {MAX_VALUES} selected
      </Typography.SmallBody>

      <div css={css`
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: ${theme.spacing[3]};
        @media (max-width: ${theme.breakpoints.sm}) { grid-template-columns: 1fr; }
      `}>
        {allValues.map((val) => {
          const isSelected = selected.includes(val.id);
          const rank = selected.indexOf(val.id);
          const isDisabled = !isSelected && selected.length >= MAX_VALUES;

          return (
            <SelectionCard
              key={val.id}
              selected={isSelected}
              rank={isSelected ? rank + 1 : undefined}
              disabled={isDisabled}
              padding="sm"
              onClick={() => toggleValue(val.id)}
            >
              <div>
                <Typography.SmallBodyAlt as="span">
                  {val.name}
                </Typography.SmallBodyAlt>
                <Typography.Caption as="p" color="hint" css={css`margin-top: 2px;`}>
                  {val.description}
                </Typography.Caption>
              </div>
            </SelectionCard>
          );
        })}
      </div>

      <OnboardingNav
        onBack={handleBack}
        onContinue={handleContinue}
        continueDisabled={selected.length < 3}
      />
    </div>
  );
}
