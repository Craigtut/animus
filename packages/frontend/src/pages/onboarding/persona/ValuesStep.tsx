/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card } from '../../../components/ui';
import { useOnboardingStore } from '../../../store';

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
      <div>
        <h2 css={css`font-size: ${theme.typography.fontSize['2xl']}; font-weight: ${theme.typography.fontWeight.light}; margin-bottom: ${theme.spacing[2]};`}>
          What matters most?
        </h2>
        <p css={css`color: ${theme.colors.text.secondary};`}>
          Pick your top 3 to 5 values and rank them. When values conflict, higher-ranked values win.
        </p>
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

      <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.hint};`}>
        {selected.length} of {MAX_VALUES} selected
      </p>

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
            <Card
              key={val.id}
              variant={isSelected ? 'elevated' : 'outlined'}
              interactive={!isDisabled}
              padding="sm"
              onClick={() => !isDisabled && toggleValue(val.id)}
              css={css`
                opacity: ${isDisabled ? 0.4 : 1};
                cursor: ${isDisabled ? 'default' : 'pointer'};
              `}
            >
              <div css={css`display: flex; align-items: flex-start; gap: ${theme.spacing[2]};`}>
                {isSelected && (
                  <span css={css`
                    display: flex; align-items: center; justify-content: center;
                    width: 20px; height: 20px; border-radius: 50%;
                    background: ${theme.colors.accent};
                    color: ${theme.colors.accentForeground};
                    font-size: ${theme.typography.fontSize.xs};
                    font-weight: ${theme.typography.fontWeight.semibold};
                    flex-shrink: 0;
                    margin-top: 2px;
                  `}>
                    {rank + 1}
                  </span>
                )}
                <div>
                  <span css={css`font-weight: ${theme.typography.fontWeight.medium}; font-size: ${theme.typography.fontSize.sm};`}>
                    {val.name}
                  </span>
                  <p css={css`font-size: ${theme.typography.fontSize.xs}; color: ${theme.colors.text.hint}; margin-top: 2px;`}>
                    {val.description}
                  </p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div css={css`display: flex; justify-content: space-between; margin-top: ${theme.spacing[4]};`}>
        <Button variant="ghost" onClick={handleBack}>Back</Button>
        <Button onClick={handleContinue} disabled={selected.length < 3}>Continue</Button>
      </div>
    </div>
  );
}
